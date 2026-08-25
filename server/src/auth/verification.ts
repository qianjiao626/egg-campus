import crypto from 'node:crypto';

export type VerificationChannel = 'sms' | 'email';
export type VerificationPurpose = 'register' | 'reset_password' | 'bind_phone' | 'bind_email';

export function generateVerificationCode() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function hashVerificationValue(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function randomVerificationToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function normalizeVerificationTarget(channel: VerificationChannel, target: string) {
  const value = target.trim();
  return channel === 'email' ? value.toLowerCase() : value.replace(/[\s-]/g, '');
}

export function isVerificationExpired(expiresAt: Date, now = new Date()) {
  return expiresAt.getTime() <= now.getTime();
}
