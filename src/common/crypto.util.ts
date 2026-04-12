import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ENCRYPTION_KEY_ENV = 'SETTINGS_ENCRYPTION_KEY';
const IV_BYTE_LENGTH = 12;
const AUTH_TAG_BYTE_LENGTH = 16;

export function getSettingsEncryptionKey(): Buffer {
  const rawValue = process.env[ENCRYPTION_KEY_ENV]?.trim();

  if (!rawValue) {
    throw new Error(
      `${ENCRYPTION_KEY_ENV} is required. Generate a 32-byte hex key with "openssl rand -hex 32".`,
    );
  }

  if (!/^[0-9a-fA-F]{64}$/.test(rawValue)) {
    throw new Error(
      `${ENCRYPTION_KEY_ENV} must be a 64-character hex string (32 bytes).`,
    );
  }

  return Buffer.from(rawValue, 'hex');
}

export function encryptSettingsValue(plaintext: string): string {
  const iv = randomBytes(IV_BYTE_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', getSettingsEncryptionKey(), iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

export function decryptSettingsValue(encoded: string): string {
  const [ivHex, authTagHex, ciphertextHex] = encoded.split(':');

  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error('Encrypted settings value is malformed.');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  if (iv.length !== IV_BYTE_LENGTH) {
    throw new Error('Encrypted settings value has an invalid IV.');
  }

  if (authTag.length !== AUTH_TAG_BYTE_LENGTH) {
    throw new Error('Encrypted settings value has an invalid auth tag.');
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    getSettingsEncryptionKey(),
    iv,
  );
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return plaintext.toString('utf8');
}
