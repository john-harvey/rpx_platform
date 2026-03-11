# Electron Desktop App Build Instructions

## Setup

1. Install Electron dependencies:
```bash
npm install
```

## Development

Run the app in development mode:
```bash
npm run electron
```

This will start the server and open the Electron window.

## Building Executables

### For macOS:
```bash
npm run electron:build:mac
```
Output: `dist/Secure Meeting-1.0.0.dmg` and `dist/Secure Meeting-1.0.0-mac.zip`

### For Windows:
```bash
npm run electron:build:win
```
Output: `dist/Secure Meeting Setup 1.0.0.exe` (installer) and `dist/Secure Meeting 1.0.0.exe` (portable)

### For Both Platforms:
```bash
npm run electron:build:all
```

Note: Building for Windows on macOS requires Wine. Install with:
```bash
brew install --cask wine-stable
```

## App Icon

Replace the placeholder files in the `build/` directory with your own icons:
- `build/icon.icns` - macOS icon (512x512 PNG converted to ICNS)
- `build/icon.ico` - Windows icon (256x256 PNG converted to ICO)

You can use online converters or tools like:
- macOS: `iconutil` (built-in)
- Windows: ImageMagick or online converters

## Distribution

The built executables are standalone and include:
- Node.js runtime
- Your server code
- All dependencies
- Electron browser

Users don't need to install Node.js or any dependencies.

## File Size

Expect the final app to be around 150-200MB due to the bundled Chromium and Node.js runtime.

## Security Notes

The Electron app uses HTTP mode (server-http.js) for simplicity. For production:
1. Consider implementing HTTPS with proper certificate handling
2. Add code signing for macOS and Windows
3. Enable auto-updates using electron-updater
