# Secure Meeting Application

A minimal, secure video conferencing application built with low-level technologies.

## Security Features

- **Ephemeral Data**: All meeting data stored in memory only, cleared on server restart
- **No Persistence**: No databases, no logs, no data trails
- **Minimal Dependencies**: Only `ws` for WebSocket, everything else is native
- **P2P Video**: WebRTC peer-to-peer connections for audio/video
- **No Analytics**: No tracking, no telemetry, no third-party services

## Installation

```bash
npm install
```

## Setup Certificate Pinning (Recommended)

Certificate pinning protects against man-in-the-middle attacks:

```bash
npm run setup-pinning
```

Follow the instructions to copy the public key into `client.js`.

See [CERTIFICATE_PINNING_SETUP.md](CERTIFICATE_PINNING_SETUP.md) for detailed setup guide.

## Running

```bash
npm start
```

Then open http://localhost:3000 in your browser.

## Usage

1. Click "Create Meeting" to start a new meeting
2. Share the Meeting ID with participants
3. Participants enter the Meeting ID and click "Join Meeting"
4. Use the controls to toggle video/audio
5. Click "Leave" to exit the meeting

## Architecture

- **Server**: Native Node.js HTTP + WebSocket server
- **Client**: Vanilla JavaScript with native WebRTC APIs
- **Signaling**: WebSocket for peer discovery and ICE candidate exchange
- **Media**: WebRTC peer-to-peer connections (no media server)

## Security Notes

- All data is ephemeral and stored in memory only
- No external dependencies beyond WebSocket library
- STUN servers are used for NAT traversal (consider self-hosting for production)
- For production, add HTTPS/WSS and consider implementing TURN servers
- Consider adding end-to-end encryption for signaling messages
