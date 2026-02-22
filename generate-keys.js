#!/usr/bin/env node
import { generateKeyPairSync } from 'crypto';
import { writeFileSync } from 'fs';

console.log('Generating server identity keys for certificate pinning...\n');

// Generate RSA key pair for server identity verification
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem'
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem'
  }
});

// Save private key (keep secret on server)
writeFileSync('./server-identity-private.pem', privateKey);
console.log('✓ Private key saved to: server-identity-private.pem');
console.log('  (Keep this secret! Never commit to git!)');

// Save public key (will be pinned in client)
writeFileSync('./server-identity-public.pem', publicKey);
console.log('✓ Public key saved to: server-identity-public.pem');

// Extract public key for pinning in client
const publicKeyBase64 = publicKey
  .replace(/-----BEGIN PUBLIC KEY-----/, '')
  .replace(/-----END PUBLIC KEY-----/, '')
  .replace(/\n/g, '');

console.log('\n' + '='.repeat(60));
console.log('COPY THIS TO client.js (PINNED_SERVER_PUBLIC_KEY):');
console.log('='.repeat(60));
console.log(publicKeyBase64);
console.log('='.repeat(60));

console.log('\n✓ Setup complete!');
console.log('\nNext steps:');
console.log('1. Copy the public key above to client.js');
console.log('2. Add server-identity-private.pem to .gitignore');
console.log('3. Restart your server');
