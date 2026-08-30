import { z } from 'zod';

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();
const mbtiTypes = [
  'INTJ', 'INTP', 'ENTJ', 'ENTP',
  'INFJ', 'INFP', 'ENFJ', 'ENFP',
  'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ',
  'ISTP', 'ISFP', 'ESTP', 'ESFP',
] as const;
export const profileMbtiTypeSchema = z.enum(mbtiTypes);
const profileTag = z.string().trim().min(1).max(40);

export const profileUpdateSchema = z.object({
  nickname: z.string().trim().min(2).max(50).optional(),
  email: z.string().trim().email().max(100).toLowerCase().optional().nullable(),
  school: optionalText(100),
  major: optionalText(100),
  city: optionalText(50),
  grade: optionalText(20),
  age: z.number().int().min(13).max(100).optional().nullable(),
  bio: optionalText(2000),
  mbtiType: z.preprocess(
    (value) => typeof value === 'string' ? value.trim().toUpperCase() : value,
    profileMbtiTypeSchema.optional().nullable(),
  ),
  interests: z.array(profileTag).max(12).optional(),
  skills: z.array(profileTag).max(7).optional(),
}).strict();

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

export interface CurrentProfileIdentity {
  nickname: string;
  email: string | null;
  nicknameChangedAt: Date | null;
  protectedAdminKey: string | null;
}

export interface PreparedProfileUpdate {
  userData: Record<string, unknown>;
  buddyData: Record<string, unknown>;
}

export class ProfileRuleError extends Error {
  readonly code: 'NICKNAME_CHANGE_COOLDOWN' | 'PROTECTED_ADMIN_NICKNAME';
  readonly availableAt?: Date;

  constructor(code: ProfileRuleError['code'], availableAt?: Date) {
    super(code);
    this.name = 'ProfileRuleError';
    this.code = code;
    this.availableAt = availableAt;
  }
}

function uniqueTags(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function mbtiGroupFor(type: typeof mbtiTypes[number]): 'NT' | 'NF' | 'SJ' | 'SP' {
  if (type.includes('N')) return type.includes('T') ? 'NT' : 'NF';
  return type.includes('J') ? 'SJ' : 'SP';
}

export function prepareProfileUpdate(
  current: CurrentProfileIdentity,
  input: ProfileUpdateInput,
  now = new Date(),
): PreparedProfileUpdate {
  const userData: Record<string, unknown> = { ...input };
  const buddyData: Record<string, unknown> = {};

  if (input.nickname === undefined || input.nickname === current.nickname) {
    delete userData.nickname;
  }

  if (Object.prototype.hasOwnProperty.call(input, 'email')) {
    const nextEmail = input.email ?? null;
    if (nextEmail === current.email) {
      delete userData.email;
    } else {
      userData.email = nextEmail;
      userData.verifiedEmailAt = null;
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, 'mbtiType')) {
    userData.mbtiType = input.mbtiType ?? null;
    userData.mbtiGroup = input.mbtiType ? mbtiGroupFor(input.mbtiType) : null;
    buddyData.mbtiType = input.mbtiType ?? null;
  }

  if (input.interests !== undefined) {
    const interests = uniqueTags(input.interests);
    userData.interests = interests;
    buddyData.hobbies = interests;
  }

  if (input.skills !== undefined) userData.skills = uniqueTags(input.skills);

  return { userData, buddyData };
}
