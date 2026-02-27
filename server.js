import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { WebSocketServer } from 'ws';
import { randomBytes, sign, constants as cryptoConstants } from 'crypto';

const PORT = 3000;

// Load server identity private key for certificate pinning
let serverIdentityPrivateKey = null;
if (existsSync('./server-identity-private.pem')) {
  serverIdentityPrivateKey = readFileSync('./server-identity-private.pem', 'utf8');
  console.log('✓ Server identity key loaded for certificate pinning');
} else {
  console.warn('⚠ Warning: No server identity key found. Run "node generate-keys.js" to enable certificate pinning.');
}

// Ephemeral in-memory storage (cleared on restart)
// roomId in this file is the MEETING id
const rooms = new Map(); // roomId -> { participants:Set, hostId, locked, passphrase, tokens, subRooms: Map<subRoomId, { name, participants:Set }> }
const clients = new Map();
const inviteTokens = new Map(); // token -> { roomId, expiresAt, used: false }

// Rate limiting storage
const rateLimits = new Map(); // clientId -> { attempts: [], blocked: false, blockCount: 0 }

// Rate limit configuration
const RATE_LIMIT = {
  MAX_ATTEMPTS: 5,        // Max join attempts
  WINDOW_MS: 60000,       // Time window (1 minute)
  BASE_BLOCK_DURATION_MS: 300000,  // Base block duration (5 minutes)
  MAX_BLOCK_DURATION_MS: 86400000  // Max block duration (24 hours)
};

// Cleanup old rate limit entries and expired tokens every minute
setInterval(() => {
  const now = Date.now();
  
  // Cleanup rate limits
  for (const [clientId, data] of rateLimits.entries()) {
    data.attempts = data.attempts.filter(time => now - time < RATE_LIMIT.WINDOW_MS);
    
    if (data.blocked && data.blockedAt) {
      const blockDuration = getBlockDuration(data.blockCount);
      if (now - data.blockedAt > blockDuration) {
        data.blocked = false;
        data.blockedAt = null;
        data.attempts = [];
      }
    }
    
    if (data.attempts.length === 0 && !data.blocked && data.blockCount === 0) {
      rateLimits.delete(clientId);
    }
  }
  
  // Cleanup expired tokens
  for (const [token, data] of inviteTokens.entries()) {
    if (data.expiresAt < now || data.used) {
      inviteTokens.delete(token);
    }
  }
}, 60000);

const server = createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(readFileSync('./index.html'));
  } else if (req.url === '/client.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end(readFileSync('./client.js'));
  } else if (req.url === '/crypto.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end(readFileSync('./crypto.js'));
  } else if (req.url === '/styles.css') {
    res.writeHead(200, { 'Content-Type': 'text/css' });
    res.end(readFileSync('./styles.css'));
  } else {
    res.writeHead(404);
    res.end();
  }
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const clientId = randomBytes(16).toString('hex');
  clients.set(clientId, { ws, roomId: null, subRoomId: null, isHost: false });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      handleMessage(clientId, msg);
    } catch (e) {
      // Silently ignore malformed messages
    }
  });

  ws.on('close', () => {
    const client = clients.get(clientId);
    if (client?.roomId) {
      leaveRoom(clientId, client.roomId);
    }
    clients.delete(clientId);
    // Keep rate limit data for the block duration
  });

  ws.send(JSON.stringify({ type: 'connected', clientId }));
});

function handleMessage(clientId, msg) {
  switch (msg.type) {
    case 'verify-server-identity':
      verifyServerIdentity(clientId, msg.challenge);
      break;
    case 'create-room':
      createRoom(clientId, msg.passphrase);
      break;
    case 'join-room':
      joinRoom(clientId, msg.roomId, msg.passphrase, msg.token);
      break;
    case 'generate-token':
      generateInviteToken(clientId);
      break;
    case 'set-passphrase':
      setPassphrase(clientId, msg.passphrase);
      break;
    case 'create-breakouts':
      createBreakouts(clientId, msg.count);
      break;
    case 'assign-breakout':
      assignBreakout(clientId, msg.targetId, msg.subRoomId);
      break;
    case 'switch-breakout':
      switchBreakout(clientId, msg.subRoomId);
      break;
    case 'signal':
      relaySignal(clientId, msg);
      break;
    case 'key-exchange':
      relayKeyExchange(clientId, msg);
      break;
    case 'encrypted-signal':
      relayEncryptedSignal(clientId, msg);
      break;
    case 'kick-participant':
      kickParticipant(clientId, msg.targetId);
      break;
    case 'mute-participant':
      muteParticipant(clientId, msg.targetId);
      break;
    case 'lock-room':
      lockRoom(clientId);
      break;
    case 'unlock-room':
      unlockRoom(clientId);
      break;
  }
}

function ensureMainSubRoom(meeting) {
  if (!meeting.subRooms) meeting.subRooms = new Map();
  if (!meeting.subRooms.has('main')) {
    meeting.subRooms.set('main', { name: 'Main', participants: new Set() });
  }
}

function broadcastBreakoutsState(roomId) {
  const meeting = rooms.get(roomId);
  if (!meeting) return;

  ensureMainSubRoom(meeting);

  const payload = {
    type: 'breakouts-state',
    rooms: Array.from(meeting.subRooms.entries()).map(([subRoomId, r]) => ({
      subRoomId,
      name: r.name,
      participants: Array.from(r.participants)
    }))
  };

  meeting.participants.forEach((pid) => {
    const p = clients.get(pid);
    p?.ws.send(JSON.stringify(payload));
  });
}

function moveClientToSubRoom(clientId, roomId, nextSubRoomId) {
  const meeting = rooms.get(roomId);
  const client = clients.get(clientId);
  if (!meeting || !client) return;

  ensureMainSubRoom(meeting);

  const prevSubRoomId = client.subRoomId || 'main';
  if (!meeting.subRooms.has(nextSubRoomId)) {
    client.ws.send(JSON.stringify({ type: 'error', message: 'Breakout room not found' }));
    return;
  }
  if (prevSubRoomId === nextSubRoomId) return;

  const prevRoom = meeting.subRooms.get(prevSubRoomId);
  const nextRoom = meeting.subRooms.get(nextSubRoomId);

  prevRoom?.participants.delete(clientId);
  nextRoom.participants.add(clientId);
  client.subRoomId = nextSubRoomId;

  // Notify peers in previous room that client left
  prevRoom?.participants.forEach((pid) => {
    const p = clients.get(pid);
    p?.ws.send(JSON.stringify({ type: 'peer-left', peerId: clientId }));
  });

  // Notify peers in next room that client joined
  nextRoom.participants.forEach((pid) => {
    if (pid === clientId) return;
    const p = clients.get(pid);
    p?.ws.send(JSON.stringify({ type: 'peer-joined', peerId: clientId }));
  });

  // Tell moved client who is in the new room (for rebuilding mesh)
  const peersInRoom = Array.from(nextRoom.participants).filter((pid) => pid !== clientId);
  client.ws.send(JSON.stringify({
    type: 'room-switched',
    roomId,
    subRoomId: nextSubRoomId,
    participants: peersInRoom,
    hostId: meeting.hostId
  }));

  broadcastBreakoutsState(roomId);
}

function createRoom(clientId, passphrase) {
  const roomId = randomBytes(8).toString('hex');
  // Passphrase is already hashed client-side, store as-is
  const passphraseHash = passphrase || null;

  const meeting = {
    participants: new Set([clientId]),
    hostId: clientId,
    locked: false,
    passphrase: passphraseHash,
    tokens: new Map(),
    subRooms: new Map()
  };
  ensureMainSubRoom(meeting);
  meeting.subRooms.get('main').participants.add(clientId);

  rooms.set(roomId, meeting);

  const client = clients.get(clientId);
  client.roomId = roomId;
  client.subRoomId = 'main';
  client.isHost = true;

  client.ws.send(JSON.stringify({
    type: 'room-created',
    roomId,
    isHost: true,
    hasPassphrase: !!passphraseHash
  }));

  broadcastBreakoutsState(roomId);
}

function verifyServerIdentity(clientId, challenge) {
  const client = clients.get(clientId);
  if (!client) return;

  if (!serverIdentityPrivateKey) {
    client.ws.send(JSON.stringify({ 
      type: 'server-identity-error',
      message: 'Server identity verification not configured'
    }));
    return;
  }

  try {
    // Sign the challenge with server's private key
    const signature = sign('sha256', Buffer.from(challenge, 'base64'), {
      key: serverIdentityPrivateKey,
      padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
      saltLength: cryptoConstants.RSA_PSS_SALTLEN_DIGEST  // Use digest length (32 bytes for SHA-256)
    });

    client.ws.send(JSON.stringify({
      type: 'server-identity-verified',
      signature: signature.toString('base64')
    }));
  } catch (err) {
    console.error('Server identity verification failed:', err);
    client.ws.send(JSON.stringify({ 
      type: 'server-identity-error',
      message: 'Verification failed'
    }));
  }
}

function generateInviteToken(hostId) {
  const host = clients.get(hostId);
  if (!host || !host.isHost) {
    host?.ws.send(JSON.stringify({ type: 'error', message: 'Only host can generate tokens' }));
    return;
  }

  const room = rooms.get(host.roomId);
  if (!room) return;

  const token = randomBytes(16).toString('hex');
  const expiresAt = Date.now() + (60 * 60 * 1000); // 1 hour
  
  inviteTokens.set(token, {
    roomId: host.roomId,
    expiresAt,
    used: false
  });

  // Just send the path portion - client will construct full URL
  const inviteUrl = `${host.roomId}?token=${token}`;
  host.ws.send(JSON.stringify({ 
    type: 'token-generated', 
    token,
    inviteUrl,
    expiresAt
  }));
}

function setPassphrase(hostId, passphrase) {
  const host = clients.get(hostId);
  if (!host || !host.isHost) {
    host?.ws.send(JSON.stringify({ type: 'error', message: 'Only host can set passphrase' }));
    return;
  }

  const room = rooms.get(host.roomId);
  if (!room) return;

  // Passphrase is already hashed client-side, store as-is
  room.passphrase = passphrase || null;
  
  host.ws.send(JSON.stringify({ 
    type: 'passphrase-updated',
    hasPassphrase: !!room.passphrase
  }));
}

function joinRoom(clientId, roomId, passphrase, token) {
  const client = clients.get(clientId);

  // Check rate limit
  if (!rateLimitCheck(clientId)) {
    const limitData = rateLimits.get(clientId);
    const blockDuration = getBlockDuration(limitData.blockCount);
    const remainingTime = Math.ceil((blockDuration - (Date.now() - limitData.blockedAt)) / 1000);
    const minutes = Math.floor(remainingTime / 60);
    const seconds = remainingTime % 60;
    const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

    client.ws.send(JSON.stringify({
      type: 'error',
      message: `Too many attempts. Please wait ${timeStr}.`
    }));
    return;
  }

  let meeting = rooms.get(roomId);
  if (!meeting) {
    recordAttempt(clientId);
    client.ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
    return;
  }

  // Check if room is locked
  if (meeting.locked) {
    client.ws.send(JSON.stringify({ type: 'error', message: 'Room is locked' }));
    return;
  }

  // Validate authentication
  let authenticated = false;

  // Check invite token first (highest priority)
  if (token) {
    const tokenData = inviteTokens.get(token);
    if (tokenData && tokenData.roomId === roomId && !tokenData.used && tokenData.expiresAt > Date.now()) {
      authenticated = true;
      tokenData.used = true; // Mark token as used
    } else {
      recordAttempt(clientId);
      client.ws.send(JSON.stringify({ type: 'error', message: 'Invalid or expired invite token' }));
      return;
    }
  }
  // Check passphrase if no token
  else if (meeting.passphrase) {
    if (!passphrase) {
      client.ws.send(JSON.stringify({ type: 'passphrase-required', roomId }));
      return;
    }

    // Passphrase is already hashed client-side, compare directly
    if (passphrase !== meeting.passphrase) {
      recordAttempt(clientId);
      client.ws.send(JSON.stringify({ type: 'error', message: 'Incorrect passphrase' }));
      return;
    }
    authenticated = true;
  }
  // No authentication required
  else {
    authenticated = true;
  }

  if (!authenticated) {
    recordAttempt(clientId);
    client.ws.send(JSON.stringify({ type: 'error', message: 'Authentication required' }));
    return;
  }

  // Successful join - reset rate limit
  resetRateLimit(clientId);

   meeting = rooms.get(roomId);
  ensureMainSubRoom(meeting);

  meeting.participants.add(clientId);
  meeting.subRooms.get('main').participants.add(clientId);

  client.roomId = roomId;
  client.subRoomId = 'main';
  client.isHost = false;

  // Only peers in MAIN are visible to new joiner initially
  const participants = Array.from(meeting.subRooms.get('main').participants).filter(id => id !== clientId);

  client.ws.send(JSON.stringify({
    type: 'room-joined',
    roomId,
    participants,
    isHost: false,
    hostId: meeting.hostId
  }));

  // Notify existing MAIN participants only
  participants.forEach(participantId => {
    const participant = clients.get(participantId);
    if (participant) {
      participant.ws.send(JSON.stringify({ type: 'peer-joined', peerId: clientId }));
    }
  });

  broadcastBreakoutsState(roomId);
}

function leaveRoom(clientId, roomId) {
  const meeting = rooms.get(roomId);
  if (!meeting) return;

  const client = clients.get(clientId);
  const subRoomId = client?.subRoomId || 'main';

  meeting.participants.delete(clientId);
  meeting.subRooms?.get(subRoomId)?.participants.delete(clientId);

  // Notify peers in the same sub-room only
  meeting.subRooms?.get(subRoomId)?.participants.forEach((pid) => {
    const p = clients.get(pid);
    p?.ws.send(JSON.stringify({ type: 'peer-left', peerId: clientId }));
  });

  // If host left, assign new host or delete meeting
  if (meeting.hostId === clientId) {
    if (meeting.participants.size > 0) {
      const newHostId = Array.from(meeting.participants)[0];
      meeting.hostId = newHostId;

      const newHost = clients.get(newHostId);
      if (newHost) {
        newHost.isHost = true;
        newHost.ws.send(JSON.stringify({ type: 'host-promoted' }));
      }

      meeting.participants.forEach((pid) => {
        const p = clients.get(pid);
        if (p && pid !== newHostId) {
          p.ws.send(JSON.stringify({ type: 'new-host', hostId: newHostId }));
        }
      });
    } else {
      rooms.delete(roomId);
      return;
    }
  } else if (meeting.participants.size === 0) {
    rooms.delete(roomId);
    return;
  }

  broadcastBreakoutsState(roomId);
}

function createBreakouts(hostId, count) {
  const host = clients.get(hostId);
  if (!host || !host.isHost) {
    host?.ws.send(JSON.stringify({ type: 'error', message: 'Only host can create breakout rooms' }));
    return;
  }

  const meeting = rooms.get(host.roomId);
  if (!meeting) return;

  const n = Number(count);
  if (!Number.isInteger(n) || n < 1 || n > 20) {
    host.ws.send(JSON.stringify({ type: 'error', message: 'Invalid breakout count' }));
    return;
  }

  ensureMainSubRoom(meeting);

  for (let i = 1; i <= n; i++) {
    const subRoomId = `b${i}`;
    if (!meeting.subRooms.has(subRoomId)) {
      meeting.subRooms.set(subRoomId, { name: `Breakout ${i}`, participants: new Set() });
    }
  }

  broadcastBreakoutsState(host.roomId);
}

function assignBreakout(hostId, targetId, subRoomId) {
  const host = clients.get(hostId);
  if (!host || !host.isHost) {
    host?.ws.send(JSON.stringify({ type: 'error', message: 'Only host can assign breakouts' }));
    return;
  }

  const meeting = rooms.get(host.roomId);
  if (!meeting) return;

  const target = clients.get(targetId);
  if (!target || target.roomId !== host.roomId) return;

  moveClientToSubRoom(targetId, host.roomId, subRoomId);
}

function switchBreakout(clientId, subRoomId) {
  const client = clients.get(clientId);
  if (!client?.roomId) return;

  const meeting = rooms.get(client.roomId);
  if (!meeting) return;

  // Participants may only return to main; host may join any room
  if (!client.isHost && subRoomId !== 'main') {
    client.ws.send(JSON.stringify({ type: 'error', message: 'Only host can join breakout rooms' }));
    return;
  }

  moveClientToSubRoom(clientId, client.roomId, subRoomId);
}

function canRelayToTarget(clientId, targetId) {
  const sender = clients.get(clientId);
  const target = clients.get(targetId);
  if (!sender || !target) return false;
  if (!sender.roomId || sender.roomId !== target.roomId) return false;

  const sRoom = sender.subRoomId || 'main';
  const tRoom = target.subRoomId || 'main';
  return sRoom === tRoom;
}

function relaySignal(clientId, msg) {
  if (!canRelayToTarget(clientId, msg.targetId)) return;

  const targetClient = clients.get(msg.targetId);
  if (targetClient) {
    targetClient.ws.send(JSON.stringify({
      type: 'signal',
      fromId: clientId,
      signal: msg.signal
    }));
  }
}

function relayKeyExchange(clientId, msg) {
  if (!canRelayToTarget(clientId, msg.targetId)) return;

  const targetClient = clients.get(msg.targetId);
  if (targetClient) {
    targetClient.ws.send(JSON.stringify({
      type: 'key-exchange',
      fromId: clientId,
      publicKey: msg.publicKey
    }));
  }
}

function relayEncryptedSignal(clientId, msg) {
  if (!canRelayToTarget(clientId, msg.targetId)) return;

  const targetClient = clients.get(msg.targetId);
  if (targetClient) {
    targetClient.ws.send(JSON.stringify({
      type: 'encrypted-signal',
      fromId: clientId,
      encrypted: msg.encrypted
    }));
  }
}

function getBlockDuration(blockCount) {
  // Exponential backoff: 5min, 15min, 45min, 2.25hr, 6.75hr, 20.25hr, 24hr (max)
  const duration = RATE_LIMIT.BASE_BLOCK_DURATION_MS * Math.pow(3, blockCount);
  return Math.min(duration, RATE_LIMIT.MAX_BLOCK_DURATION_MS);
}

function rateLimitCheck(clientId) {
  const limitData = rateLimits.get(clientId);
  
  if (!limitData) {
    return true; // No history, allow
  }
  
  if (limitData.blocked) {
    const blockDuration = getBlockDuration(limitData.blockCount);
    const now = Date.now();
    
    // Check if block period has expired
    if (now - limitData.blockedAt >= blockDuration) {
      // Unblock but keep the block count
      limitData.blocked = false;
      limitData.blockedAt = null;
      limitData.attempts = [];
      return true;
    }
    return false; // Still blocked
  }
  
  const now = Date.now();
  const recentAttempts = limitData.attempts.filter(time => now - time < RATE_LIMIT.WINDOW_MS);
  
  return recentAttempts.length < RATE_LIMIT.MAX_ATTEMPTS;
}

function recordAttempt(clientId) {
  const now = Date.now();
  
  if (!rateLimits.has(clientId)) {
    rateLimits.set(clientId, { attempts: [], blocked: false, blockCount: 0 });
  }
  
  const limitData = rateLimits.get(clientId);
  limitData.attempts.push(now);
  
  // Filter to only recent attempts
  limitData.attempts = limitData.attempts.filter(time => now - time < RATE_LIMIT.WINDOW_MS);
  
  // Check if should be blocked
  if (limitData.attempts.length >= RATE_LIMIT.MAX_ATTEMPTS) {
    limitData.blocked = true;
    limitData.blockedAt = now;
    limitData.blockCount += 1; // Increment block count for exponential backoff
    
    const blockDuration = getBlockDuration(limitData.blockCount);
    const minutes = Math.floor(blockDuration / 60000);
    console.log(`Client ${clientId} blocked for ${minutes} minutes (block #${limitData.blockCount})`);
  }
}

function resetRateLimit(clientId) {
  rateLimits.delete(clientId);
}

function kickParticipant(hostId, targetId) {
  const host = clients.get(hostId);
  if (!host || !host.isHost) {
    host?.ws.send(JSON.stringify({ type: 'error', message: 'Only host can kick participants' }));
    return;
  }

  const room = rooms.get(host.roomId);
  if (!room || !room.participants.has(targetId)) {
    return;
  }

  const target = clients.get(targetId);
  if (target) {
    target.ws.send(JSON.stringify({ type: 'kicked', message: 'You have been removed from the meeting' }));
    leaveRoom(targetId, host.roomId);
    target.ws.close();
  }
}

function muteParticipant(hostId, targetId) {
  const host = clients.get(hostId);
  if (!host || !host.isHost) {
    host?.ws.send(JSON.stringify({ type: 'error', message: 'Only host can mute participants' }));
    return;
  }

  const room = rooms.get(host.roomId);
  if (!room || !room.participants.has(targetId)) {
    return;
  }

  const target = clients.get(targetId);
  if (target) {
    target.ws.send(JSON.stringify({ type: 'mute-request', message: 'Host has requested you to mute' }));
  }
}

function lockRoom(hostId) {
  const host = clients.get(hostId);
  if (!host || !host.isHost) {
    host?.ws.send(JSON.stringify({ type: 'error', message: 'Only host can lock the room' }));
    return;
  }

  const room = rooms.get(host.roomId);
  if (room) {
    room.locked = true;
    // Notify all participants
    room.participants.forEach(participantId => {
      const participant = clients.get(participantId);
      if (participant) {
        participant.ws.send(JSON.stringify({ type: 'room-locked' }));
      }
    });
  }
}

function unlockRoom(hostId) {
  const host = clients.get(hostId);
  if (!host || !host.isHost) {
    host?.ws.send(JSON.stringify({ type: 'error', message: 'Only host can unlock the room' }));
    return;
  }

  const room = rooms.get(host.roomId);
  if (room) {
    room.locked = false;
    // Notify all participants
    room.participants.forEach(participantId => {
      const participant = clients.get(participantId);
      if (participant) {
        participant.ws.send(JSON.stringify({ type: 'room-unlocked' }));
      }
    });
  }
}
server.listen(PORT, () => {
  console.log(`Secure meeting server running on http://localhost:${PORT}`);
});
