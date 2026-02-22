# Secure Meeting Application - Project Documentation

## Overview
A minimal, secure video conferencing application built with low-level technologies, prioritizing security and privacy through ephemeral data storage and minimal dependencies.

## Project Goals
- Maximum security through obscurity and minimal dependencies
- Ephemeral data (no persistence, no trails)
- Clean and simple interface
- Peer-to-peer architecture

## Technology Stack

### Server
- **Runtime**: Node.js (native HTTP server)
- **WebSocket**: `ws` library (only external dependency)
- **Crypto**: Native Node.js crypto module
- **Storage**: In-memory only (Map objects)

### Client
- **Framework**: Vanilla JavaScript (no frameworks)
- **WebRTC**: Native browser APIs
- **Encryption**: Web Crypto API
- **UI**: Pure HTML/CSS

## Architecture

### Communication Flow
1. **WebSocket Connection**: Client connects to server, receives unique client ID
2. **Room Creation**: Host creates room with optional passphrase
3. **Signaling**: Server relays connection info between peers
4. **WebRTC P2P**: Direct peer-to-peer video/audio streams
5. **Ephemeral**: All data deleted when meeting ends

### File Structure
```
.
├── server.js                          # WebSocket signaling server
├── client.js                          # Client-side WebRTC logic
├── crypto.js                          # End-to-end encryption
├── index.html                         # UI structure
├── styles.css                         # Styling
├── package.json                       # Dependencies
├── generate-keys.js                   # Certificate pinning key generator
├── server-identity-private.pem        # Server private key (generated, gitignored)
├── server-identity-public.pem         # Server public key (generated)
├── README.md                          # Setup instructions
├── PROJECT_SUMMARY.md                 # This file
├── CERTIFICATE_PINNING_SETUP.md       # Certificate pinning guide
├── CERTIFICATE_PINNING_SUMMARY.md     # Certificate pinning reference
└── CLIENT_SIDE_HASHING.md             # Client-side hashing documentation
```

## Core Features

### 1. Video Conferencing
- Real-time audio and video streaming
- Peer-to-peer WebRTC connections
- Camera and microphone toggle controls
- Automatic video grid layout
- Mobile device support

### 2. Meeting Management
- Create meetings with unique IDs
- Join via meeting ID or invite link
- Leave meeting (cleanup all connections)
- Automatic room deletion when empty

## Security Features

### 1. Ephemeral Data Architecture
**Implementation**: All data stored in JavaScript Map objects in memory
- No databases
- No file system writes
- No logs or analytics
- Data vanishes on server restart
- Rooms deleted when last participant leaves

**Storage Objects**:
```javascript
const rooms = new Map();           // Meeting rooms
const clients = new Map();         // Connected clients
const rateLimits = new Map();      // Rate limit tracking
const inviteTokens = new Map();    // Invite tokens
```

### 2. Rate Limiting (Anti-Brute Force)
**Implementation**: Exponential backoff for failed join attempts

**Configuration**:
- Max attempts: 5 per minute
- Time window: 60 seconds
- Base block: 5 minutes
- Max block: 24 hours

**Escalation Schedule**:
```
1st violation: 5 minutes
2nd violation: 15 minutes (5 × 3¹)
3rd violation: 45 minutes (5 × 3²)
4th violation: 2.25 hours (5 × 3³)
5th violation: 6.75 hours (5 × 3⁴)
6th+ violation: 24 hours (capped)
```

**Features**:
- Tracks failed attempts per client ID
- Automatic cleanup of old entries
- Block count persists across block periods
- Successful join resets counter

### 3. Authentication System

#### A. Invite Tokens
**Implementation**: Single-use, time-limited tokens

**Features**:
- 16-byte random hex tokens
- 1-hour expiration
- Single-use (marked as used after join)
- Embedded in shareable URLs
- Automatic cleanup of expired tokens

**Format**: `roomId?token=abc123...`

**Priority**: Highest (bypasses passphrase)

#### B. Passphrase Protection
**Implementation**: Client-side SHA-256 hashing

**Features**:
- Optional (host decides)
- Set during creation or anytime after
- Can be removed by host
- **Hashed client-side before transmission** (server never sees plaintext)
- Failed attempts count toward rate limit

**Security Benefits**:
- Server operator can't see passwords
- Network interception only captures hash
- Better privacy and compliance
- Reduces password reuse risk

**Hashing Process**:
```javascript
// Client-side (before sending)
hash = SHA-256(passphrase)
// Server receives and stores hash directly
```

See [CLIENT_SIDE_HASHING.md](CLIENT_SIDE_HASHING.md) for details.

**Priority**: Secondary (required if no valid token)

### 4. Host Controls

#### Participant Management
- **Kick**: Remove participant and close connection
- **Mute Request**: Ask participant to mute (with confirmation dialog)
- **View All**: See all participants in video grid

#### Room Management
- **Lock/Unlock**: Prevent new joins
- **Generate Invites**: Create single-use tokens
- **Set Passphrase**: Add/remove password protection
- **Host Transfer**: Automatic when host leaves

**Authorization**: Server validates host status for all control actions

### 5. End-to-End Encryption

#### Signaling Encryption
**Implementation**: Public key cryptography (crypto.js)

**Features**:
- Each client generates RSA key pair
- Public keys exchanged via server
- Signaling messages encrypted peer-to-peer
- Server cannot decrypt messages

#### Media Encryption
**Implementation**: WebRTC built-in DTLS-SRTP

**Features**:
- Automatic encryption of audio/video
- Peer-to-peer (server never sees media)
- Industry-standard protocols

### 6. Certificate Pinning (MITM Prevention)
**Implementation**: Challenge-response authentication with RSA signatures

**How It Works**:
1. Client generates random challenge on connection
2. Server signs challenge with private key
3. Client verifies signature using pinned public key
4. Connection refused if verification fails

**Features**:
- RSA 2048-bit keys with RSA-PSS signatures
- SHA-256 hashing
- 5-second verification timeout
- Messages queued until verification complete
- Fail-closed security (refuses on error)

**Setup**:
```bash
npm run setup-pinning  # Generate keys
# Copy public key to client.js
npm start              # Server loads private key
```

**Protection Against**:
- Compromised Certificate Authorities
- Rogue SSL certificates
- Man-in-the-middle attacks
- DNS hijacking with valid certificates
- Tunnel operator attacks (Cloudflare, ngrok, etc.)

**User Experience**:
- Completely transparent (no installation)
- ~100-200ms verification delay on connection
- Security alert if MITM attack detected

**Configuration**:
```javascript
// client.js
const ENABLE_CERTIFICATE_PINNING = true;  // Production
const ENABLE_CERTIFICATE_PINNING = false; // Development
```

See [CERTIFICATE_PINNING_SETUP.md](CERTIFICATE_PINNING_SETUP.md) for detailed setup.

### 7. Minimal Dependencies
**Philosophy**: Reduce attack surface

**Dependencies**:
- `ws`: WebSocket server (only external dependency)
- Everything else: Native Node.js and browser APIs

**Avoided**:
- Express/Koa (HTTP frameworks)
- Socket.io (WebSocket abstraction)
- React/Vue/Angular (UI frameworks)
- Database libraries
- Logging libraries
- Analytics libraries

## Security Considerations

### Current Vulnerabilities

1. **Meeting ID Guessing**
   - IDs are 16 hex chars (64-bit entropy)
   - Mitigated by rate limiting
   - Could increase to 128-bit for production

2. **Server Operator Access**
   - Can see meeting IDs and participants
   - Can see signaling metadata
   - Cannot see video/audio content (P2P encrypted)

3. **Network-Level Attacks**
   - Cloudflare Tunnel operator could intercept WebSocket
   - ISPs can see connection metadata
   - Mitigated by HTTPS/WSS

4. **Public STUN Servers**
   - Using Google's STUN servers
   - They can see IP addresses
   - Recommendation: Self-host for production

### Recommended Production Enhancements

1. **Longer Meeting IDs**: 128-bit instead of 64-bit
2. **Self-hosted STUN/TURN**: Remove dependency on Google
3. ~~**Client-side Passphrase Hashing**: Hash before sending to server~~ ✓ **IMPLEMENTED**
4. ~~**Certificate Pinning**: Prevent MITM attacks~~ ✓ **IMPLEMENTED**
5. **Waiting Room**: Host approval before joining
6. **Audit Logging**: Optional encrypted logs for compliance
7. **Salted Password Hashing**: Add room ID as salt to client-side hash

## API Reference

### WebSocket Messages

#### Client → Server

**Create Room**:
```json
{
  "type": "create-room",
  "passphrase": "optional-password"
}
```

**Verify Server Identity**:
```json
{
  "type": "verify-server-identity",
  "challenge": "base64-random-bytes"
}
```

**Join Room**:
```json
{
  "type": "join-room",
  "roomId": "abc123...",
  "passphrase": "optional",
  "token": "optional"
}
```

**Generate Token**:
```json
{
  "type": "generate-token"
}
```

**Set Passphrase**:
```json
{
  "type": "set-passphrase",
  "passphrase": "new-password-or-null"
}
```

**Kick Participant**:
```json
{
  "type": "kick-participant",
  "targetId": "client-id"
}
```

**Mute Participant**:
```json
{
  "type": "mute-participant",
  "targetId": "client-id"
}
```

**Lock/Unlock Room**:
```json
{
  "type": "lock-room"
}
{
  "type": "unlock-room"
}
```

#### Server → Client

**Connected**:
```json
{
  "type": "connected",
  "clientId": "unique-id"
}
```

**Server Identity Verified**:
```json
{
  "type": "server-identity-verified",
  "signature": "base64-signature"
}
```

**Server Identity Error**:
```json
{
  "type": "server-identity-error",
  "message": "error description"
}
```

**Room Created**:
```json
{
  "type": "room-created",
  "roomId": "abc123...",
  "isHost": true,
  "hasPassphrase": false
}
```

**Room Joined**:
```json
{
  "type": "room-joined",
  "roomId": "abc123...",
  "participants": ["id1", "id2"],
  "isHost": false,
  "hostId": "host-id"
}
```

**Passphrase Required**:
```json
{
  "type": "passphrase-required",
  "roomId": "abc123..."
}
```

**Token Generated**:
```json
{
  "type": "token-generated",
  "token": "token-string",
  "inviteUrl": "roomId?token=...",
  "expiresAt": 1234567890
}
```

**Kicked**:
```json
{
  "type": "kicked",
  "message": "You have been removed"
}
```

**Mute Request**:
```json
{
  "type": "mute-request",
  "message": "Host has requested you to mute"
}
```

**Error**:
```json
{
  "type": "error",
  "message": "Error description"
}
```

## Installation & Setup

### Prerequisites
- Node.js (v16+)
- npm or yarn

### Installation
```bash
npm install
```

### Setup Certificate Pinning (Recommended)

Certificate pinning protects against man-in-the-middle attacks:

```bash
npm run setup-pinning
```

This generates:
1. Server private key (`server-identity-private.pem`)
2. Server public key (`server-identity-public.pem`)
3. Outputs public key to copy into `client.js`

**Important Steps:**
1. Copy the displayed public key
2. Open `client.js`
3. Replace `PINNED_SERVER_PUBLIC_KEY` with your key
4. Never commit the private key to git (already in .gitignore)

See [CERTIFICATE_PINNING_SETUP.md](CERTIFICATE_PINNING_SETUP.md) for detailed instructions.

### Running Locally
```bash
npm start
```

You should see:
```
✓ Server identity key loaded for certificate pinning
Secure meeting server running on http://localhost:3000
```

Access at: http://localhost:3000

**Verify Certificate Pinning:**
Open browser console and look for:
```
🔒 Verifying server identity...
✓ Server identity verified successfully
```

### Remote Access (Cloudflare Tunnel)
```bash
# Install cloudflared
brew install cloudflared

# Run tunnel
cloudflared tunnel --url http://localhost:3000
```

Share the generated HTTPS URL with participants.

### Uninstall Cloudflare
```bash
brew uninstall cloudflared
# or with cleanup
brew uninstall --zap cloudflared
```

## Usage Guide

### Creating a Meeting

1. Click "Create Meeting"
2. Optionally enter a passphrase
3. Click "Create"
4. Share the Meeting ID or generate invite links

### Joining a Meeting

**With Invite Link**:
1. Paste the full invite URL
2. Click "Join Meeting"
3. Allow camera/microphone access

**With Meeting ID**:
1. Enter the Meeting ID
2. Click "Join Meeting"
3. Enter passphrase if prompted
4. Allow camera/microphone access

### Host Controls

**Generate Invite**:
- Click "🎟️ Generate Invite"
- Link copied to clipboard
- Valid for 1 hour, single-use

**Set Password**:
- Click "🔑 Set Password"
- Enter passphrase (or leave empty to remove)

**Lock Room**:
- Click "🔓 Lock" to prevent new joins
- Click "🔒 Unlock" to allow joins again

**Manage Participants**:
- Hover over participant video
- Click 🔇 to request mute
- Click ❌ to remove participant

## Development Notes

### Code Organization

**server.js**:
- HTTP server and static file serving
- WebSocket connection handling
- Room and client management
- Authentication logic (hash comparison)
- Rate limiting
- Host control enforcement
- Certificate pinning verification (challenge signing)

**client.js**:
- WebSocket client
- WebRTC peer connection management
- UI event handlers
- Media stream handling
- Encryption key exchange
- Certificate pinning verification (signature verification)
- Client-side passphrase hashing (SHA-256)

**crypto.js**:
- RSA key pair generation
- Message encryption/decryption
- Key exchange protocol

**generate-keys.js**:
- Server identity key generation
- RSA 2048-bit key pair creation
- Public key extraction for pinning

**styles.css**:
- Dark theme
- Responsive grid layout
- Control button styling
- Mobile-friendly design

### Key Design Decisions

1. **No Database**: Ephemeral by design
2. **Minimal Dependencies**: Security through simplicity
3. **P2P Media**: Server doesn't see content
4. **Rate Limiting**: Prevents brute force
5. **Host Controls**: Meeting management
6. **Flexible Auth**: Tokens + passphrases

### Testing Checklist

**Basic Functionality:**
- [ ] Create meeting without passphrase
- [ ] Create meeting with passphrase
- [ ] Join with correct passphrase
- [ ] Join with incorrect passphrase (should fail)
- [ ] Generate and use invite token
- [ ] Use expired token (should fail)
- [ ] Use token twice (second should fail)
- [ ] Lock room and attempt join (should fail)
- [ ] Kick participant
- [ ] Request participant mute
- [ ] Host leaves (new host promoted)
- [ ] Rate limiting (5 failed attempts)
- [ ] Mobile device access
- [ ] Multiple participants (3+)

**Certificate Pinning:**
- [ ] Generate keys with `npm run setup-pinning`
- [ ] Copy public key to client.js
- [ ] Server starts with "✓ Server identity key loaded"
- [ ] Browser console shows "✓ Server identity verified"
- [ ] Test with wrong public key (should fail)
- [ ] Test with pinning disabled (should work)
- [ ] Test with pinning enabled (should verify)
- [ ] Verify 5-second timeout on verification failure

## Future Enhancements

### Potential Features
1. Screen sharing
2. Chat messages
3. Recording (with explicit consent)
4. Virtual backgrounds
5. Waiting room
6. Participant names/avatars
7. Breakout rooms
8. Meeting scheduling

### Security Improvements
1. 128-bit meeting IDs
2. Self-hosted STUN/TURN servers
3. Client-side passphrase hashing
4. ~~Certificate pinning~~ ✓ **IMPLEMENTED**
5. Encrypted audit logs (optional)
6. Two-factor authentication
7. IP-based access control
8. Meeting expiration times
9. Key rotation automation
10. Certificate pinning monitoring/alerting

## Troubleshooting

### Camera/Microphone Not Working
- Ensure HTTPS is used (required for getUserMedia)
- Check browser permissions
- Try different browser
- Check device settings

### Cannot Join Meeting
- Verify meeting ID is correct
- Check if room is locked
- Verify passphrase if required
- Check rate limiting (wait if blocked)

### Connection Issues
- Check internet connection
- Verify WebSocket connection (console logs)
- Try refreshing the page
- Check firewall settings

### Certificate Pinning Issues

**"Server identity verification timeout"**
- Check if `server-identity-private.pem` exists
- Verify server logs show "✓ Server identity key loaded"
- Ensure file permissions allow reading
- Try regenerating keys

**"Server identity verification failed"**
- Verify public key in client.js matches server's private key
- Check for copy/paste errors (extra spaces, line breaks)
- Regenerate keys and update both server and client
- Check browser console for detailed error messages

**"Could not verify server identity"**
- Possible MITM attack or configuration mismatch
- Verify you're connecting to the correct server
- Check network isn't intercepting traffic
- Temporarily disable pinning to test: `ENABLE_CERTIFICATE_PINNING = false`

**Connection works locally but fails remotely**
- Ensure same private key on all servers
- Or use separate keys per environment with matching client configs
- Verify key files deployed to production server

### Cloudflare Tunnel Issues
- Ensure server is running first
- Check cloudflared is installed
- Verify tunnel URL is HTTPS
- Try restarting tunnel

## Security Audit Checklist

Before deploying to production:

**Certificate Pinning:**
- [ ] Keys generated with `npm run setup-pinning`
- [ ] Public key correctly copied to client.js
- [ ] Private key secured (chmod 600)
- [ ] Private key backed up securely
- [ ] Private key NOT in version control
- [ ] Pinning enabled in production (ENABLE_CERTIFICATE_PINNING = true)
- [ ] Verification tested and working
- [ ] Key rotation procedure documented
- [ ] Monitoring for verification failures

**General Security:**
- [ ] HTTPS/WSS enabled
- [ ] Rate limiting tested
- [ ] Authentication tested (tokens + passphrases)
- [ ] Host controls tested
- [ ] End-to-end encryption verified
- [ ] No sensitive data in logs
- [ ] Dependencies updated
- [ ] Security headers configured
- [ ] Firewall rules configured
- [ ] Backup procedures in place

## Related Documentation

- [CERTIFICATE_PINNING_SETUP.md](CERTIFICATE_PINNING_SETUP.md) - Detailed certificate pinning setup
- [CERTIFICATE_PINNING_SUMMARY.md](CERTIFICATE_PINNING_SUMMARY.md) - Quick reference guide
- [CLIENT_SIDE_HASHING.md](CLIENT_SIDE_HASHING.md) - Client-side passphrase hashing documentation
- [README.md](README.md) - General setup and usage

## License & Disclaimer

This is a demonstration project built for educational purposes. For production use:
- Conduct security audit
- Implement additional safeguards
- Consider legal/compliance requirements
- Test thoroughly with real users
- Monitor for vulnerabilities
- Follow certificate pinning best practices
- Implement key rotation procedures

## Contact & Support

For questions or issues:
- Review the documentation files
- Check browser console for errors
- Check server logs for issues
- Refer to troubleshooting sections
- Review source code comments

---

**Last Updated**: February 2026
**Version**: 1.2.0
**Status**: Development/Educational
**Security Features**: Rate Limiting, Authentication, Host Controls, E2E Encryption, Certificate Pinning, Client-Side Hashing
