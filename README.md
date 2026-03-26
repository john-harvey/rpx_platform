# Secure Meeting Application

A minimal, secure video conferencing application. The host runs a standalone executable that starts a local server and a Cloudflare tunnel automatically, giving participants a public URL to join via browser — no installation required on their end.

## Security Features

- End-to-end encrypted signaling (WebCrypto ECDH)
- Ephemeral data — all meeting state is in-memory, cleared on restart
- No databases, no logs, no telemetry
- P2P audio/video via WebRTC
- Optional passphrase protection per meeting
- Optional certificate pinning (server identity verification)
- Rate limiting on join attempts
- Host controls: kick, mute, lock room, breakout rooms

---

## For Developers: Building the App

### Prerequisites

- Node.js v18+
- npm

### 1. Install dependencies

```bash
npm install
```

### 2. Generate SSL certificates (required for HTTPS)

```bash
npm run setup-ssl
```

This creates `ssl/private-key.pem` and `ssl/certificate.pem`.

### 3. Generate server identity keys (optional — for certificate pinning)

```bash
npm run setup-pinning
```

Follow the output instructions to copy the public key into `client.js` and set `ENABLE_CERTIFICATE_PINNING = true`.

### 4. Run in development mode

```bash
npm run start:tunnel
```

This starts the HTTPS server on `https://localhost:3000` and opens a Cloudflare tunnel. The public URL is printed to the console and used automatically when generating invite links.

---

## Building Standalone Executables

The app is packaged using [pkg](https://github.com/vercel/pkg) into a single executable. Asset files (HTML, CSS, JS, certs) are distributed alongside the executable.

### Build + package for macOS

```bash
npm run package:mac
```

Output: `dist/secure-meeting-macos.zip`

### Build + package for Windows

```bash
npm run package:win
```

Output: `dist/secure-meeting-windows.zip`

### Build executable only (no zip)

```bash
npm run build:mac
npm run build:win
```

Output: `dist/secure-meeting-mac` or `dist/secure-meeting-win.exe`

---

## Distributing the App

Send the appropriate zip file to the host:

- **macOS**: `dist/secure-meeting-macos.zip`
- **Windows**: `dist/secure-meeting-windows.zip`

The zip contains everything needed — no Node.js installation required on the host machine.

> **Note:** `cloudflared` is downloaded automatically on first run into `~/.secure-meeting/cloudflared`. The host machine needs internet access.

---

## For Hosts: Running the App

### macOS

1. Unzip `secure-meeting-macos.zip`
2. Open Terminal, navigate to the unzipped folder
3. Run:
   ```bash
   ./secure-meeting-mac
   ```
4. The browser opens automatically at `https://localhost:3000`
5. Accept the self-signed certificate warning in the browser
6. Wait for the Cloudflare tunnel URL to appear in the terminal (takes ~10s)

> On first launch macOS may block the executable. Go to **System Settings → Privacy & Security** and click "Allow Anyway".

### Windows

1. Unzip `secure-meeting-windows.zip`
2. Double-click `start-meeting.bat`  
   — or run `secure-meeting-win.exe` directly from a terminal
3. The browser opens automatically
4. Wait for the Cloudflare tunnel URL to appear in the terminal

---

## Hosting a Meeting

1. Click **Create Meeting** (optionally set a passphrase)
2. Once in the meeting, click **Generate Invite Link**
3. The invite link is copied to your clipboard — share it with participants
4. The link uses the Cloudflare tunnel URL so participants can join from anywhere

---

## Joining a Meeting (Participants)

Participants only need a browser — no app or installation required.

1. Open the invite link in a browser
2. Allow camera/microphone access when prompted
3. The meeting joins automatically via the link parameters
4. If no invite link: enter the Meeting ID manually and click **Join Meeting**

---

## Architecture

| Component | Technology |
|-----------|-----------|
| Server | Node.js HTTPS + WebSocket (`ws`) |
| Tunneling | Cloudflare Tunnel (`cloudflared`) |
| Video/Audio | WebRTC peer-to-peer |
| Signaling | WebSocket |
| Encryption | WebCrypto API (ECDH key exchange) |
| Packaging | `pkg` (standalone executable) |

## Project Structure

```
├── server-pkg.js          # Dev entry point (ES module, with tunnel)
├── server-cjs.cjs         # Build entry point (CommonJS, for pkg)
├── server.js              # Simple dev server (no tunnel)
├── client.js              # Browser-side app
├── crypto.js              # E2E encryption helpers
├── index.html             # UI
├── styles.css             # Styles
├── ssl/                   # SSL certificates (generated)
├── scripts/
│   ├── package-mac.cjs    # macOS packaging script
│   └── package-win.cjs    # Windows packaging script
└── dist/                  # Build output
```
