#!/usr/bin/env node
import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';

console.log('Generating self-signed SSL certificate for HTTPS...\n');

// Create ssl directory if it doesn't exist
if (!existsSync('./ssl')) {
  mkdirSync('./ssl');
  console.log('✓ Created ssl/ directory');
}

try {
  // Generate private key and certificate
  execSync(
    'openssl req -x509 -newkey rsa:2048 -nodes ' +
    '-keyout ssl/private-key.pem ' +
    '-out ssl/certificate.pem ' +
    '-days 365 ' +
    '-subj "/C=US/ST=State/L=City/O=Organization/CN=localhost" ' +
    '-addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:192.168.50.157"',
    { stdio: 'inherit' }
  );

  console.log('\n✓ SSL certificate generated successfully!');
  console.log('\nFiles created:');
  console.log('  - ssl/private-key.pem (private key)');
  console.log('  - ssl/certificate.pem (certificate)');
  console.log('\n⚠️  Note: This is a self-signed certificate.');
  console.log('    Browsers will show a security warning.');
  console.log('    Click "Advanced" → "Proceed to localhost" to continue.');
  console.log('\n✓ Setup complete! Run "npm start" to start the HTTPS server.');

} catch (error) {
  console.error('\n❌ Error generating certificate:');
  console.error(error.message);
  console.error('\nMake sure OpenSSL is installed:');
  console.error('  macOS: brew install openssl');
  console.error('  Linux: sudo apt-get install openssl');
  console.error('  Windows: Download from https://slproweb.com/products/Win32OpenSSL.html');
  process.exit(1);
}
