import { describe, expect, it } from 'vitest';
import { decryptRedeemCode, encryptRedeemCode, hashRedeemCode, maskRedeemCode } from '../src/redeem-code.js';

describe('redeem code protection', () => {
  const secret = 'a-dedicated-test-secret-that-is-long-enough';

  it('encrypts a code with authenticated encryption and decrypts it for fulfillment', () => {
    const encrypted = encryptRedeemCode('EGG-2026-SECRET', secret);
    expect(encrypted).not.toContain('EGG-2026-SECRET');
    expect(decryptRedeemCode(encrypted, secret)).toBe('EGG-2026-SECRET');
  });

  it('uses a stable hash for deduplication and a non-secret display mask', () => {
    expect(hashRedeemCode(' EGG-2026-SECRET ')).toBe(hashRedeemCode('EGG-2026-SECRET'));
    expect(maskRedeemCode('EGG-2026-SECRET')).toBe('EGG-****-CRET');
  });

  it('rejects ciphertext that was changed after encryption', () => {
    const encrypted = encryptRedeemCode('EGG-2026-SECRET', secret);
    const parts = encrypted.split('.');
    parts[2] = `${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`;
    expect(() => decryptRedeemCode(parts.join('.'), secret)).toThrow('INVALID_REDEEM_CODE_CIPHERTEXT');
  });
});
