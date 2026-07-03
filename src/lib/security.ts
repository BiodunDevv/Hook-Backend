import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const SALT_ROUNDS = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Generate a short alphanumeric Hook ID (HID) e.g. BAL-SHK-089 */
export function generateHookId(market: string, category: string, seq: number): string {
  const marketCode = market.substring(0, 3).toUpperCase();
  const categoryCode = category.substring(0, 3).toUpperCase();
  return `${marketCode}-${categoryCode}-${String(seq).padStart(3, '0')}`;
}

/** Generate a sequential QR code ref for Pack-and-Tag */
export function generateQrRef(prefix: string, seq: number): string {
  return `HK-${prefix}-${String(seq).padStart(6, '0')}`;
}

export function generateOtp(length = 4): string {
  return Math.floor(1000 + Math.random() * 9000).toString().substring(0, length);
}

export function generateUuid(): string {
  return uuidv4();
}

export function calculateCommission(amount: number, percentage = 15): number {
  return (amount * percentage) / 100;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
