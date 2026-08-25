import { describe, expect, it } from 'vitest';
import {
  publicUserShape,
  registerSchema,
  passwordResetConfirmSchema,
} from '../src/auth/validation.js';

describe('user registration validation', () => {
  it('rejects a short password and malformed email', () => {
    const result = registerSchema.safeParse({
      nickname: '小明',
      email: 'not-an-email',
      password: '123',
      verificationToken: 'verification-token-that-is-long-enough-1234567890',
    });

    expect(result.success).toBe(false);
  });

  it('accepts the minimum registration profile', () => {
    const result = registerSchema.safeParse({
      nickname: '小明',
      email: 'xiaoming@example.com',
      password: 'correct horse battery staple',
      verificationToken: 'verification-token-that-is-long-enough-1234567890',
    });

    expect(result.success).toBe(true);
  });

  it('accepts a nickname and self-set password without contact verification', () => {
    const result = registerSchema.safeParse({
      nickname: '无邮箱用户',
      password: 'correct horse battery staple',
    });

    expect(result.success).toBe(true);
  });
});

describe('public user projection', () => {
  it('does not expose credentials or private contact fields', () => {
    const result = publicUserShape({
      id: 1,
      nickname: '小明',
      email: 'xiaoming@example.com',
      phone: '13800000000',
      passwordHash: 'secret-hash',
      role: 'student',
      status: 'active',
      school: '某大学',
      major: '计算机',
      city: '杭州',
      grade: '大三',
      age: 21,
      bio: '简介',
      mbtiType: 'INTP',
      mbtiGroup: 'NT',
      likes: 2,
      reputation: 4.8,
      eggCategory: 'study',
      eggRarity: 'N',
      inviteCode: 'ABC123',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      lastLoginAt: null,
    });

    expect(result).toEqual(expect.objectContaining({ id: 1, nickname: '小明' }));
    expect(result).not.toHaveProperty('email');
    expect(result).not.toHaveProperty('phone');
    expect(result).not.toHaveProperty('passwordHash');
    expect(result).not.toHaveProperty('inviteCode');
  });
});

describe('password reset confirmation validation', () => {
  it('uses the fixed reset purpose instead of requiring a client-supplied purpose', () => {
    const result = passwordResetConfirmSchema.safeParse({
      channel: 'email',
      target: 'user@example.com',
      verificationToken: 'verification-token-that-is-long-enough-1234567890',
      newPassword: 'new-password-123',
    });
    expect(result.success).toBe(true);
  });
});
