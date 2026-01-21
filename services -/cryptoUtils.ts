export const CryptoUtils = {
  generateRandomId: (): string => {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  },

  // Derive a key from a password using PBKDF2
  deriveKey: async (password: string, salt: Uint8Array): Promise<CryptoKey> => {
    const encoder = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveBits", "deriveKey"]
    );
    return window.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: salt,
        iterations: 100000,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
  },

  // Encrypt text using AES-GCM
  encrypt: async (text: string, password: string): Promise<string> => {
    const encoder = new TextEncoder();
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const key = await CryptoUtils.deriveKey(password, salt);
    
    const encrypted = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      key,
      encoder.encode(text)
    );

    // Combine Salt + IV + Ciphertext
    const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    combined.set(salt);
    combined.set(iv, salt.length);
    combined.set(new Uint8Array(encrypted), salt.length + iv.length);

    // Convert to Base64
    return btoa(String.fromCharCode(...combined));
  },

  // Decrypt text using AES-GCM
  decrypt: async (encryptedBase64: string, password: string): Promise<string> => {
    try {
      const binaryStr = atob(encryptedBase64);
      const combined = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) combined[i] = binaryStr.charCodeAt(i);

      // Extract parts
      const salt = combined.slice(0, 16);
      const iv = combined.slice(16, 28);
      const data = combined.slice(28);

      const key = await CryptoUtils.deriveKey(password, salt);
      const decrypted = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        key,
        data
      );

      const decoder = new TextDecoder();
      return decoder.decode(decrypted);
    } catch (e) {
      console.error("Decryption failed", e);
      throw new Error("Invalid password or corrupted data");
    }
  }
};
