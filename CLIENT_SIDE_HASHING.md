# Client-Side Passphrase Hashing

## Overview

Passphrases are now hashed on the client-side before being sent to the server. This means the server never sees the plaintext password, providing an additional layer of security.

## How It Works

### Traditional Approach (Insecure)
```
User enters: "mypassword"
   ↓
Sent to server: "mypassword" (plaintext!)
   ↓
Server hashes: SHA-256("mypassword")
   ↓
Stored: "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8"
```

**Problem:** Server sees plaintext password and could log it, store it, or be compromised.

### Client-Side Hashing (Secure)
```
User enters: "mypassword"
   ↓
Client hashes: SHA-256("mypassword")
   ↓
Sent to server: "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8"
   ↓
Server stores: "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8"
```

**Benefit:** Server never sees plaintext password!

## Implementation Details

### Client-Side (client.js)

```javascript
async hashPassphrase(passphrase) {
  // Use SHA-256 to hash the passphrase client-side
  const encoder = new TextEncoder();
  const data = encoder.encode(passphrase);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}
```

**When hashing occurs:**
1. Creating a meeting with passphrase
2. Joining a meeting with passphrase
3. Setting/updating meeting passphrase

### Server-Side (server.js)

The server now:
- Receives already-hashed passphrases
- Stores them as-is (no double hashing)
- Compares hashes directly for authentication

```javascript
// Old approach (removed)
const passphraseHash = hashPassphrase(passphrase); // Server-side hashing

// New approach
const passphraseHash = passphrase; // Already hashed client-side
```

## Security Benefits

### 1. Server Never Sees Plaintext
- Even if server is compromised, attacker doesn't get plaintext passwords
- Server logs won't contain plaintext passwords
- Database breaches (if you add one) won't expose passwords

### 2. Protection Against Server Operator
- Server operator can't see user passwords
- Reduces insider threat risk
- Better privacy for users

### 3. Network Interception
- Even if HTTPS is compromised, attacker only sees hash
- Hash can't be reversed to get original password
- Still need the hash to authenticate, but can't use it elsewhere

### 4. Compliance
- Better compliance with data protection regulations
- Demonstrates security best practices
- Reduces liability for password storage

## Limitations

### Not a Complete Solution

**Important:** Client-side hashing alone doesn't prevent all attacks:

1. **Replay Attacks**: Attacker can capture hash and replay it
   - Mitigated by: Rate limiting, tokens, session management
   
2. **Hash is the Password**: The hash becomes the effective password
   - Attacker with hash can authenticate
   - But can't use password on other sites (if user reused it)

3. **Weak Passwords**: Hashing doesn't make weak passwords strong
   - "password123" is still weak even when hashed
   - Consider adding password strength requirements

4. **No Salt**: Simple SHA-256 without salt
   - Rainbow tables could work for common passwords
   - For production, consider adding per-user salts

## Best Practices

### For Users
- Use strong, unique passwords
- Don't reuse passwords from other sites
- Change passwords if you suspect compromise

### For Developers

**Current Implementation:**
```javascript
// Simple SHA-256 hash
hash = SHA-256(password)
```

**Production Enhancement (Optional):**
```javascript
// Add salt for better security
hash = SHA-256(password + roomId + salt)
```

This prevents:
- Rainbow table attacks
- Cross-room password reuse detection
- Precomputed hash attacks

## Technical Details

### Algorithm
- **Hash Function:** SHA-256
- **Output:** 64 hexadecimal characters
- **Encoding:** UTF-8 before hashing
- **API:** Web Crypto API (crypto.subtle.digest)

### Performance
- **Hashing Time:** < 1ms (negligible)
- **Network Impact:** None (same data size)
- **User Experience:** No noticeable delay

### Browser Compatibility
- **Web Crypto API:** Supported in all modern browsers
- **Fallback:** None needed (required for WebRTC anyway)
- **HTTPS Required:** Yes (Web Crypto API requires secure context)

## Message Flow

### Creating Meeting with Passphrase

```
Client                          Server
  |                               |
  | User enters "mypassword"      |
  | Hash: SHA-256("mypassword")   |
  | = "5e884898..."               |
  |                               |
  |-- create-room --------------> |
  |   passphrase: "5e884898..."   |
  |                               |
  |                               | Store: "5e884898..."
  |                               |
  | <-- room-created ------------ |
  |     hasPassphrase: true       |
```

### Joining Meeting with Passphrase

```
Client                          Server
  |                               |
  | User enters "mypassword"      |
  | Hash: SHA-256("mypassword")   |
  | = "5e884898..."               |
  |                               |
  |-- join-room ----------------> |
  |   passphrase: "5e884898..."   |
  |                               |
  |                               | Compare: "5e884898..." == stored
  |                               |
  | <-- room-joined ------------- | (if match)
  |                               |
  | <-- error ------------------- | (if no match)
  |     "Incorrect passphrase"    |
```

## Comparison with Alternatives

### vs. Server-Side Hashing Only
- **Server-Side:** Server sees plaintext
- **Client-Side:** Server never sees plaintext
- **Winner:** Client-side (more secure)

### vs. End-to-End Encryption
- **E2E:** Encrypts content, not authentication
- **Client Hashing:** Protects authentication credentials
- **Winner:** Both (complementary, not alternatives)

### vs. OAuth/SSO
- **OAuth:** Requires external identity provider
- **Client Hashing:** Self-contained, no dependencies
- **Winner:** Depends on use case (OAuth for enterprise, hashing for simplicity)

### vs. Password Managers
- **Password Managers:** Help users create/store strong passwords
- **Client Hashing:** Protects passwords in transit/storage
- **Winner:** Both (complementary)

## Migration Notes

### Existing Meetings

If you had meetings with server-side hashed passwords:

**Option 1: Force Reset**
- All existing passphrases become invalid
- Users must set new passphrases
- Simple but disruptive

**Option 2: Dual Mode (Not Implemented)**
- Support both old and new hashing
- Gradually migrate users
- More complex

**Current Implementation:** Option 1 (clean slate)

Since meetings are ephemeral, this isn't an issue - all meetings are temporary anyway.

## Testing

### Verify Client-Side Hashing

1. Open browser developer tools
2. Go to Network tab
3. Create meeting with passphrase "test123"
4. Check WebSocket messages
5. Verify you see hash, not "test123"

**Expected:**
```json
{
  "type": "create-room",
  "passphrase": "ecd71870d1963316a97e3ac3408c9835ad8cf0f3c1bc703527c30265534f75ae"
}
```

**Not:**
```json
{
  "type": "create-room",
  "passphrase": "test123"
}
```

### Test Authentication

1. Create meeting with passphrase "mypassword"
2. Try joining with "mypassword" - should work
3. Try joining with "wrongpassword" - should fail
4. Check server logs - should never see plaintext

## Security Considerations

### What This Protects Against
✓ Server operator seeing passwords
✓ Server logs containing passwords
✓ Database breaches exposing passwords
✓ Network sniffing (with HTTPS)
✓ Password reuse on other sites

### What This Doesn't Protect Against
✗ Weak passwords
✗ Replay attacks (hash can be reused)
✗ Client-side malware
✗ Phishing attacks
✗ Brute force (still need rate limiting)

### Additional Recommendations

1. **Add Salt:** Include room ID in hash
   ```javascript
   hash = SHA-256(password + roomId)
   ```

2. **Key Derivation:** Use PBKDF2 or Argon2
   ```javascript
   hash = PBKDF2(password, salt, iterations)
   ```

3. **Password Strength:** Enforce minimum requirements
   ```javascript
   if (password.length < 8) {
     alert('Password must be at least 8 characters');
   }
   ```

4. **Rate Limiting:** Already implemented (5 attempts per minute)

## FAQ

**Q: Why not use bcrypt or Argon2?**
A: Those are designed for server-side hashing with salts. For client-side, SHA-256 is sufficient and widely supported.

**Q: Can the hash be reversed?**
A: No, SHA-256 is a one-way function. The original password cannot be recovered from the hash.

**Q: What if someone captures the hash?**
A: They can authenticate to that specific meeting, but can't use the password elsewhere. Rate limiting prevents brute force.

**Q: Should I add a salt?**
A: For production, yes. Use room ID as salt to prevent rainbow tables and cross-room attacks.

**Q: Does this replace HTTPS?**
A: No, HTTPS is still required. This is an additional layer of security.

**Q: What about password strength?**
A: Client-side hashing doesn't make weak passwords strong. Consider adding strength requirements.

**Q: Is this GDPR compliant?**
A: It helps with GDPR by minimizing data exposure, but consult legal counsel for full compliance.

**Q: What's the performance impact?**
A: Negligible - SHA-256 hashing takes less than 1ms.

## Summary

Client-side passphrase hashing is now implemented, providing:
- Server never sees plaintext passwords
- Better privacy for users
- Reduced risk from server compromise
- Compliance with security best practices
- No user-facing changes (transparent)

The implementation uses SHA-256 via the Web Crypto API and is compatible with all modern browsers.
