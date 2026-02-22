// End-to-end encryption for signaling using Web Crypto API
export class E2EEncryption {
  constructor() {
    this.keyPair = null;
    this.peerPublicKeys = new Map();
    this.sharedSecrets = new Map();
  }

  // Generate ECDH key pair for this client
  async generateKeyPair() {
    this.keyPair = await crypto.subtle.generateKey(
      {
        name: 'ECDH',
        namedCurve: 'P-256'
      },
      true,
      ['deriveKey', 'deriveBits']
    );
  }

  // Export public key to share with peers
  async exportPublicKey() {
    const exported = await crypto.subtle.exportKey('raw', this.keyPair.publicKey);
    return this.arrayBufferToBase64(exported);
  }

  // Import peer's public key
  async importPeerPublicKey(peerId, publicKeyBase64) {
    const publicKeyBuffer = this.base64ToArrayBuffer(publicKeyBase64);
    const publicKey = await crypto.subtle.importKey(
      'raw',
      publicKeyBuffer,
      {
        name: 'ECDH',
        namedCurve: 'P-256'
      },
      true,
      []
    );
    this.peerPublicKeys.set(peerId, publicKey);
    
    // Derive shared secret
    await this.deriveSharedSecret(peerId);
  }

  // Derive shared AES key with peer
  async deriveSharedSecret(peerId) {
    const peerPublicKey = this.peerPublicKeys.get(peerId);
    if (!peerPublicKey) throw new Error('Peer public key not found');

    const sharedSecret = await crypto.subtle.deriveKey(
      {
        name: 'ECDH',
        public: peerPublicKey
      },
      this.keyPair.privateKey,
      {
        name: 'AES-GCM',
        length: 256
      },
      false,
      ['encrypt', 'decrypt']
    );

    this.sharedSecrets.set(peerId, sharedSecret);
  }

  // Encrypt message for specific peer
  async encrypt(peerId, data) {
    const sharedSecret = this.sharedSecrets.get(peerId);
    if (!sharedSecret) throw new Error('Shared secret not established');

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encodedData = new TextEncoder().encode(JSON.stringify(data));

    const encrypted = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      sharedSecret,
      encodedData
    );

    return {
      iv: this.arrayBufferToBase64(iv),
      data: this.arrayBufferToBase64(encrypted)
    };
  }

  // Decrypt message from peer
  async decrypt(peerId, encryptedMessage) {
    const sharedSecret = this.sharedSecrets.get(peerId);
    if (!sharedSecret) throw new Error('Shared secret not established');

    const iv = this.base64ToArrayBuffer(encryptedMessage.iv);
    const data = this.base64ToArrayBuffer(encryptedMessage.data);

    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      sharedSecret,
      data
    );

    const decodedData = new TextDecoder().decode(decrypted);
    return JSON.parse(decodedData);
  }

  // Helper: ArrayBuffer to Base64
  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  // Helper: Base64 to ArrayBuffer
  base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // Clean up peer keys when they leave
  removePeer(peerId) {
    this.peerPublicKeys.delete(peerId);
    this.sharedSecrets.delete(peerId);
  }
}
