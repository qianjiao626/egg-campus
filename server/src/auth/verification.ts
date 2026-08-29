import crypto from 'node:crypto';

export type VerificationChannel = 'email';
export type VerificationPurpose = 'register' | 'reset_password' | 'bind_email';

export function generateVerificationCode() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function hashVerificationValue(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function randomVerificationToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function normalizeVerificationTarget(_channel: VerificationChannel, target: string) {
  return target.trim().toLowerCase();
}

export function isVerificationExpired(expiresAt: Date, now = new Date()) {
  return expiresAt.getTime() <= now.getTime();
}
