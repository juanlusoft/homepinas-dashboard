/**
 * HomePiNAS - TOTP Secret Encryption (AES-256-GCM)
 *
 * SECURITY FIX: CRIT-01 from AUDIT-HEIMDALL.md
 * TOTP secrets are encrypted at rest in data.json using AES-256-GCM.
 * The encryption key is derived from a server-side secret stored in a
 * separate file (not in data.json), so compromising the data file alone
 * does not expose TOTP secrets.
 *
 * Key derivation: PBKDF2(serverSecret, salt, 100000, 32, sha512)
 * Cipher: AES-256-GCM with random 16-byte IV and 16-byte auth tag
 * Format stored: "enc:v1:<salt_hex>:<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const log = require('./logger');

const SERVER_SECRET_PATH = path.join(__dirname, '..', 'config', '.totp-server-key');
const PBKDF2_ITERATIONS = 100000;
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const ENCRYPTED_PREFIX = 'enc:v1:';

/**
 * Get or create the server-side secret used for TOTP encryption.
 * This secret is stored separately from data.json.
 */
function getServerSecret() {
  try {
    if (fs.existsSync(SERVER_SECRET_PATH)) {
      return fs.readFileSync(SERVER_SECRET_PATH, 'utf8').trim();
    }
  } catch (e) {
    log.error('[TOTP-Crypto] Error reading server secret:', e.message);
  }

  // Generate a new server secret
  const secret = crypto.randomBytes(64).toString('hex');
  try {
    const dir = path.dirname(SERVER_SECRET_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(SERVER_SECRET_PATH, secret, { mode: 0o600 });
    log.info('[TOTP-Crypto] Generated new server secret for TOTP encryption');
  } catch (e) {
    log.error('[TOTP-Crypto] Failed to write server secret:', e.message);
    // Still return the secret for this session — encryption will work in memory
  }
  return secret;
}

/**
 * Derive an AES-256 key from the server secret and a salt.
 */
function deriveKey(serverSecret, salt) {
  return crypto.pbkdf2Sync(serverSecret, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha512');
}

/**
 * Encrypt a TOTP secret (Base32 string) for storage.
 * Returns: "enc:v1:<salt>:<iv>:<authTag>:<ciphertext>" (all hex)
 */
function encryptTotpSecret(plainBase32) {
  if (!plainBase32 || typeof plainBase32 !== 'string') {
    throw new Error('Invalid TOTP secret');
  }

  const serverSecret = getServerSecret();
  const salt = crypto.randomBytes(16);
  const key = deriveKey(serverSecret, salt);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plainBase32, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return `${ENCRYPTED_PREFIX}${salt.toString('hex')}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt a TOTP secret from storage.
 * Accepts both encrypted format and legacy plaintext Base32.
 * Returns the plaintext Base32 string.
 */
function decryptTotpSecret(stored) {
  if (!stored || typeof stored !== 'string') {
    return null;
  }

  // Legacy: if not encrypted, return as-is (plaintext Base32)
  if (!stored.startsWith(ENCRYPTED_PREFIX)) {
    return stored;
  }

  try {
    const withoutPrefix = stored.slice(ENCRYPTED_PREFIX.length);
    const parts = withoutPrefix.split(':');
    if (parts.length !== 4) {
      log.error('[TOTP-Crypto] Invalid encrypted format');
      return null;
    }

    const [saltHex, ivHex, authTagHex, ciphertext] = parts;
    const serverSecret = getServerSecret();
    const salt = Buffer.from(saltHex, 'hex');
    const key = deriveKey(serverSecret, salt);
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (e) {
    log.error('[TOTP-Crypto] Decryption failed:', e.message);
    return null;
  }
}

/**
 * Check if a stored value is already encrypted.
 */
function isEncrypted(stored) {
  return typeof stored === 'string' && stored.startsWith(ENCRYPTED_PREFIX);
}

/**
 * Migrate a plaintext TOTP secret to encrypted format.
 * Returns the encrypted string, or null if already encrypted or invalid.
 */
function migrateToEncrypted(stored) {
  if (!stored || isEncrypted(stored)) return null;
  return encryptTotpSecret(stored);
}

module.exports = {
  encryptTotpSecret,
  decryptTotpSecret,
  isEncrypted,
  migrateToEncrypted
};
