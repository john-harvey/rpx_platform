import { createServer } from 'https';
import { readFileSync } from 'fs';
import { WebSocketServer } from 'ws';
import { randomBytes, createHash } from 'crypto';

const PORT = 3000;

// HTTPS configuration (for production with SSL certificates)
const httpsOptions = {
  key: readFileSync('./ssl/private-key.pem'),
  cert: readFileSync('./ssl/certificate.pem')
};

// Rest of server.js code stays exactly the same...
// Just change createServer to use https and options:
const server = createServer(httpsOptions, (req, res) => {
  // ... same as server.js
});

// Everything else identical to server.js
