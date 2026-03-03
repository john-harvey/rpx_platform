# HTTPS Setup Guide

This guide explains how to set up HTTPS for the Secure Meeting Application.

---

## Quick Start

### 1. Generate SSL Certificate

```bash
npm run setup-ssl
```

This creates a self-signed certificate for development.

### 2. Start HTTPS Server

```bash
npm start
```

### 3. Access the Application

Open your browser to:
- `https://localhost:3000`
- `https://192.168.50.157:3000` (for other devices)

**Important**: Your browser will show a security warning because the certificate is self-signed. This is normal for development.

---

## Browser Security Warning

When you first access the site, you'll see:

**Chrome/Edge**:
```
Your connection is not private
NET::ERR_CERT_AUTHORITY_INVALID
```
Click: **Advanced** → **Proceed to localhost (unsafe)**

**Firefox**:
```
Warning: Potential Security Risk Ahead
```
Click: **Advanced** → **Accept the Risk and Continue**

**Safari**:
```
This Connection Is Not Private
```
Click: **Show Details** → **visit this website**

This warning appears because the certificate is self-signed (not from a trusted Certificate Authority). This is safe for development on your local network.

---

## What HTTPS Provides

### Before HTTPS (HTTP)
```
✅ Video/Audio encrypted (WebRTC DTLS-SRTP)
✅ WebRTC signaling encrypted (RSA)
❌ Control messages plaintext
❌ Metadata exposed
❌ Initial page load plaintext
```

### After HTTPS
```
✅ Video/Audio encrypted (WebRTC DTLS-SRTP)
✅ WebRTC signaling encrypted (RSA)
✅ Control messages encrypted (TLS)
✅ Metadata protected (TLS)
✅ Initial page load encrypted (TLS)
```

**Result**: Everything is now encrypted end-to-end!

---

## Files Created

```
ssl/
├── private-key.pem    # Server private key (keep secret!)
└── certificate.pem    # Public certificate
```

**Important**: These files are automatically added to `.gitignore` and should never be committed to version control.

---

## Certificate Details

The generated certificate includes:

- **Algorithm**: RSA 2048-bit
- **Validity**: 365 days
- **Subject**: CN=localhost
- **Subject Alternative Names**:
  - DNS: localhost
  - IP: 127.0.0.1
  - IP: 192.168.50.157 (your local network IP)

This allows the certificate to work for:
- `https://localhost:3000`
- `https://127.0.0.1:3000`
- `https://192.168.50.157:3000`

---

## Accessing from Other Devices

### Same WiFi Network

1. Find your IP address (already done: `192.168.50.157`)
2. On another device, open: `https://192.168.50.157:3000`
3. Accept the security warning
4. Use the app normally

### Internet Access

For devices outside your network, you still need:
- Cloudflare Tunnel
- ngrok
- Port forwarding
- Or deploy to a VPS with a real domain

---

## Production Deployment

For production, use a real SSL certificate from a trusted Certificate Authority:

### Option 1: Let's Encrypt (Free)

```bash
# Install certbot
sudo apt-get install certbot

# Generate certificate (requires domain)
sudo certbot certonly --standalone -d yourdomain.com

# Certificates will be in:
# /etc/letsencrypt/live/yourdomain.com/privkey.pem
# /etc/letsencrypt/live/yourdomain.com/fullchain.pem
```

Update `server.js`:
```javascript
const httpsOptions = {
  key: readFileSync('/etc/letsencrypt/live/yourdomain.com/privkey.pem'),
  cert: readFileSync('/etc/letsencrypt/live/yourdomain.com/fullchain.pem')
};
```

### Option 2: Commercial Certificate

Purchase from:
- DigiCert
- Sectigo
- GoDaddy
- etc.

Follow their instructions to generate and install.

### Option 3: Cloudflare (Free)

If using Cloudflare:
1. Add your domain to Cloudflare
2. Enable "Full (strict)" SSL mode
3. Use Cloudflare Origin Certificate
4. Or use Cloudflare Tunnel (handles SSL automatically)

---

## Troubleshooting

### "openssl: command not found"

**macOS**:
```bash
brew install openssl
```

**Linux (Ubuntu/Debian)**:
```bash
sudo apt-get install openssl
```

**Windows**:
Download from: https://slproweb.com/products/Win32OpenSSL.html

### Certificate Expired

Regenerate the certificate:
```bash
rm -rf ssl/
npm run setup-ssl
```

### "Address already in use"

Port 3000 is already taken:
```bash
# Find what's using port 3000
lsof -i :3000

# Kill the process
kill -9 <PID>

# Or change the port in server.js
const PORT = 3001;
```

### Browser Still Shows Warning

This is normal for self-signed certificates. Options:

1. **Accept the warning** (easiest for development)
2. **Add certificate to system trust store** (more complex)
3. **Use a real certificate** (for production)

### E2E Encryption Not Working

Check browser console:
```javascript
console.log('Secure context:', window.isSecureContext);
// Should be true with HTTPS
```

If false:
- Make sure you're using `https://` not `http://`
- Check certificate is valid
- Try restarting browser

---

## Security Considerations

### Self-Signed Certificates

**Pros**:
- Free
- Easy to generate
- Works for development
- No external dependencies

**Cons**:
- Browser warnings
- Not trusted by default
- Can't verify identity
- Not suitable for production

### Development vs Production

**Development** (self-signed):
- ✅ Encrypts traffic
- ✅ Enables secure contexts
- ✅ Tests HTTPS features
- ❌ Browser warnings
- ❌ Not trusted

**Production** (real certificate):
- ✅ Encrypts traffic
- ✅ Enables secure contexts
- ✅ No browser warnings
- ✅ Trusted by browsers
- ✅ Verifies identity

---

## Complete Setup Script

Run everything at once:

```bash
# Install dependencies
npm install

# Generate SSL certificate
npm run setup-ssl

# Generate certificate pinning keys
npm run setup-pinning

# Copy public key to client.js (manual step)
# See output from setup-pinning

# Start server
npm start
```

Or use the combined setup:
```bash
npm run setup
```

---

## Testing HTTPS

### 1. Check Server Logs

```
✓ SSL certificates loaded - HTTPS enabled
✓ Server identity key loaded for certificate pinning
Secure meeting server running on https://localhost:3000
```

### 2. Check Browser Console

```javascript
console.log('Protocol:', window.location.protocol);
// Should show: "https:"

console.log('Secure context:', window.isSecureContext);
// Should show: true
```

### 3. Check Network Tab

- Open DevTools → Network
- Look for `wss://` (WebSocket Secure) not `ws://`
- All requests should use HTTPS

### 4. Test E2E Encryption

```javascript
console.log('E2E enabled:', ENABLE_E2E_ENCRYPTION);
// Should show: true
```

---

## Certificate Renewal

Self-signed certificates expire after 365 days.

**To renew**:
```bash
rm -rf ssl/
npm run setup-ssl
```

**For Let's Encrypt** (auto-renewal):
```bash
sudo certbot renew
```

---

## Advanced: Custom Certificate

If you have your own certificate:

1. Place files in `ssl/` directory:
   - `ssl/private-key.pem` (your private key)
   - `ssl/certificate.pem` (your certificate)

2. Optionally include intermediate certificates:
   ```javascript
   const httpsOptions = {
     key: readFileSync('./ssl/private-key.pem'),
     cert: readFileSync('./ssl/certificate.pem'),
     ca: readFileSync('./ssl/ca-bundle.pem')  // Optional
   };
   ```

3. Start server:
   ```bash
   npm start
   ```

---

## Comparison: HTTP vs HTTPS

| Feature | HTTP | HTTPS |
|---------|------|-------|
| Video/Audio Encryption | ✅ Yes | ✅ Yes |
| WebRTC Signaling | ✅ Yes* | ✅ Yes |
| Control Messages | ❌ No | ✅ Yes |
| Metadata Protection | ❌ No | ✅ Yes |
| Browser Trust | ✅ Yes | ⚠️ Warning** |
| Certificate Pinning | ⚠️ Limited | ✅ Full |
| E2E Encryption | ⚠️ Limited | ✅ Full |
| Production Ready | ❌ No | ✅ Yes |

\* Requires localhost  
\** With self-signed cert

---

## FAQ

**Q: Do I need HTTPS for local development?**  
A: Not strictly required, but recommended. Your video/audio is encrypted either way, but HTTPS protects metadata and enables full E2E encryption.

**Q: Can I use HTTP in production?**  
A: No. Always use HTTPS in production for full security.

**Q: Why does my browser show a warning?**  
A: Self-signed certificates aren't trusted by default. This is normal for development.

**Q: How do I get rid of the browser warning?**  
A: Use a real certificate from Let's Encrypt or a commercial CA.

**Q: Does HTTPS slow down my app?**  
A: Minimal impact (~1-2ms overhead). The security benefits far outweigh the tiny performance cost.

**Q: Can I use the same certificate on multiple servers?**  
A: Yes, but you'll need to include all domains/IPs in the Subject Alternative Names.

**Q: What if I don't have OpenSSL?**  
A: Install it (see Troubleshooting section) or use an online certificate generator.

**Q: Is self-signed secure?**  
A: Yes for encryption, but doesn't verify identity. Fine for development, not for production.

---

## Next Steps

After setting up HTTPS:

1. ✅ Enable certificate pinning for production:
   ```javascript
   const ENABLE_CERTIFICATE_PINNING = true;
   ```

2. ✅ Test on multiple devices

3. ✅ Consider Let's Encrypt for production

4. ✅ Update documentation with HTTPS URLs

5. ✅ Configure firewall rules

---

## Support

For issues:
1. Check server logs
2. Check browser console
3. Verify certificate files exist
4. Try regenerating certificates
5. Check firewall settings

---

**Last Updated**: February 2026  
**Version**: 1.2.0  
**Status**: HTTPS Enabled
