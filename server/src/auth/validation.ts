import { z } from 'zod';

export const verificationChannelSchema = z.enum(['sms', 'email']);
export const verificationPurposeSchema = z.enum(['register', 'reset_password', 'bind_phone', 'bind_email']);

const verificationRequestBaseSchema = z.object({
  channel: verificationChannelSchema,
  target: z.string().trim().min(5).max(100),
  purpose: verificationPurposeSchema,
});

const verificationTargetRules = (value: z.infer<typeof verificationRequestBaseSchema>, ctx: z.RefinementCtx) => {
  if (value.channel === 'sms' && !/^1\d{10}$/.test(value.target.replace(/[\s-]/g, ''))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['target'], message: '手机号格式不正确' });
  }
  if (value.channel === 'email' && !z.string().email().safeParse(value.target).success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['target'], message: '邮箱格式不正确' });
  }
};

export const verificationRequestSchema = verificationRequestBaseSchema.superRefine(verificationTargetRules);

export const passwordResetRequestSchema = z.object({
  channel: verificationChannelSchema,
  target: z.string().trim().min(5).max(100),
}).superRefine((value, ctx) => verificationTargetRules({ ...value, purpose: 'reset_password' }, ctx));

export const verificationVerifySchema = verificationRequestBaseSchema.extend({
  code: z.string().regex(/^\d{6}$/),
}).superRefine(verificationTargetRules);

export const verificationTokenSchema = verificationRequestBaseSchema.extend({
  verificationToken: z.string().trim().min(40).max(128),
}).superRefine(verificationTargetRules);

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(40).max(200).optional(),
});

export const passwordResetConfirmSchema = z.object({
  channel: verificationChannelSchema,
  target: z.string().trim().min(5).max(100),
  verificationToken: z.string().trim().min(40).max(128),
  newPassword: z.string().min(8).max(128),
}).superRefine((value, ctx) => verificationTargetRules({ ...value, purpose: 'reset_password' }, ctx));

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();

export const registerSchema = z.object({
  nickname: z.string().trim().min(2).max(50),
  email: z.string().trim().email().max(100).optional().nullable(),
  password: z.string().min(8).max(128),
  verificationToken: z.string().trim().min(40).max(128).optional().nullable(),
  phone: z.string().trim().regex(/^1\d{10}$/).optional(),
  school: optionalText(100),
  major: optionalText(100),
  city: optionalText(50),
  grade: optionalText(20),
  age: z.number().int().min(13).max(100).optional().nullable(),
  mbtiType: z.string().trim().length(4).toUpperCase().optional().nullable(),
  mbtiGroup: z.enum(['NT', 'NF', 'SJ', 'SP']).optional().nullable(),
  eggCategory: z.enum(['study', 'job', 'side', 'hobby', 'game', 'life']).optional(),
});

export const loginSchema = z.object({
  identifier: z.string().trim().min(2).max(100),
  password: z.string().min(1).max(128),
});

export const profileUpdateSchema = z.object({
  nickname: z.string().trim().min(2).max(50).optional(),
  email: z.string().trim().email().max(100).optional().nullable(),
  phone: z.string().trim().regex(/^1\d{10}$/).optional().nullable(),
  school: optionalText(100),
  major: optionalText(100),
  city: optionalText(50),
  grade: optionalText(20),
  age: z.number().int().min(13).max(100).optional().nullable(),
  bio: optionalText(2000),
  mbtiType: z.string().trim().length(4).toUpperCase().optional().nullable(),
  mbtiGroup: z.enum(['NT', 'NF', 'SJ', 'SP']).optional().nullable(),
});

export type RegisterInput = z.infer<typeof registerSchema>;

export function publicUserShape(user: {
  id: number | bigint;
  nickname: string;
  email?: string | null;
  phone?: string | null;
  passwordHash?: string;
  role: string;
  status: string;
  school?: string | null;
  major?: string | null;
  city?: string | null;
  grade?: string | null;
  age?: number | null;
  bio?: string | null;
  mbtiType?: string | null;
  mbtiGroup?: string | null;
  likes: number;
  reputation: unknown;
  eggCategory?: string | null;
  eggRarity: string;
  inviteCode?: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date | null;
}) {
  return {
    id: typeof user.id === 'bigint' ? user.id.toString() : user.id,
    nickname: user.nickname,
    role: user.role,
    status: user.status,
    school: user.school ?? null,
    major: user.major ?? null,
    city: user.city ?? null,
    grade: user.grade ?? null,
    age: user.age ?? null,
    bio: user.bio ?? null,
    mbtiType: user.mbtiType ?? null,
    mbtiGroup: user.mbtiGroup ?? null,
    likes: user.likes,
    reputation: Number(user.reputation),
    eggCategory: user.eggCategory ?? null,
    eggRarity: user.eggRarity,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt ?? null,
  };
}

export function privateUserShape(user: Parameters<typeof publicUserShape>[0]) {
  return {
    ...publicUserShape(user),
    email: user.email ?? null,
    phone: user.phone ?? null,
    inviteCode: user.inviteCode ?? null,
  };
}
