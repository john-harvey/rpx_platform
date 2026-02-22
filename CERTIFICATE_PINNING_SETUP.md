# Certificate Pinning Setup Guide

Certificate pinning prevents man-in-the-middle (MITM) attacks by ensuring clients only connect to your authentic server, even if an attacker has a valid SSL certificate from a compromised Certificate Authority.

## How It Works

1. **Server** has a private key (kept secret)
2. **Client** has the server's public key hardcoded (pinned)
3. When connecting, client sends a random challenge
4. Server signs the challenge with its private key
5. Client verifies the signature using the pinned public key
6. If verification fails, connection is refused

## Setup Instructions

### Step 1: Generate Server Identity Keys

Run the key generation script:

```bash
node generate-keys.js
```

This creates:
- `server-identity-private.pem` - Server's private key (keep secret!)
- `server-identity-public.pem` - Server's public key (for reference)
- Outputs the public key to copy into client.js

### Step 2: Update Client Configuration

1. Copy the public key output from the script
2. Open `client.js`
3. Find the `PINNED_SERVER_PUBLIC_KEY` constant
4. Replace the placeholder with your public key:

```javascript
const PINNED_SERVER_PUBLIC_KEY = `
-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA... (your key here)
-----END PUBLIC KEY-----
`.trim();
```

### Step 3: Secure Your Private Key

Add to `.gitignore` (already done):
```
server-identity-private.pem
```

**NEVER commit the private key to version control!**

### Step 4: Start the Server

```bash
npm start
```

You should see:
```
✓ Server identity key loaded for certificate pinning
Secure meeting server running on http://localhost:3000
```

### Step 5: Test Certificate Pinning

1. Open the app in a browser
2. Check the browser console
3. You should see:
   ```
   🔒 Verifying server identity...
   ✓ Server identity verified successfully
   ```

## Configuration Options

### Disable Certificate Pinning (Development)

In `client.js`, set:
```javascript
const ENABLE_CERTIFICATE_PINNING = false;
```

This is useful for:
- Local development
- Testing without keys
- Debugging connection issues

### Enable Certificate Pinning (Production)

In `client.js`, set:
```javascript
const ENABLE_CERTIFICATE_PINNING = true;
```

Always enable for production deployments!

## Key Rotation

When you need to rotate keys (recommended annually):

### Option 1: Seamless Rotation (Recommended)

1. Generate new keys: `node generate-keys.js`
2. Keep old keys temporarily
3. Update client.js with new public key
4. Deploy updated client
5. Wait for all users to get new client (monitor usage)
6. Replace server private key
7. Delete old keys

### Option 2: Immediate Rotation

1. Generate new keys: `node generate-keys.js`
2. Update client.js with new public key
3. Deploy both client and server simultaneously
4. Users will need to refresh to get new client

**Note:** Option 2 may cause temporary connection failures for active users.

## Security Best Practices

### DO:
- ✓ Keep private key secure (never commit to git)
- ✓ Use strong file permissions: `chmod 600 server-identity-private.pem`
- ✓ Rotate keys annually
- ✓ Enable pinning in production
- ✓ Monitor verification failures (could indicate attacks)
- ✓ Back up private key securely

### DON'T:
- ✗ Commit private key to version control
- ✗ Share private key via email/chat
- ✗ Use same keys across multiple servers
- ✗ Disable pinning in production
- ✗ Ignore verification failures

## Troubleshooting

### "Server identity verification timeout"

**Cause:** Server doesn't have private key or can't sign challenges

**Solution:**
1. Check if `server-identity-private.pem` exists
2. Verify file permissions
3. Check server logs for errors
4. Regenerate keys if corrupted

### "Server identity verification failed"

**Cause:** Public key in client doesn't match server's private key

**Solution:**
1. Verify you copied the correct public key to client.js
2. Ensure no extra spaces or line breaks
3. Regenerate keys and update both server and client

### "Could not verify server identity"

**Cause:** Possible MITM attack or configuration mismatch

**Solution:**
1. Check if you're connecting to the correct server
2. Verify network isn't intercepting traffic
3. Check browser console for detailed errors
4. Temporarily disable pinning to test basic connectivity

### Connection works locally but fails remotely

**Cause:** Different server or keys between environments

**Solution:**
1. Use same private key on all servers
2. Or generate separate keys per environment
3. Update client with correct public key for each environment

## Deployment Considerations

### Single Server

Simple: One set of keys, one client configuration

### Multiple Servers (Load Balanced)

**Option 1:** Share same private key across all servers
- Pros: Simple, one client configuration
- Cons: Key compromise affects all servers

**Option 2:** Different keys per server, multiple pinned keys in client
- Pros: Better isolation
- Cons: More complex client configuration

### Development vs Production

Use different keys for each environment:

```javascript
// client.js
const PINNED_SERVER_PUBLIC_KEY = 
  window.location.hostname === 'localhost' 
    ? DEV_PUBLIC_KEY 
    : PROD_PUBLIC_KEY;
```

## Monitoring

Log verification attempts on server:

```javascript
// server.js already logs:
console.log('Server identity verification requested by client:', clientId);
```

Monitor for:
- High failure rates (possible attack)
- Verification timeouts (server issues)
- Unusual patterns (reconnaissance)

## What Users Experience

### Normal Operation
- No visible difference
- Connection happens seamlessly
- Slight delay (< 1 second) for verification

### MITM Attack Detected
- Alert: "Security Error: Could not verify server identity"
- Connection refused
- User protected from attack

### Configuration Error
- Alert: "Server identity verification failed"
- Connection refused
- Check server logs and configuration

## Technical Details

### Algorithm
- **Key Type:** RSA 2048-bit
- **Signature:** RSA-PSS with SHA-256
- **Challenge:** 32 random bytes
- **Verification:** Client-side using Web Crypto API

### Message Flow
```
Client                          Server
  |                               |
  |-- verify-server-identity -->  |
  |    (random challenge)          |
  |                               |
  |  <-- server-identity-verified-|
  |      (signed challenge)        |
  |                               |
  |-- (verify signature) -------> |
  |                               |
  |-- (continue if valid) ------> |
```

### Performance Impact
- Initial verification: ~100-200ms
- No impact after verification
- Minimal CPU usage
- No ongoing overhead

## FAQ

**Q: Do users need to install anything?**
A: No, it's completely transparent to users.

**Q: What if I lose the private key?**
A: Generate new keys and redeploy the client with new public key.

**Q: Can I use this with Cloudflare Tunnel?**
A: Yes! This protects against Cloudflare itself being compromised.

**Q: Does this replace HTTPS?**
A: No, it's an additional layer on top of HTTPS.

**Q: How often should I rotate keys?**
A: Annually, or immediately if compromised.

**Q: What's the performance impact?**
A: Minimal - one-time verification adds ~100-200ms on connection.

**Q: Can attackers bypass this?**
A: Not without your private key. That's why keeping it secure is critical.

## Support

For issues or questions:
1. Check server logs
2. Check browser console
3. Review this guide
4. Verify key configuration
5. Test with pinning disabled to isolate issue
