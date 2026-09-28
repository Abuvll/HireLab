import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

// Real AES-256-GCM encryption for secrets at rest — specifically the org's
// stored AI-provider API key (§3.32 of the integration checklist). This is
// NOT a placeholder: it's a genuine, working encryption implementation
// using Node's built-in crypto module. It does not require an external KMS
// to function correctly, though swapping ENCRYPTION_KEY for a KMS-managed
// data-encryption-key (decrypted via KMS at boot, never written to disk) is
// a reasonable hardening step once you have real infrastructure for it —
// the encrypt/decrypt call sites here don't need to change either way,
// only where getEncryptionKey() sources its 32-byte key from.
//
// ENCRYPTION_KEY must be a 32-byte key, base64-encoded, in the environment.
// Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
// Rotate by re-encrypting stored ciphertext with a new key during a
// maintenance window — there is no key-versioning here, so a rotation is
// an all-at-once re-encrypt, not a gradual rollover. Fine at this scale;
// revisit if that becomes operationally painful.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV is the GCM-recommended length

export class EncryptionConfigError extends Error {}

function getEncryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new EncryptionConfigError(
      "ENCRYPTION_KEY is not set. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\" and set it in your environment before storing any secrets."
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new EncryptionConfigError(
      `ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key.length}). It should be a base64-encoded 32-byte value.`
    );
  }
  return key;
}

// Encrypts plaintext, returning a single self-contained base64 string:
// [12-byte IV][16-byte auth tag][ciphertext]. Safe to store as a single
// database column.
export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export class DecryptionError extends Error {}

export function decryptSecret(encoded: string): string {
  const key = getEncryptionKey();
  const raw = Buffer.from(encoded, "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = raw.subarray(IV_LENGTH + 16);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch (err) {
    // GCM auth-tag verification failed — either the ciphertext was
    // tampered with, or ENCRYPTION_KEY has changed since this row was
    // written (e.g. wrong environment, or a rotation without re-encrypting
    // old rows). Surface a distinct error type so callers can tell "no key
    // saved" apart from "key saved but unreadable" in logs/alerts.
    throw new DecryptionError("Failed to decrypt secret — wrong key or corrupted ciphertext.", { cause: err });
  }
}

// Last 4 characters of the raw key, stored in plaintext purely so the UI
// can render "sk-or-v1-••••••••1234" without ever decrypting the real key
// for display purposes. Never derive this from decrypted data at read
// time — compute it once at save time and store it alongside the ciphertext.
export function last4(plaintext: string): string {
  return plaintext.slice(-4);
}

// Cryptographically random, URL-safe token for invite links / password
// resets — not related to AES above, but lives here since it's the same
// "security primitives" concern.
export function generateSecureToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  // Tokens are stored hashed (like passwords) so a DB read alone can't be
  // replayed as a valid invite/reset link — only the original emailed
  // value, which only the recipient has, hashes to the stored value.
  return createHash("sha256").update(token).digest("hex");
}
