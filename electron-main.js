import { app, BrowserWindow, protocol } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, appendFileSync, existsSync } from 'fs';
import { createServer } from 'https';
import { WebSocketServer } from 'ws';
import { randomBytes, sign, constants as cryptoConstants } from 'crypto';
import * as cloudflared from 'cloudflared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow;
let httpServer;
let wss;
let logFile;
let cloudflaredProcess;

// Setup logging to file for Finder launches
function setupLogging() {
  const logPath = join(app.getPath('userData'), 'electron-debug.log');
  logFile = logPath;
  
  const log = (msg) => {
    const timestamp = new Date().toISOString();
    const logMsg = `[${timestamp}] ${msg}\n`;
    console.log(msg);
    try {
      appendFileSync(logFile, logMsg);
    } catch (e) {
      // Ignore write errors
    }
  };
  
  log('=== App Starting ===');
  log('App path: ' + app.getAppPath());
  log('Resources path: ' + process.resourcesPath);
  log('User data: ' + app.getPath('userData'));
  log('Is packaged: ' + app.isPackaged);
  log('__dirname: ' + __dirname);
  log('Log file: ' + logFile);
  
  return log;
}

const log = setupLogging();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      sandbox: false,
      webSecurity: false // Disable web security for localhost
    },
    title: 'Secure Meeting',
    show: false
  });

  // Wait for server to start, then load the app
  setTimeout(() => {
    log('Loading app from https://localhost:3000');
    mainWindow.loadURL('https://localhost:3000').catch(err => {
      log('Failed to load URL: ' + err.toString());
    });
  }, 3000);

  mainWindow.once('ready-to-show', () => {
    log('Window ready to show');
    mainWindow.show();
  });

  // Uncomment to open DevTools for debugging
  // mainWindow.webContents.openDevTools();

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    log('Page failed to load: ' + errorCode + ' - ' + errorDescription);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function getResourcePath(filename) {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'app.asar.unpacked', filename);
  } else {
    return join(__dirname, filename);
  }
}

async function startServer() {
  const PORT = 3000;
  
  log('Starting embedded HTTPS server on port ' + PORT);

  // Load SSL certificates
  let httpsOptions;
  try {
    const sslKeyPath = getResourcePath('ssl/private-key.pem');
    const sslCertPath = getResourcePath('ssl/certificate.pem');
    
    if (existsSync(sslKeyPath) && existsSync(sslCertPath)) {
      httpsOptions = {
        key: readFileSync(sslKeyPath),
        cert: readFileSync(sslCertPath)
      };
      log('SSL certificates loaded - HTTPS enabled');
    } else {
      log('SSL certificates not found, falling back to HTTP');
      // Will use HTTP if certs not found
    }
  } catch (err) {
    log('Error loading SSL certificates: ' + err.toString());
  }

  // Load server identity key for certificate pinning
  let serverIdentityPrivateKey = null;
  try {
    const identityKeyPath = getResourcePath('server-identity-private.pem');
    if (existsSync(identityKeyPath)) {
      serverIdentityPrivateKey = readFileSync(identityKeyPath, 'utf8');
      log('Server identity key loaded for certificate pinning');
    }
  } catch (err) {
    log('Server identity key not found: ' + err.toString());
  }

  // In-memory storage for the meeting server
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

  // HTTPS server to serve static files
  const serverHandler = (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    try {
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(readFileSync(getResourcePath('index.html')));
      } else if (req.url === '/client.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(readFileSync(getResourcePath('client.js')));
      } else if (req.url === '/crypto.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(readFileSync(getResourcePath('crypto.js')));
      } else if (req.url === '/styles.css') {
        res.writeHead(200, { 'Content-Type': 'text/css' });
        res.end(readFileSync(getResourcePath('styles.css')));
      } else {
        res.writeHead(404);
        res.end();
      }
    } catch (err) {
      log('Server error serving ' + req.url + ': ' + err.toString());
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  };

  // Create HTTPS server if we have certificates, otherwise HTTP
  if (httpsOptions) {
    httpServer = createServer(httpsOptions, serverHandler);
  } else {
    const { createServer: createHttpServer } = await import('http');
    httpServer = createHttpServer(serverHandler);
  }

  // WebSocket server
  wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws) => {
    const clientId = randomBytes(16).toString('hex');
    clients.set(clientId, { ws, roomId: null, subRoomId: null, isHost: false });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        handleMessage(clientId, msg, clients, rooms, inviteTokens, rateLimits, RATE_LIMIT, serverIdentityPrivateKey);
      } catch (e) {
        // Silently ignore malformed messages
      }
    });

    ws.on('close', () => {
      const client = clients.get(clientId);
      if (client?.roomId) {
        leaveRoom(clientId, client.roomId, clients, rooms);
      }
      clients.delete(clientId);
    });

    ws.send(JSON.stringify({ type: 'connected', clientId }));
  });

  httpServer.listen(PORT, async () => {
    const protocol = httpsOptions ? 'https' : 'http';
    log('Server running on ' + protocol + '://localhost:' + PORT);
    
    // Start Cloudflare Tunnel
    try {
      log('Starting Cloudflare Tunnel...');
      
      // Set binary path to writable user data location
      const binPath = join(app.getPath('userData'), 'cloudflared');
      log('Installing cloudflared to: ' + binPath);
      
      await cloudflared.install(binPath);
      log('Cloudflared binary ready at: ' + binPath);
      
      // Pass the binary path explicitly to tunnel()
      const { url, connections, stop } = cloudflared.tunnel({
        '--url': `http://localhost:${PORT}`
      }, binPath);
      
      cloudflaredProcess = { stop };
      
      const tunnelUrl = await url;
      log('Public URL: ' + tunnelUrl);
      global.tunnelUrl = tunnelUrl;
      
      connections.then(() => {
        log('Cloudflare Tunnel connected');
      }).catch(err => {
        log('Tunnel connection error: ' + err.toString());
      });
      
    } catch (err) {
      log('Failed to create Cloudflare Tunnel: ' + err.toString());
      log('Stack: ' + err.stack);
      log('App will only be accessible locally');
    }
  });

  httpServer.on('error', (err) => {
    log('Server error: ' + err.toString());
  });
}

app.on('ready', () => {
  startServer();
  createWindow();
});

app.on('window-all-closed', () => {
  if (cloudflaredProcess) {
    cloudflaredProcess.stop();
  }
  if (httpServer) {
    httpServer.close();
  }
  if (wss) {
    wss.close();
  }
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on('before-quit', () => {
  if (cloudflaredProcess) {
    cloudflaredProcess.stop();
  }
  if (httpServer) {
    httpServer.close();
  }
  if (wss) {
    wss.close();
  }
});

// Simplified message handlers (basic functionality)
function handleMessage(clientId, msg, clients, rooms, inviteTokens, rateLimits, RATE_LIMIT, serverIdentityPrivateKey) {
  switch (msg.type) {
    case 'verify-server-identity':
      verifyServerIdentity(clientId, msg.challenge, clients, serverIdentityPrivateKey);
      break;
    case 'create-room':
      createRoom(clientId, msg.passphrase, clients, rooms);
      break;
    case 'join-room':
      joinRoom(clientId, msg.roomId, msg.passphrase, msg.token, clients, rooms, inviteTokens, rateLimits, RATE_LIMIT);
      break;
    case 'signal':
    case 'key-exchange':
    case 'encrypted-signal':
      relayMessage(clientId, msg, clients);
      break;
    case 'generate-token':
      generateInviteToken(clientId, clients, rooms, inviteTokens);
      break;
    case 'set-passphrase':
      setPassphrase(clientId, msg.passphrase, clients, rooms);
      break;
    case 'create-breakouts':
      createBreakouts(clientId, msg.count, clients, rooms);
      break;
    case 'assign-breakout':
      assignBreakout(clientId, msg.targetId, msg.subRoomId, clients, rooms);
      break;
    case 'switch-breakout':
      switchBreakout(clientId, msg.subRoomId, clients, rooms);
      break;
    case 'kick-participant':
      kickParticipant(clientId, msg.targetId, clients, rooms);
      break;
    case 'mute-participant':
      muteParticipant(clientId, msg.targetId, clients, rooms);
      break;
    case 'lock-room':
      lockRoom(clientId, clients, rooms);
      break;
    case 'unlock-room':
      unlockRoom(clientId, clients, rooms);
      break;
  }
}

function verifyServerIdentity(clientId, challenge, clients, serverIdentityPrivateKey) {
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
    const signature = sign('sha256', Buffer.from(challenge, 'base64'), {
      key: serverIdentityPrivateKey,
      padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
      saltLength: cryptoConstants.RSA_PSS_SALTLEN_DIGEST
    });

    client.ws.send(JSON.stringify({
      type: 'server-identity-verified',
      signature: signature.toString('base64')
    }));
  } catch (err) {
    log('Server identity verification failed: ' + err.toString());
    client.ws.send(JSON.stringify({ 
      type: 'server-identity-error',
      message: 'Verification failed'
    }));
  }
}

function createRoom(clientId, passphrase, clients, rooms) {
  const roomId = randomBytes(8).toString('hex');
  const meeting = {
    participants: new Set([clientId]),
    hostId: clientId,
    locked: false,
    passphrase: passphrase || null,
    tokens: new Map(),
    subRooms: new Map([['main', { name: 'Main', participants: new Set([clientId]) }]])
  };
  
  rooms.set(roomId, meeting);
  
  const client = clients.get(clientId);
  client.roomId = roomId;
  client.subRoomId = 'main';
  client.isHost = true;
  
  client.ws.send(JSON.stringify({
    type: 'room-created',
    roomId,
    isHost: true,
    hasPassphrase: !!passphrase
  }));
  
  broadcastBreakoutsState(roomId, clients, rooms);
}

function joinRoom(clientId, roomId, passphrase, token, clients, rooms, inviteTokens, rateLimits, RATE_LIMIT) {
  const client = clients.get(clientId);
  const meeting = rooms.get(roomId);
  
  if (!meeting) {
    client.ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
    return;
  }
  
  if (meeting.locked) {
    client.ws.send(JSON.stringify({ type: 'error', message: 'Room is locked' }));
    return;
  }
  
  // Simple auth check
  if (meeting.passphrase && passphrase !== meeting.passphrase && !token) {
    client.ws.send(JSON.stringify({ type: 'error', message: 'Incorrect passphrase' }));
    return;
  }
  
  meeting.participants.add(clientId);
  meeting.subRooms.get('main').participants.add(clientId);
  
  client.roomId = roomId;
  client.subRoomId = 'main';
  client.isHost = false;
  
  const participants = Array.from(meeting.subRooms.get('main').participants).filter(id => id !== clientId);
  
  client.ws.send(JSON.stringify({
    type: 'room-joined',
    roomId,
    participants,
    isHost: false,
    hostId: meeting.hostId
  }));
  
  participants.forEach(participantId => {
    const participant = clients.get(participantId);
    if (participant) {
      participant.ws.send(JSON.stringify({ type: 'peer-joined', peerId: clientId }));
    }
  });
  
  broadcastBreakoutsState(roomId, clients, rooms);
}

function leaveRoom(clientId, roomId, clients, rooms) {
  const meeting = rooms.get(roomId);
  if (!meeting) return;
  
  const client = clients.get(clientId);
  const subRoomId = client?.subRoomId || 'main';
  
  meeting.participants.delete(clientId);
  meeting.subRooms?.get(subRoomId)?.participants.delete(clientId);
  
  meeting.subRooms?.get(subRoomId)?.participants.forEach((pid) => {
    const p = clients.get(pid);
    p?.ws.send(JSON.stringify({ type: 'peer-left', peerId: clientId }));
  });
  
  if (meeting.participants.size === 0) {
    rooms.delete(roomId);
  }
}

function relayMessage(clientId, msg, clients) {
  const targetClient = clients.get(msg.targetId);
  if (targetClient) {
    targetClient.ws.send(JSON.stringify({
      type: msg.type,
      fromId: clientId,
      ...msg
    }));
  }
}

function generateInviteToken(clientId, clients, rooms, inviteTokens) {
  const client = clients.get(clientId);
  if (!client?.isHost) return;
  
  const token = randomBytes(16).toString('hex');
  const expiresAt = Date.now() + (60 * 60 * 1000);
  
  inviteTokens.set(token, {
    roomId: client.roomId,
    expiresAt,
    used: false
  });
  
  // Use tunnel URL if available, otherwise localhost
  const baseUrl = global.tunnelUrl || 'https://localhost:3000';
  const inviteUrl = `${baseUrl}/#${client.roomId}?token=${token}`;
  
  client.ws.send(JSON.stringify({ 
    type: 'token-generated', 
    token,
    inviteUrl,
    expiresAt
  }));
}

function setPassphrase(clientId, passphrase, clients, rooms) {
  const client = clients.get(clientId);
  if (!client?.isHost) return;
  
  const room = rooms.get(client.roomId);
  if (room) {
    room.passphrase = passphrase || null;
    client.ws.send(JSON.stringify({ 
      type: 'passphrase-updated',
      hasPassphrase: !!room.passphrase
    }));
  }
}

function createBreakouts(clientId, count, clients, rooms) {
  const client = clients.get(clientId);
  if (!client?.isHost) return;
  
  const meeting = rooms.get(client.roomId);
  if (!meeting) return;
  
  for (let i = 1; i <= count; i++) {
    const subRoomId = `b${i}`;
    if (!meeting.subRooms.has(subRoomId)) {
      meeting.subRooms.set(subRoomId, { name: `Breakout ${i}`, participants: new Set() });
    }
  }
  
  broadcastBreakoutsState(client.roomId, clients, rooms);
}

function assignBreakout(clientId, targetId, subRoomId, clients, rooms) {
  const client = clients.get(clientId);
  if (!client?.isHost) return;
  
  moveClientToSubRoom(targetId, client.roomId, subRoomId, clients, rooms);
}

function switchBreakout(clientId, subRoomId, clients, rooms) {
  const client = clients.get(clientId);
  if (!client?.roomId) return;
  
  moveClientToSubRoom(clientId, client.roomId, subRoomId, clients, rooms);
}

function moveClientToSubRoom(clientId, roomId, nextSubRoomId, clients, rooms) {
  const meeting = rooms.get(roomId);
  const client = clients.get(clientId);
  if (!meeting || !client) return;
  
  const prevSubRoomId = client.subRoomId || 'main';
  if (!meeting.subRooms.has(nextSubRoomId) || prevSubRoomId === nextSubRoomId) return;
  
  const prevRoom = meeting.subRooms.get(prevSubRoomId);
  const nextRoom = meeting.subRooms.get(nextSubRoomId);
  
  prevRoom?.participants.delete(clientId);
  nextRoom.participants.add(clientId);
  client.subRoomId = nextSubRoomId;
  
  prevRoom?.participants.forEach((pid) => {
    const p = clients.get(pid);
    p?.ws.send(JSON.stringify({ type: 'peer-left', peerId: clientId }));
  });
  
  nextRoom.participants.forEach((pid) => {
    if (pid === clientId) return;
    const p = clients.get(pid);
    p?.ws.send(JSON.stringify({ type: 'peer-joined', peerId: clientId }));
  });
  
  const peersInRoom = Array.from(nextRoom.participants).filter((pid) => pid !== clientId);
  client.ws.send(JSON.stringify({
    type: 'room-switched',
    roomId,
    subRoomId: nextSubRoomId,
    participants: peersInRoom,
    hostId: meeting.hostId
  }));
  
  broadcastBreakoutsState(roomId, clients, rooms);
}

function broadcastBreakoutsState(roomId, clients, rooms) {
  const meeting = rooms.get(roomId);
  if (!meeting) return;
  
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

function kickParticipant(clientId, targetId, clients, rooms) {
  const client = clients.get(clientId);
  if (!client?.isHost) return;
  
  const target = clients.get(targetId);
  if (target) {
    target.ws.send(JSON.stringify({ type: 'kicked', message: 'You have been removed from the meeting' }));
    leaveRoom(targetId, client.roomId, clients, rooms);
    target.ws.close();
  }
}

function muteParticipant(clientId, targetId, clients, rooms) {
  const client = clients.get(clientId);
  if (!client?.isHost) return;
  
  const target = clients.get(targetId);
  if (target) {
    target.ws.send(JSON.stringify({ type: 'mute-request', message: 'Host has requested you to mute' }));
  }
}

function lockRoom(clientId, clients, rooms) {
  const client = clients.get(clientId);
  if (!client?.isHost) return;
  
  const room = rooms.get(client.roomId);
  if (room) {
    room.locked = true;
    room.participants.forEach(participantId => {
      const participant = clients.get(participantId);
      if (participant) {
        participant.ws.send(JSON.stringify({ type: 'room-locked' }));
      }
    });
  }
}

function unlockRoom(clientId, clients, rooms) {
  const client = clients.get(clientId);
  if (!client?.isHost) return;
  
  const room = rooms.get(client.roomId);
  if (room) {
    room.locked = false;
    room.participants.forEach(participantId => {
      const participant = clients.get(participantId);
      if (participant) {
        participant.ws.send(JSON.stringify({ type: 'room-unlocked' }));
      }
    });
  }
}
