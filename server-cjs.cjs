'use strict';

const { createServer } = require('https');
const { createServer: createHttpServer } = require('http');
const { readFileSync, existsSync, mkdirSync } = require('fs');
const { WebSocketServer } = require('ws');
const { randomBytes, sign, constants: cryptoConstants } = require('crypto');
const { join } = require('path');
const { spawn } = require('child_process');
const cloudflared = require('cloudflared');
const open = require('open');
const os = require('os');

const PORT = 3000;

// Resolve asset paths - works both in development and pkg bundle
function getAssetPath(filename) {
  if (process.pkg) {
    return join(require('path').dirname(process.execPath), filename);
  }
  return join(__dirname, filename);
}

// Resolve writable path for binaries/data
function getWritablePath(filename) {
  const dir = join(os.homedir(), '.secure-meeting');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, filename);
}

// Load SSL certificates
let serverOptions = null;
const sslKey = getAssetPath('ssl/private-key.pem');
const sslCert = getAssetPath('ssl/certificate.pem');

if (existsSync(sslKey) && existsSync(sslCert)) {
  serverOptions = {
    key: readFileSync(sslKey),
    cert: readFileSync(sslCert)
  };
  console.log('✓ SSL certificates loaded');
} else {
  console.log('⚠ No SSL certificates found, using HTTP');
}

// Load server identity key
let serverIdentityPrivateKey = null;
const identityKeyPath = getAssetPath('server-identity-private.pem');
if (existsSync(identityKeyPath)) {
  serverIdentityPrivateKey = readFileSync(identityKeyPath, 'utf8');
  console.log('✓ Server identity key loaded');
}

// In-memory storage
const rooms = new Map();
const clients = new Map();
const inviteTokens = new Map();
const rateLimits = new Map();

const RATE_LIMIT = {
  MAX_ATTEMPTS: 5,
  WINDOW_MS: 60000,
  BASE_BLOCK_DURATION_MS: 300000,
  MAX_BLOCK_DURATION_MS: 86400000
};

// Cleanup interval
setInterval(() => {
  const now = Date.now();
  for (const [clientId, data] of rateLimits.entries()) {
    data.attempts = data.attempts.filter(t => now - t < RATE_LIMIT.WINDOW_MS);
    if (data.blocked && data.blockedAt) {
      if (now - data.blockedAt > getBlockDuration(data.blockCount)) {
        data.blocked = false;
        data.blockedAt = null;
        data.attempts = [];
      }
    }
    if (data.attempts.length === 0 && !data.blocked && data.blockCount === 0) {
      rateLimits.delete(clientId);
    }
  }
  for (const [token, data] of inviteTokens.entries()) {
    if (data.expiresAt < now || data.used) inviteTokens.delete(token);
  }
}, 60000);

// HTTP request handler
const requestHandler = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(readFileSync(getAssetPath('index.html')));
    } else if (req.url === '/client.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(readFileSync(getAssetPath('client.js')));
    } else if (req.url === '/crypto.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(readFileSync(getAssetPath('crypto.js')));
    } else if (req.url === '/styles.css') {
      res.writeHead(200, { 'Content-Type': 'text/css' });
      res.end(readFileSync(getAssetPath('styles.css')));
    } else {
      res.writeHead(404);
      res.end();
    }
  } catch (err) {
    console.error('Error serving', req.url, err.message);
    res.writeHead(500);
    res.end();
  }
};

// Create server
const server = serverOptions
  ? createServer(serverOptions, requestHandler)
  : createHttpServer(requestHandler);

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const clientId = randomBytes(16).toString('hex');
  clients.set(clientId, { ws, roomId: null, subRoomId: null, isHost: false });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      handleMessage(clientId, msg);
    } catch (e) {}
  });

  ws.on('close', () => {
    const client = clients.get(clientId);
    if (client && client.roomId) leaveRoom(clientId, client.roomId);
    clients.delete(clientId);
  });

  ws.send(JSON.stringify({ type: 'connected', clientId }));
});

server.listen(PORT, async () => {
  const protocol = serverOptions ? 'https' : 'http';
  console.log(`\n✓ Secure Meeting server running on ${protocol}://localhost:${PORT}`);

  try {
    console.log('⏳ Starting Cloudflare Tunnel...');

    const binPath = getWritablePath('cloudflared');
    await cloudflared.install(binPath);
    console.log('✓ Cloudflared binary ready');

    const tunnelUrl_arg = serverOptions
      ? `https://localhost:${PORT}`
      : `http://localhost:${PORT}`;

    const cfProcess = spawn(binPath, ['tunnel', '--url', tunnelUrl_arg, '--no-tls-verify'], {
      stdio: 'pipe'
    });

    const tunnelUrl = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Tunnel URL timeout after 30s')), 30000);

      const onData = (data) => {
        const output = data.toString();
        const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (match) {
          clearTimeout(timeout);
          cfProcess.stdout.off('data', onData);
          cfProcess.stderr.off('data', onData);
          resolve(match[0]);
        }
      };

      cfProcess.stdout.on('data', onData);
      cfProcess.stderr.on('data', onData);
    });

    console.log(`\n✓ Public URL: ${tunnelUrl}`);
    console.log('  Share this URL with participants to join your meeting.\n');

    global.tunnelUrl = tunnelUrl;

    const localUrl = `${protocol}://localhost:${PORT}`;
    console.log(`  Opening ${localUrl} for host...`);
    await open(localUrl);

    process.on('SIGINT', () => {
      console.log('\nShutting down...');
      cfProcess.kill();
      process.exit(0);
    });

  } catch (err) {
    console.error('⚠ Tunnel failed:', err.message);
    console.log(`  App accessible locally at ${protocol}://localhost:${PORT}`);
    global.tunnelFailed = true;
    await open(`${protocol}://localhost:${PORT}`);
  }
});

// ── Message handling ──────────────────────────────────────────────────────────

function handleMessage(clientId, msg) {
  switch (msg.type) {
    case 'verify-server-identity': verifyServerIdentity(clientId, msg.challenge); break;
    case 'create-room': createRoom(clientId, msg.passphrase); break;
    case 'join-room': joinRoom(clientId, msg.roomId, msg.passphrase, msg.token); break;
    case 'generate-token': generateInviteToken(clientId); break;
    case 'set-passphrase': setPassphrase(clientId, msg.passphrase); break;
    case 'create-breakouts': createBreakouts(clientId, msg.count); break;
    case 'assign-breakout': assignBreakout(clientId, msg.targetId, msg.subRoomId); break;
    case 'switch-breakout': switchBreakout(clientId, msg.subRoomId); break;
    case 'signal': relaySignal(clientId, msg); break;
    case 'key-exchange': relayKeyExchange(clientId, msg); break;
    case 'encrypted-signal': relayEncryptedSignal(clientId, msg); break;
    case 'kick-participant': kickParticipant(clientId, msg.targetId); break;
    case 'mute-participant': muteParticipant(clientId, msg.targetId); break;
    case 'lock-room': lockRoom(clientId); break;
    case 'unlock-room': unlockRoom(clientId); break;
  }
}

function verifyServerIdentity(clientId, challenge) {
  const client = clients.get(clientId);
  if (!client) return;
  if (!serverIdentityPrivateKey) {
    client.ws.send(JSON.stringify({ type: 'server-identity-error', message: 'Not configured' }));
    return;
  }
  try {
    const signature = sign('sha256', Buffer.from(challenge, 'base64'), {
      key: serverIdentityPrivateKey,
      padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
      saltLength: cryptoConstants.RSA_PSS_SALTLEN_DIGEST
    });
    client.ws.send(JSON.stringify({ type: 'server-identity-verified', signature: signature.toString('base64') }));
  } catch (err) {
    client.ws.send(JSON.stringify({ type: 'server-identity-error', message: 'Verification failed' }));
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
      subRoomId, name: r.name, participants: Array.from(r.participants)
    }))
  };
  meeting.participants.forEach(pid => clients.get(pid) && clients.get(pid).ws.send(JSON.stringify(payload)));
}

function createRoom(clientId, passphrase) {
  const roomId = randomBytes(8).toString('hex');
  const meeting = {
    participants: new Set([clientId]),
    hostId: clientId,
    locked: false,
    passphrase: passphrase || null,
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
  client.ws.send(JSON.stringify({ type: 'room-created', roomId, isHost: true, hasPassphrase: !!passphrase }));
  broadcastBreakoutsState(roomId);
}

function generateInviteToken(clientId) {
  const client = clients.get(clientId);
  if (!client || !client.isHost) return;

  if (!global.tunnelUrl && !global.tunnelFailed) {
    client.ws.send(JSON.stringify({ type: 'error', message: 'Tunnel is still starting, please try again in a few seconds.' }));
    return;
  }

  const token = randomBytes(16).toString('hex');
  const expiresAt = Date.now() + (60 * 60 * 1000);
  inviteTokens.set(token, { roomId: client.roomId, expiresAt, used: false });

  const baseUrl = global.tunnelUrl || `${serverOptions ? 'https' : 'http'}://localhost:${PORT}`;
  const inviteUrl = `${baseUrl}/#${client.roomId}?token=${token}`;

  client.ws.send(JSON.stringify({ type: 'token-generated', token, inviteUrl, expiresAt }));
}

function setPassphrase(clientId, passphrase) {
  const client = clients.get(clientId);
  if (!client || !client.isHost) return;
  const room = rooms.get(client.roomId);
  if (room) {
    room.passphrase = passphrase || null;
    client.ws.send(JSON.stringify({ type: 'passphrase-updated', hasPassphrase: !!room.passphrase }));
  }
}

function joinRoom(clientId, roomId, passphrase, token) {
  const client = clients.get(clientId);
  if (!rateLimitCheck(clientId)) {
    const limitData = rateLimits.get(clientId);
    const remaining = Math.ceil((getBlockDuration(limitData.blockCount) - (Date.now() - limitData.blockedAt)) / 1000);
    client.ws.send(JSON.stringify({ type: 'error', message: `Too many attempts. Wait ${Math.floor(remaining/60)}m ${remaining%60}s.` }));
    return;
  }
  const meeting = rooms.get(roomId);
  if (!meeting) { recordAttempt(clientId); client.ws.send(JSON.stringify({ type: 'error', message: 'Room not found' })); return; }
  if (meeting.locked) { client.ws.send(JSON.stringify({ type: 'error', message: 'Room is locked' })); return; }

  if (token) {
    const tokenData = inviteTokens.get(token);
    if (!tokenData || tokenData.roomId !== roomId || tokenData.used || tokenData.expiresAt <= Date.now()) {
      recordAttempt(clientId);
      client.ws.send(JSON.stringify({ type: 'error', message: 'Invalid or expired invite token' }));
      return;
    }
    tokenData.used = true;
  } else if (meeting.passphrase) {
    if (!passphrase) { client.ws.send(JSON.stringify({ type: 'passphrase-required', roomId })); return; }
    if (passphrase !== meeting.passphrase) { recordAttempt(clientId); client.ws.send(JSON.stringify({ type: 'error', message: 'Incorrect passphrase' })); return; }
  }

  resetRateLimit(clientId);
  ensureMainSubRoom(meeting);
  meeting.participants.add(clientId);
  meeting.subRooms.get('main').participants.add(clientId);
  client.roomId = roomId;
  client.subRoomId = 'main';
  client.isHost = false;

  const participants = Array.from(meeting.subRooms.get('main').participants).filter(id => id !== clientId);
  client.ws.send(JSON.stringify({ type: 'room-joined', roomId, participants, isHost: false, hostId: meeting.hostId }));
  participants.forEach(pid => clients.get(pid) && clients.get(pid).ws.send(JSON.stringify({ type: 'peer-joined', peerId: clientId })));
  broadcastBreakoutsState(roomId);
}

function leaveRoom(clientId, roomId) {
  const meeting = rooms.get(roomId);
  if (!meeting) return;
  const client = clients.get(clientId);
  const subRoomId = (client && client.subRoomId) || 'main';
  meeting.participants.delete(clientId);
  const subRoom = meeting.subRooms && meeting.subRooms.get(subRoomId);
  if (subRoom) subRoom.participants.delete(clientId);
  if (subRoom) subRoom.participants.forEach(pid => clients.get(pid) && clients.get(pid).ws.send(JSON.stringify({ type: 'peer-left', peerId: clientId })));
  if (meeting.hostId === clientId && meeting.participants.size > 0) {
    const newHostId = Array.from(meeting.participants)[0];
    meeting.hostId = newHostId;
    const newHost = clients.get(newHostId);
    if (newHost) { newHost.isHost = true; newHost.ws.send(JSON.stringify({ type: 'host-promoted' })); }
    meeting.participants.forEach(pid => { if (pid !== newHostId) clients.get(pid) && clients.get(pid).ws.send(JSON.stringify({ type: 'new-host', hostId: newHostId })); });
  } else if (meeting.participants.size === 0) {
    rooms.delete(roomId); return;
  }
  broadcastBreakoutsState(roomId);
}

function moveClientToSubRoom(clientId, roomId, nextSubRoomId) {
  const meeting = rooms.get(roomId);
  const client = clients.get(clientId);
  if (!meeting || !client) return;
  ensureMainSubRoom(meeting);
  const prevSubRoomId = client.subRoomId || 'main';
  if (!meeting.subRooms.has(nextSubRoomId) || prevSubRoomId === nextSubRoomId) return;
  const prevRoom = meeting.subRooms.get(prevSubRoomId);
  const nextRoom = meeting.subRooms.get(nextSubRoomId);
  if (prevRoom) prevRoom.participants.delete(clientId);
  nextRoom.participants.add(clientId);
  client.subRoomId = nextSubRoomId;
  if (prevRoom) prevRoom.participants.forEach(pid => clients.get(pid) && clients.get(pid).ws.send(JSON.stringify({ type: 'peer-left', peerId: clientId })));
  nextRoom.participants.forEach(pid => { if (pid !== clientId) clients.get(pid) && clients.get(pid).ws.send(JSON.stringify({ type: 'peer-joined', peerId: clientId })); });
  const peersInRoom = Array.from(nextRoom.participants).filter(pid => pid !== clientId);
  client.ws.send(JSON.stringify({ type: 'room-switched', roomId, subRoomId: nextSubRoomId, participants: peersInRoom, hostId: meeting.hostId }));
  broadcastBreakoutsState(roomId);
}

function createBreakouts(clientId, count) {
  const client = clients.get(clientId);
  if (!client || !client.isHost) return;
  const meeting = rooms.get(client.roomId);
  if (!meeting) return;
  const n = Number(count);
  if (!Number.isInteger(n) || n < 1 || n > 20) { client.ws.send(JSON.stringify({ type: 'error', message: 'Invalid breakout count' })); return; }
  ensureMainSubRoom(meeting);
  for (let i = 1; i <= n; i++) {
    const subRoomId = `b${i}`;
    if (!meeting.subRooms.has(subRoomId)) meeting.subRooms.set(subRoomId, { name: `Breakout ${i}`, participants: new Set() });
  }
  broadcastBreakoutsState(client.roomId);
}

function assignBreakout(clientId, targetId, subRoomId) {
  const client = clients.get(clientId);
  if (!client || !client.isHost) return;
  moveClientToSubRoom(targetId, client.roomId, subRoomId);
}

function switchBreakout(clientId, subRoomId) {
  const client = clients.get(clientId);
  if (!client || !client.roomId) return;
  if (!client.isHost && subRoomId !== 'main') { client.ws.send(JSON.stringify({ type: 'error', message: 'Only host can join breakout rooms' })); return; }
  moveClientToSubRoom(clientId, client.roomId, subRoomId);
}

function canRelayToTarget(clientId, targetId) {
  const sender = clients.get(clientId);
  const target = clients.get(targetId);
  if (!sender || !target || sender.roomId !== target.roomId) return false;
  return (sender.subRoomId || 'main') === (target.subRoomId || 'main');
}

function relaySignal(clientId, msg) {
  if (!canRelayToTarget(clientId, msg.targetId)) return;
  const t = clients.get(msg.targetId);
  if (t) t.ws.send(JSON.stringify({ type: 'signal', fromId: clientId, signal: msg.signal }));
}

function relayKeyExchange(clientId, msg) {
  if (!canRelayToTarget(clientId, msg.targetId)) return;
  const t = clients.get(msg.targetId);
  if (t) t.ws.send(JSON.stringify({ type: 'key-exchange', fromId: clientId, publicKey: msg.publicKey }));
}

function relayEncryptedSignal(clientId, msg) {
  if (!canRelayToTarget(clientId, msg.targetId)) return;
  const t = clients.get(msg.targetId);
  if (t) t.ws.send(JSON.stringify({ type: 'encrypted-signal', fromId: clientId, encrypted: msg.encrypted }));
}

function kickParticipant(clientId, targetId) {
  const client = clients.get(clientId);
  if (!client || !client.isHost) return;
  const target = clients.get(targetId);
  if (target) {
    target.ws.send(JSON.stringify({ type: 'kicked', message: 'You have been removed from the meeting' }));
    leaveRoom(targetId, client.roomId);
    target.ws.close();
  }
}

function muteParticipant(clientId, targetId) {
  const client = clients.get(clientId);
  if (!client || !client.isHost) return;
  const t = clients.get(targetId);
  if (t) t.ws.send(JSON.stringify({ type: 'mute-request', message: 'Host has requested you to mute' }));
}

function lockRoom(clientId) {
  const client = clients.get(clientId);
  if (!client || !client.isHost) return;
  const room = rooms.get(client.roomId);
  if (room) {
    room.locked = true;
    room.participants.forEach(pid => clients.get(pid) && clients.get(pid).ws.send(JSON.stringify({ type: 'room-locked' })));
  }
}

function unlockRoom(clientId) {
  const client = clients.get(clientId);
  if (!client || !client.isHost) return;
  const room = rooms.get(client.roomId);
  if (room) {
    room.locked = false;
    room.participants.forEach(pid => clients.get(pid) && clients.get(pid).ws.send(JSON.stringify({ type: 'room-unlocked' })));
  }
}

function getBlockDuration(blockCount) {
  return Math.min(RATE_LIMIT.BASE_BLOCK_DURATION_MS * Math.pow(3, blockCount), RATE_LIMIT.MAX_BLOCK_DURATION_MS);
}

function rateLimitCheck(clientId) {
  const data = rateLimits.get(clientId);
  if (!data) return true;
  if (data.blocked) {
    if (Date.now() - data.blockedAt >= getBlockDuration(data.blockCount)) {
      data.blocked = false; data.blockedAt = null; data.attempts = []; return true;
    }
    return false;
  }
  return data.attempts.filter(t => Date.now() - t < RATE_LIMIT.WINDOW_MS).length < RATE_LIMIT.MAX_ATTEMPTS;
}

function recordAttempt(clientId) {
  if (!rateLimits.has(clientId)) rateLimits.set(clientId, { attempts: [], blocked: false, blockCount: 0 });
  const data = rateLimits.get(clientId);
  data.attempts = [...data.attempts.filter(t => Date.now() - t < RATE_LIMIT.WINDOW_MS), Date.now()];
  if (data.attempts.length >= RATE_LIMIT.MAX_ATTEMPTS) { data.blocked = true; data.blockedAt = Date.now(); data.blockCount++; }
}

function resetRateLimit(clientId) { rateLimits.delete(clientId); }
