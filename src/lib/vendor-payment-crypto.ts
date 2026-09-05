import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

function key() {
  return createHash('sha256')
    .update(process.env.VENDOR_PAYMENT_ENCRYPTION_KEY || process.env.JWT_SECRET || 'hook-development-payment-key')
    .digest();
}

export function encryptVendorAccountNumber(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptVendorAccountNumber(value: string) {
  const [ivValue, tagValue, encryptedValue] = value.split('.');
  if (!ivValue || !tagValue || !encryptedValue) throw new Error('Invalid vendor account encryption');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]).toString('utf8');
}
