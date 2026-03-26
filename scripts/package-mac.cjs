#!/usr/bin/env node
'use strict';

const { cpSync, mkdirSync, rmSync, existsSync } = require('fs');
const { join } = require('path');
const { execSync } = require('child_process');

const ROOT = join(__dirname, '..');
const OUT  = join(ROOT, 'dist', 'secure-meeting-macos');

// Clean previous package
if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });

// Copy executable
cpSync(join(ROOT, 'dist', 'secure-meeting-mac'), join(OUT, 'secure-meeting-mac'));
execSync(`chmod +x "${join(OUT, 'secure-meeting-mac')}"`);

// Copy assets
const assets = ['index.html', 'client.js', 'crypto.js', 'styles.css',
                 'server-identity-private.pem', 'server-identity-public.pem'];
for (const f of assets) {
  cpSync(join(ROOT, f), join(OUT, f));
}

// Copy ssl folder
cpSync(join(ROOT, 'ssl'), join(OUT, 'ssl'), { recursive: true });

// Zip it up
const zipName = 'secure-meeting-macos.zip';
execSync(`cd "${join(ROOT, 'dist')}" && zip -r "${zipName}" secure-meeting-macos`);
rmSync(OUT, { recursive: true }); // remove folder, keep zip

console.log(`\n✓ Package ready: dist/${zipName}`);
console.log('  Contents: executable + html/css/js + ssl certs');
