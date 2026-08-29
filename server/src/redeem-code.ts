import crypto from 'node:crypto';

function normalized(value: string) {
  return value.trim();
}

function keyFromSecret(secret: string) {
  return crypto.createHash('sha256').update('dandan-shop-redeem-code\0').update(secret).digest();
}

export function encryptRedeemCode(value: string, secret: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFromSecret(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(normalized(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), ciphertext.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
}

export function decryptRedeemCode(value: string, secret: string) {
  try {
    const [version, iv, ciphertext, authTag, ...rest] = value.split('.');
    if (version !== 'v1' || !iv || !ciphertext || !authTag || rest.length) throw new Error('invalid');
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFromSecret(secret), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(authTag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('INVALID_REDEEM_CODE_CIPHERTEXT');
  }
}

export function hashRedeemCode(value: string) {
  return crypto.createHash('sha256').update(normalized(value)).digest('hex');
}

export function maskRedeemCode(value: string) {
  const clean = normalized(value);
  if (clean.length <= 8) return `${clean.slice(0, 2)}****${clean.slice(-2)}`;
  return `${clean.slice(0, 3)}-****-${clean.slice(-4)}`;
}
