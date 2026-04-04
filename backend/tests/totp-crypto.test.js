// Unit tests for totp-crypto.ts
// SECURITY: TOTP secrets encrypted at rest with AES-256-GCM
// Run with: npx vitest backend/tests/totp-crypto.test.js

import { describe, it, expect } from 'vitest';
import {
  encryptTotpSecret,
  decryptTotpSecret,
  isEncrypted,
  migrateToEncrypted
} from '../totp-crypto.ts';

describe('TOTP Crypto', () => {
  describe('encryptTotpSecret()', () => {
    it('should encrypt a base32 TOTP secret', () => {
      const plainSecret = 'JBSWY3DPEBLW64TMMQ======';
      const encrypted = encryptTotpSecret(plainSecret);
      expect(encrypted).toBeDefined();
      expect(encrypted).toMatch(/^enc:v1:/);
    });

    it('should return different ciphertext each time (random IV)', () => {
      const plainSecret = 'JBSWY3DPEBLW64TMMQ======';
      const encrypted1 = encryptTotpSecret(plainSecret);
      const encrypted2 = encryptTotpSecret(plainSecret);
      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should throw on invalid input', () => {
      expect(() => encryptTotpSecret(null)).toThrow();
      expect(() => encryptTotpSecret('')).toThrow();
      expect(() => encryptTotpSecret(123)).toThrow();
    });
  });

  describe('decryptTotpSecret()', () => {
    it('should decrypt an encrypted TOTP secret', () => {
      const plainSecret = 'JBSWY3DPEBLW64TMMQ======';
      const encrypted = encryptTotpSecret(plainSecret);
      const decrypted = decryptTotpSecret(encrypted);
      expect(decrypted).toBe(plainSecret);
    });

    it('should handle legacy plaintext base32 (no encryption)', () => {
      const legacyPlaintext = 'JBSWY3DPEBLW64TMMQ======';
      const result = decryptTotpSecret(legacyPlaintext);
      expect(result).toBe(legacyPlaintext);
    });

    it('should return null on invalid encrypted format', () => {
      const malformed = 'enc:v1:bad:data';
      const result = decryptTotpSecret(malformed);
      expect(result).toBeNull();
    });

    it('should return null on null or non-string input', () => {
      expect(decryptTotpSecret(null)).toBeNull();
      expect(decryptTotpSecret(undefined)).toBeNull();
      expect(decryptTotpSecret(123)).toBeNull();
    });

    it('should handle tampered ciphertext (auth tag validation)', () => {
      const plainSecret = 'JBSWY3DPEBLW64TMMQ======';
      const encrypted = encryptTotpSecret(plainSecret);
      const corrupted = encrypted.slice(0, -2) + 'XX';
      const result = decryptTotpSecret(corrupted);
      expect(result).toBeNull();
    });
  });

  describe('isEncrypted()', () => {
    it('should return true for encrypted format', () => {
      const plainSecret = 'JBSWY3DPEBLW64TMMQ======';
      const encrypted = encryptTotpSecret(plainSecret);
      expect(isEncrypted(encrypted)).toBe(true);
    });

    it('should return false for plaintext', () => {
      const plaintext = 'JBSWY3DPEBLW64TMMQ======';
      expect(isEncrypted(plaintext)).toBe(false);
    });

    it('should return false for null or non-string', () => {
      expect(isEncrypted(null)).toBe(false);
      expect(isEncrypted(undefined)).toBe(false);
      expect(isEncrypted(123)).toBe(false);
    });
  });

  describe('migrateToEncrypted()', () => {
    it('should migrate plaintext TOTP secret to encrypted format', () => {
      const plainSecret = 'JBSWY3DPEBLW64TMMQ======';
      const migrated = migrateToEncrypted(plainSecret);
      expect(migrated).toBeDefined();
      expect(isEncrypted(migrated)).toBe(true);
      expect(decryptTotpSecret(migrated)).toBe(plainSecret);
    });

    it('should return null if already encrypted', () => {
      const plainSecret = 'JBSWY3DPEBLW64TMMQ======';
      const encrypted = encryptTotpSecret(plainSecret);
      const result = migrateToEncrypted(encrypted);
      expect(result).toBeNull();
    });

    it('should return null on invalid input', () => {
      expect(migrateToEncrypted(null)).toBeNull();
      expect(migrateToEncrypted('')).toBeNull();
      expect(migrateToEncrypted(undefined)).toBeNull();
    });
  });
});
