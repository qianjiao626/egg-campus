import crypto from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import { Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { hashPassword, verifyPassword } from './auth/password.js';
import {
  loginSchema,
  profileUpdateSchema,
  privateUserShape,
  publicUserShape,
  registerSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  refreshTokenSchema,
  verificationTokenSchema,
} from './auth/validation.js';
import { prisma } from './prisma.js';
import { createVerificationProvider, type VerificationProvider } from './auth/provider.js';
import {
  generateVerificationCode,
  hashVerificationValue,
  isVerificationExpired,
  normalizeVerificationTarget,
  randomVerificationToken,
  type VerificationChannel,
  type VerificationPurpose,
} from './auth/verification.js';
import {
  verificationRequestSchema,
  verificationVerifySchema,
} from './auth/validation.js';
import { InMemoryRateLimiter } from './rate-limit.js';

const categories = ['study', 'job', 'side', 'hobby', 'game', 'life'] as const;

class VerificationTokenError extends Error {
  constructor() {
    super('INVALID_VERIFICATION_TOKEN');
  }
}

class BuddyPrestigeError extends Error {
  constructor(message: string) {
    super(message);
  }
}

function hashToken(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function newSessionId() {
  return crypto.randomBytes(15).toString('hex');
}

function newInviteCode() {
  return crypto.randomBytes(5).toString('hex').toUpperCase();
}

async function issueSession(app: FastifyInstance, user: { id: bigint; role: 'student' | 'admin' }, request: FastifyRequest) {
  const sessionId = newSessionId();
  const refreshToken = crypto.randomBytes(48).toString('base64url');
  await prisma.authSession.create({
    data: {
      id: sessionId,
      userId: user.id,
      refreshTokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    },
  });

  const accessToken = await app.jwt.sign(
    { sub: user.id.toString(), sessionId, role: user.role },
    { expiresIn: '15m' },
  );
  return { accessToken, refreshToken };
}

function currentUserId(request: FastifyRequest) {
  return BigInt(request.user.sub);
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  return schema.parse(body);
}

function setRefreshCookie(reply: FastifyReply, token: string, config: ReturnType<typeof loadConfig>) {
  if (!config.REFRESH_COOKIE_ENABLED) return;
  reply.setCookie('dandan_refresh', token, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax',
    path: config.COOKIE_PATH,
    maxAge: 30 * 24 * 60 * 60,
    domain: config.COOKIE_DOMAIN,
  });
}

function sessionResponse(tokens: { accessToken: string; refreshToken: string }, config: ReturnType<typeof loadConfig>) {
  return config.REFRESH_COOKIE_ENABLED ? { accessToken: tokens.accessToken } : tokens;
}

async function applyBuddyPointDelta(
  tx: Prisma.TransactionClient,
  userId: bigint,
  delta: number,
  idempotencyKey: string,
  type: string,
  remark: string,
) {
  const existing = await tx.pointTransaction.findUnique({ where: { idempotencyKey } });
  if (existing) return { duplicate: true, availableBalance: existing.balanceAvailable, frozenBalance: existing.balanceFrozen };
  const account = await tx.pointAccount.findUnique({ where: { userId } });
  if (!account) throw new BuddyPrestigeError('POINT_ACCOUNT_NOT_FOUND');
  const nextAvailable = account.availableBalance + delta;
  if (nextAvailable < 0) throw new BuddyPrestigeError('INSUFFICIENT_PRESTIGE');
  const next = await tx.pointAccount.update({
    where: { userId },
    data: { availableBalance: nextAvailable, version: { increment: 1 } },
  });
  await tx.pointTransaction.create({
    data: {
      userId,
      type,
      deltaAvailable: delta,
      deltaFrozen: 0,
      balanceAvailable: next.availableBalance,
      balanceFrozen: next.frozenBalance,
      idempotencyKey,
      remark,
    },
  });
  return { duplicate: false, availableBalance: next.availableBalance, frozenBalance: next.frozenBalance };
}

async function recordAudit(input: {
  actorId?: bigint;
  action: string;
  targetType: string;
  targetId: string;
  ip?: string;
  afterData?: Prisma.InputJsonValue;
}) {
  await prisma.auditLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      ip: input.ip,
      afterData: input.afterData,
    },
  }).catch(() => undefined);
}

export function buildApp(): FastifyInstance {
  const config = loadConfig();
  const app = Fastify({ logger: true });
  const verificationProvider: VerificationProvider = createVerificationProvider(config.VERIFICATION_PROVIDER, {
    secretId: config.TENCENTCLOUD_SECRET_ID,
    secretKey: config.TENCENTCLOUD_SECRET_KEY,
    sdkAppId: config.TENCENT_SMS_SDK_APP_ID,
    signName: config.TENCENT_SMS_SIGN_NAME,
    templateId: config.TENCENT_SMS_TEMPLATE_ID,
    region: config.TENCENT_SMS_REGION,
  });
  const verificationLimiter = new InMemoryRateLimiter();

  app.register(helmet);
  app.register(cookie);
  app.register(cors, { origin: config.CORS_ORIGIN, credentials: true });
  app.register(jwt, { secret: config.JWT_SECRET });

  app.decorate('authenticate', async function authenticate(request, reply) {
    try {
      await request.jwtVerify();
      const session = await prisma.authSession.findUnique({ where: { id: request.user.sessionId } });
      if (!session || session.revokedAt || session.expiresAt <= new Date()) {
        return reply.code(401).send({ error: 'SESSION_EXPIRED', message: '登录状态已失效' });
      }
    } catch {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: '请先登录' });
    }
  });

  app.get('/health', async () => ({ status: 'ok' }));

  const buddyPreferenceSchema = z.object({
    mbtiType: z.string().max(4).nullable().optional(),
    hobbies: z.array(z.string().max(40)).max(3).default([]),
    todayActions: z.array(z.string().max(80)).max(20).default([]),
    province: z.string().max(50).nullable().optional(),
    city: z.string().max(50).nullable().optional(),
    district: z.string().max(50).nullable().optional(),
    stealth: z.boolean().optional(),
  });
  const buddyMessageSchema = z.object({ recipientId: z.coerce.bigint(), text: z.string().trim().min(1).max(180), source: z.string().max(30).optional() });
  const buddyFriendSchema = z.object({ recipientId: z.coerce.bigint() });
  const buddyIdParamsSchema = z.object({ id: z.coerce.bigint() });
  const buddyFeatureSchema = z.object({
    feature: z.string().trim().regex(/^[a-z][a-z0-9-]{1,39}$/),
    action: z.string().trim().regex(/^[a-z][a-z0-9-]{1,39}$/),
    payload: z.record(z.string(), z.unknown()).default({}),
    status: z.string().trim().regex(/^[a-z][a-z0-9-]{1,19}$/).default('active'),
    idempotencyKey: z.string().trim().min(4).max(160).optional(),
  });
  const buddyFeatureQuerySchema = z.object({
    scope: z.enum(['mine', 'public']).default('mine'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  });

  function serializeBuddyFeature(record: {
    id: bigint;
    userId: bigint;
    feature: string;
    action: string;
    status: string;
    payload: Prisma.JsonValue;
    result: Prisma.JsonValue | null;
    idempotencyKey: string | null;
    createdAt: Date;
    updatedAt: Date;
    user?: { nickname: string } | null;
  }) {
    return {
      id: record.id.toString(),
      userId: record.userId.toString(),
      feature: record.feature,
      action: record.action,
      status: record.status,
      payload: record.payload,
      result: record.result,
      idempotencyKey: record.idempotencyKey,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      ownerName: record.user?.nickname ?? null,
    };
  }

  function serializePublicBuddyFeature(record: Parameters<typeof serializeBuddyFeature>[0]) {
    const safe = serializeBuddyFeature(record);
    const result = safe.result && typeof safe.result === 'object' && !Array.isArray(safe.result)
      ? Object.fromEntries(Object.entries(safe.result).filter(([key]) => ['accepted', 'topic', 'event', 'status', 'multiplier'].includes(key)))
      : null;
    return {...safe, userId: null, ownerName: null, payload: {}, result};
  }

  function buddyFeatureResult(feature: string, action: string, payload: Record<string, unknown>) {
    if (feature === 'box' && action === 'draw') {
      const pool = Array.isArray(payload.actionPool) ? payload.actionPool.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
      return { accepted: true, action: pool.length ? pool[crypto.randomInt(pool.length)] : null };
    }
    if (feature === 'icebreaker') {
      const topics = ['图书馆还是自习室？', '最近循环哪首歌？', '如果今天临时放假，你最想去哪？'];
      return { topic: `来玩一轮校园二选一吧：${topics[crypto.randomInt(topics.length)]}`, action };
    }
    if (feature === 'safety' && action === 'settings') {
      return { cooldownUntil: null, stealth: Boolean(payload.enabled), blocked: [], echoReject: false };
    }
    if (feature === 'event') {
      return { event: '校园盲盒日', status: 'active', multiplier: 1, endsAt: null };
    }
    return { accepted: true, feature, action };
  }

  app.post('/api/buddy-box/features', { preHandler: app.authenticate }, async (request, reply) => {
    const input = parseBody(buddyFeatureSchema, request.body);
    const userId = currentUserId(request);
    const idempotencyKey = input.idempotencyKey ?? `buddy:${userId.toString()}:${input.feature}:${input.action}:${hashToken(JSON.stringify(input.payload))}`;
    const existing = await prisma.buddyFeatureRecord.findUnique({ where: { idempotencyKey } });
    if (existing) return reply.code(200).send({ accepted: true, duplicate: true, record: serializeBuddyFeature(existing) });
    const payload = input.payload ?? {};
    const pointDelta = input.feature === 'box' && input.action === 'draw'
      ? -1
      : input.feature === 'prestige' && input.action === 'settle'
        ? Math.max(-100, Math.min(100, Number.isInteger(payload.delta) ? Number(payload.delta) : 0))
        : 0;
    try {
      const createRecord = async (tx: Prisma.TransactionClient) => {
        const point = pointDelta === 0 ? null : await applyBuddyPointDelta(tx, userId, pointDelta, `buddy-points:${idempotencyKey}`, 'buddy_box', '盲盒玩法声望变动');
        const result = {...buddyFeatureResult(input.feature, input.action, payload), ...(point ? {availablePrestige: point.availableBalance} : {})};
        return tx.buddyFeatureRecord.create({
          data: {
            userId,
            feature: input.feature,
            action: input.action,
            status: input.status,
            payload: payload as Prisma.InputJsonValue,
            result: result as Prisma.InputJsonValue,
            idempotencyKey,
          },
        });
      };
      const record = pointDelta === 0 ? await createRecord(prisma) : await prisma.$transaction(createRecord);
      return reply.code(201).send({ accepted: true, record: serializeBuddyFeature(record) });
    } catch (error) {
      if (error instanceof BuddyPrestigeError) {
        return reply.code(409).send({ error: error.message, message: error.message === 'INSUFFICIENT_PRESTIGE' ? '声望不足' : '声望账户不存在' });
      }
      throw error;
    }
  });

  app.get('/api/buddy-box/features', { preHandler: app.authenticate }, async (request) => {
    const query = buddyFeatureQuerySchema.parse(request.query);
    const userId = currentUserId(request);
    const records = await prisma.buddyFeatureRecord.findMany({
      where: query.scope === 'public' ? { status: 'active', userId: { not: userId } } : { userId },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      include: { user: { select: { nickname: true } } },
    });
    const serialized = query.scope === 'public'
      ? records.map((record) => serializePublicBuddyFeature(record))
      : records.map((record) => serializeBuddyFeature(record));
    return { records: serialized };
  });

  app.get('/api/buddy-box/features/:feature', { preHandler: app.authenticate }, async (request) => {
    const params = z.object({ feature: z.string().trim().regex(/^[a-z][a-z0-9-]{1,39}$/) }).parse(request.params);
    const query = buddyFeatureQuerySchema.parse(request.query);
    const userId = currentUserId(request);
    const records = await prisma.buddyFeatureRecord.findMany({
      where: query.scope === 'public' ? { feature: params.feature, status: 'active', userId: { not: userId } } : { feature: params.feature, userId },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      include: { user: { select: { nickname: true } } },
    });
    const serialized = query.scope === 'public'
      ? records.map((record) => serializePublicBuddyFeature(record))
      : records.map((record) => serializeBuddyFeature(record));
    return { records: serialized };
  });

  app.get('/api/buddy-box/preferences', { preHandler: app.authenticate }, async (request) => {
    const preference = await prisma.buddyPreference.findUnique({ where: { userId: currentUserId(request) } });
    return { preference: preference ? { ...preference, userId: preference.userId.toString() } : null };
  });

  app.put('/api/buddy-box/preferences', { preHandler: app.authenticate }, async (request) => {
    const input = buddyPreferenceSchema.parse(request.body);
    const preference = await prisma.buddyPreference.upsert({
      where: { userId: currentUserId(request) },
      create: { userId: currentUserId(request), mbtiType: input.mbtiType ?? null, hobbies: input.hobbies, todayActions: input.todayActions, province: input.province ?? null, city: input.city ?? null, district: input.district ?? null, stealth: input.stealth ?? false },
      update: { mbtiType: input.mbtiType ?? null, hobbies: input.hobbies, todayActions: input.todayActions, province: input.province ?? null, city: input.city ?? null, district: input.district ?? null, ...(input.stealth === undefined ? {} : { stealth: input.stealth }) },
    });
    return { preference: { ...preference, userId: preference.userId.toString() } };
  });

  app.get('/api/buddy-box/recommendations', { preHandler: app.authenticate }, async (request) => {
    const userId = currentUserId(request);
    const users = await prisma.user.findMany({ where: { id: { not: userId }, status: 'active' }, select: { id: true, nickname: true, school: true, major: true, city: true, mbtiType: true, eggRarity: true }, orderBy: { createdAt: 'desc' }, take: 20 });
    return { profiles: users.map((user) => ({ id: user.id.toString(), name: user.nickname, meta: [user.school, user.major].filter(Boolean).join(' · ') || '蛋蛋校园用户', city: user.city, mbtiType: user.mbtiType, rarity: user.eggRarity })) };
  });

  app.get('/api/buddy-box/inbox', { preHandler: app.authenticate }, async (request) => {
    const userId = currentUserId(request);
    const [messages, friendRequests] = await Promise.all([
      prisma.buddyMessage.findMany({
        where: { recipientId: userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { sender: { select: { id: true, nickname: true } } },
      }),
      prisma.buddyFriendRequest.findMany({
        where: { recipientId: userId, status: 'pending' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { requester: { select: { id: true, nickname: true } } },
      }),
    ]);
    return {
      messages: messages.map((message) => ({
        id: message.id.toString(),
        senderId: message.senderId.toString(),
        name: message.sender.nickname,
        text: message.text,
        type: 'message',
        source: message.source,
        unread: !message.readAt,
        createdAt: message.createdAt,
      })),
      friendRequests: friendRequests.map((requestRow) => ({
        id: requestRow.id.toString(),
        requesterId: requestRow.requesterId.toString(),
        name: requestRow.requester.nickname,
        text: '想和你成为好友',
        type: 'friend',
        status: requestRow.status,
        unread: true,
        createdAt: requestRow.createdAt,
      })),
    };
  });

  app.post('/api/buddy-box/messages', { preHandler: app.authenticate }, async (request, reply) => {
    const input = buddyMessageSchema.parse(request.body);
    if (input.recipientId === currentUserId(request)) return reply.code(400).send({ error: 'INVALID_RECIPIENT', message: '不能给自己发送留言' });
    const recipient = await prisma.user.findFirst({ where: { id: input.recipientId, status: 'active' }, select: { id: true } });
    if (!recipient) return reply.code(404).send({ error: 'USER_NOT_FOUND', message: '用户不存在' });
    const message = await prisma.buddyMessage.create({ data: { senderId: currentUserId(request), recipientId: input.recipientId, text: input.text, source: input.source } });
    return { message: { ...message, id: message.id.toString(), senderId: message.senderId.toString(), recipientId: message.recipientId.toString() } };
  });

  app.post('/api/buddy-box/messages/:id/read', { preHandler: app.authenticate }, async (request, reply) => {
    const params = buddyIdParamsSchema.parse(request.params);
    const updated = await prisma.buddyMessage.updateMany({
      where: { id: params.id, recipientId: currentUserId(request) },
      data: { readAt: new Date() },
    });
    if (updated.count !== 1) return reply.code(404).send({ error: 'MESSAGE_NOT_FOUND', message: '留言不存在' });
    return { ok: true };
  });

  app.post('/api/buddy-box/friend-requests', { preHandler: app.authenticate }, async (request, reply) => {
    const input = buddyFriendSchema.parse(request.body);
    if (input.recipientId === currentUserId(request)) return reply.code(400).send({ error: 'INVALID_RECIPIENT', message: '不能申请自己为好友' });
    const recipient = await prisma.user.findFirst({ where: { id: input.recipientId, status: 'active' }, select: { id: true } });
    if (!recipient) return reply.code(404).send({ error: 'USER_NOT_FOUND', message: '用户不存在' });
    const requestRow = await prisma.buddyFriendRequest.upsert({ where: { requesterId_recipientId: { requesterId: currentUserId(request), recipientId: input.recipientId } }, create: { requesterId: currentUserId(request), recipientId: input.recipientId }, update: { status: 'pending' } });
    return { request: { ...requestRow, id: requestRow.id.toString(), requesterId: requestRow.requesterId.toString(), recipientId: requestRow.recipientId.toString() } };
  });

  app.post('/api/buddy-box/friend-requests/:id/accept', { preHandler: app.authenticate }, async (request, reply) => {
    const params = buddyIdParamsSchema.parse(request.params);
    const updated = await prisma.buddyFriendRequest.updateMany({
      where: { id: params.id, recipientId: currentUserId(request), status: 'pending' },
      data: { status: 'accepted' },
    });
    if (updated.count !== 1) return reply.code(404).send({ error: 'FRIEND_REQUEST_NOT_FOUND', message: '好友申请不存在或已处理' });
    return { ok: true };
  });

  app.post('/api/auth/verification-codes', async (request, reply) => {
    const input = parseBody(verificationRequestSchema, request.body);
    const target = normalizeVerificationTarget(input.channel, input.target);
    const targetLimit = verificationLimiter.check(`verification-target:${input.purpose}:${target}`, 5, 60 * 60 * 1000);
    const ipLimit = verificationLimiter.check(`verification-ip:${request.ip}`, 20, 60 * 60 * 1000);
    if (!targetLimit.allowed || !ipLimit.allowed) {
      return reply
        .code(429)
        .header('retry-after', String(Math.max(targetLimit.retryAfterSeconds, ipLimit.retryAfterSeconds)))
        .send({ error: 'RATE_LIMITED', message: '操作过于频繁，请稍后再试' });
    }

    // Password-reset requests must not reveal whether an account exists.
    if (input.purpose === 'reset_password') {
      const resetUser = await prisma.user.findFirst({
        where: input.channel === 'sms' ? { phone: target, status: 'active' } : { email: target, status: 'active' },
        select: { id: true },
      });
      if (!resetUser) {
        return reply.code(202).send({ ok: true, expiresInSeconds: config.VERIFICATION_CODE_TTL_SECONDS, resendAfterSeconds: config.VERIFICATION_RESEND_COOLDOWN_SECONDS });
      }
    }

    const latest = await prisma.verificationCode.findFirst({
      where: { channel: input.channel, target, purpose: input.purpose, createdAt: { gt: new Date(Date.now() - config.VERIFICATION_RESEND_COOLDOWN_SECONDS * 1000) } },
      orderBy: { createdAt: 'desc' },
    });
    if (latest) {
      return reply
        .code(429)
        .header('retry-after', String(config.VERIFICATION_RESEND_COOLDOWN_SECONDS))
        .send({ error: 'RESEND_TOO_SOON', message: '验证码发送过于频繁，请稍后再试' });
    }

    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + config.VERIFICATION_CODE_TTL_SECONDS * 1000);
    const verificationRecord = await prisma.verificationCode.create({
      data: {
        channel: input.channel,
        target,
        purpose: input.purpose,
        codeHash: hashVerificationValue(code),
        maxAttempts: config.VERIFICATION_MAX_ATTEMPTS,
        expiresAt,
        requestIp: request.ip,
        userAgent: request.headers['user-agent'],
      },
    });

    try {
      await verificationProvider.send({
        channel: input.channel as VerificationChannel,
        target,
        code,
        purpose: input.purpose as VerificationPurpose,
      });
    } catch (error) {
      await prisma.verificationCode.delete({ where: { id: verificationRecord.id } }).catch(() => undefined);
      request.log.error({ err: error, channel: input.channel, purpose: input.purpose }, 'verification provider failed');
      return reply.code(503).send({ error: 'VERIFICATION_UNAVAILABLE', message: '验证码服务暂时不可用，请稍后再试' });
    }

    return reply.code(202).send({
      ok: true,
      expiresInSeconds: config.VERIFICATION_CODE_TTL_SECONDS,
      resendAfterSeconds: config.VERIFICATION_RESEND_COOLDOWN_SECONDS,
    });
  });

  app.post('/api/auth/password-reset/request', async (request, reply) => {
    const input = parseBody(passwordResetRequestSchema, request.body);
    const target = normalizeVerificationTarget(input.channel, input.target);
    const response = { ok: true, expiresInSeconds: config.VERIFICATION_CODE_TTL_SECONDS, resendAfterSeconds: config.VERIFICATION_RESEND_COOLDOWN_SECONDS };
    const targetLimit = verificationLimiter.check(`reset-target:${target}`, 5, 60 * 60 * 1000);
    const ipLimit = verificationLimiter.check(`reset-ip:${request.ip}`, 20, 60 * 60 * 1000);
    if (!targetLimit.allowed || !ipLimit.allowed) return reply.code(202).send(response);

    const user = await prisma.user.findFirst({
      where: input.channel === 'sms' ? { phone: target, status: 'active' } : { email: target, status: 'active' },
      select: { id: true },
    });
    if (!user) return reply.code(202).send(response);

    const latest = await prisma.verificationCode.findFirst({
      where: { channel: input.channel, target, purpose: 'reset_password', createdAt: { gt: new Date(Date.now() - config.VERIFICATION_RESEND_COOLDOWN_SECONDS * 1000) } },
      orderBy: { createdAt: 'desc' },
    });
    if (latest) return reply.code(202).send(response);

    const code = generateVerificationCode();
    const verificationRecord = await prisma.verificationCode.create({
      data: {
        channel: input.channel,
        target,
        purpose: 'reset_password',
        codeHash: hashVerificationValue(code),
        maxAttempts: config.VERIFICATION_MAX_ATTEMPTS,
        expiresAt: new Date(Date.now() + config.VERIFICATION_CODE_TTL_SECONDS * 1000),
        requestIp: request.ip,
        userAgent: request.headers['user-agent'],
      },
    });
    try {
      await verificationProvider.send({ channel: input.channel, target, code, purpose: 'reset_password' });
    } catch (error) {
      await prisma.verificationCode.delete({ where: { id: verificationRecord.id } }).catch(() => undefined);
      request.log.error({ err: error, channel: input.channel, purpose: 'reset_password' }, 'password reset provider failed');
    }
    return reply.code(202).send(response);
  });

  app.post('/api/auth/verification-codes/verify', async (request, reply) => {
    const input = parseBody(verificationVerifySchema, request.body);
    const target = normalizeVerificationTarget(input.channel, input.target);
    const record = await prisma.verificationCode.findFirst({
      where: { channel: input.channel, target, purpose: input.purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!record || record.attempts >= record.maxAttempts || isVerificationExpired(record.expiresAt)) {
      return reply.code(400).send({ error: 'INVALID_VERIFICATION_CODE', message: '验证码无效或已过期' });
    }

    if (hashVerificationValue(input.code) !== record.codeHash) {
      await prisma.verificationCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
      return reply.code(400).send({ error: 'INVALID_VERIFICATION_CODE', message: '验证码无效或已过期' });
    }

    const verificationToken = randomVerificationToken();
    await prisma.verificationCode.update({
      where: { id: record.id },
      data: { verifiedAt: new Date(), verificationTokenHash: hashVerificationValue(verificationToken) },
    });
    return { verificationToken, expiresInSeconds: 600 };
  });

  app.post('/api/auth/register', async (request, reply) => {
    const input = parseBody(registerSchema, request.body);
    const passwordHash = await hashPassword(input.password);
    const eggCategory = input.eggCategory ?? 'study';
    const registrationChannel = input.phone ? 'sms' : input.email ? 'email' : null;
    const registrationTarget = registrationChannel
      ? normalizeVerificationTarget(registrationChannel, input.phone ?? input.email!)
      : null;

    try {
      const user = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        if (registrationChannel && registrationTarget) {
          if (!input.verificationToken) throw new VerificationTokenError();
          const verification = await tx.verificationCode.findFirst({
            where: {
              channel: registrationChannel,
              target: registrationTarget,
              purpose: 'register',
              verificationTokenHash: hashVerificationValue(input.verificationToken),
              verifiedAt: { not: null },
              consumedAt: null,
              expiresAt: { gt: new Date() },
            },
            orderBy: { createdAt: 'desc' },
          });
          if (!verification) throw new VerificationTokenError();

          const consumed = await tx.verificationCode.updateMany({
            where: { id: verification.id, consumedAt: null },
            data: { consumedAt: new Date() },
          });
          if (consumed.count !== 1) throw new VerificationTokenError();
        }

        const created = await tx.user.create({
          data: {
            nickname: input.nickname,
            email: input.email,
            phone: input.phone,
            passwordHash,
            school: input.school,
            major: input.major,
            city: input.city,
            grade: input.grade,
            age: input.age,
            mbtiType: input.mbtiType,
            mbtiGroup: input.mbtiGroup,
            eggCategory,
            verifiedPhoneAt: input.phone ? new Date() : null,
            verifiedEmailAt: input.phone ? null : input.email ? new Date() : null,
            inviteCode: newInviteCode(),
            stats: { create: {} },
            account: { create: {} },
            characters: {
              create: categories.map((category) => ({
                category,
                unlocked: category === eggCategory,
                isCurrent: category === eggCategory,
                unlockedAt: category === eggCategory ? new Date() : null,
              })),
            },
          },
        });

        await tx.pointTransaction.create({
          data: {
            userId: created.id,
            type: 'register_bonus',
            deltaAvailable: 10,
            deltaFrozen: 0,
            balanceAvailable: 10,
            balanceFrozen: 0,
            idempotencyKey: `register:${created.id.toString()}`,
            remark: '新用户注册奖励',
          },
        });
        return created;
      });

      const tokens = await issueSession(app, user, request);
      await recordAudit({ actorId: user.id, action: 'auth.register', targetType: 'user', targetId: user.id.toString(), ip: request.ip });
      setRefreshCookie(reply, tokens.refreshToken, config);
      return reply.code(201).send({ user: privateUserShape(user), ...sessionResponse(tokens, config) });
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
        return reply.code(409).send({ error: 'DUPLICATE_USER', message: '昵称、邮箱或手机号已被使用' });
      }
      if (error instanceof VerificationTokenError) {
        return reply.code(400).send({ error: 'INVALID_VERIFICATION_TOKEN', message: '验证已失效，请重新获取验证码' });
      }
      throw error;
    }
  });

  app.post('/api/auth/login', async (request, reply) => {
    const input = parseBody(loginSchema, request.body);
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: input.identifier.toLowerCase() }, { nickname: input.identifier }, { phone: input.identifier.replace(/[\s-]/g, '') }] },
    });
    if (!user || user.status !== 'active' || !(await verifyPassword(input.password, user.passwordHash))) {
      return reply.code(401).send({ error: 'INVALID_CREDENTIALS', message: '账号或密码错误' });
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const tokens = await issueSession(app, user, request);
    await recordAudit({ actorId: user.id, action: 'auth.login', targetType: 'user', targetId: user.id.toString(), ip: request.ip });
    setRefreshCookie(reply, tokens.refreshToken, config);
    return { user: privateUserShape(user), ...sessionResponse(tokens, config) };
  });

  app.post('/api/auth/refresh', async (request, reply) => {
    const input = parseBody(refreshTokenSchema, request.body ?? {});
    const refreshToken = input.refreshToken ?? request.cookies.dandan_refresh;
    if (!refreshToken) return reply.code(401).send({ error: 'SESSION_EXPIRED', message: '登录状态已失效' });
    const refreshTokenHash = hashToken(refreshToken);
    const session = await prisma.authSession.findUnique({ where: { refreshTokenHash } });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      return reply.code(401).send({ error: 'SESSION_EXPIRED', message: '登录状态已失效' });
    }

    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user || user.status !== 'active') {
      return reply.code(401).send({ error: 'SESSION_EXPIRED', message: '登录状态已失效' });
    }

    const nextRefreshToken = crypto.randomBytes(48).toString('base64url');
    const accessToken = await app.jwt.sign(
      { sub: user.id.toString(), sessionId: session.id, role: user.role },
      { expiresIn: '15m' },
    );
    await prisma.authSession.update({
      where: { id: session.id },
      data: { refreshTokenHash: hashToken(nextRefreshToken), ip: request.ip, userAgent: request.headers['user-agent'] },
    });
    await recordAudit({ actorId: user.id, action: 'auth.refresh', targetType: 'session', targetId: session.id, ip: request.ip });
    setRefreshCookie(reply, nextRefreshToken, config);
    return sessionResponse({ accessToken, refreshToken: nextRefreshToken }, config);
  });

  app.post('/api/auth/password-reset/confirm', async (request, reply) => {
    const input = parseBody(passwordResetConfirmSchema, request.body);
    const target = normalizeVerificationTarget(input.channel, input.target);
    const verification = await prisma.verificationCode.findFirst({
      where: {
        channel: input.channel,
        target,
        purpose: 'reset_password',
        verificationTokenHash: hashVerificationValue(input.verificationToken),
        verifiedAt: { not: null },
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!verification) {
      return reply.code(400).send({ error: 'INVALID_VERIFICATION_TOKEN', message: '验证已失效，请重新获取验证码' });
    }

    const userWhere = input.channel === 'sms' ? { phone: target } : { email: target };
    const user = await prisma.user.findFirst({ where: userWhere });
    if (!user || user.status !== 'active') {
      return reply.code(400).send({ error: 'INVALID_VERIFICATION_TOKEN', message: '验证已失效，请重新获取验证码' });
    }

    const passwordHash = await hashPassword(input.newPassword);
    await prisma.$transaction([
      prisma.verificationCode.update({ where: { id: verification.id }, data: { consumedAt: new Date() } }),
      prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      prisma.authSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await recordAudit({ actorId: user.id, action: 'auth.password_reset', targetType: 'user', targetId: user.id.toString(), ip: request.ip });
    return { ok: true };
  });

  app.post('/api/auth/logout', { preHandler: app.authenticate }, async (request, reply) => {
    await prisma.authSession.update({
      where: { id: request.user.sessionId },
      data: { revokedAt: new Date() },
    });
    await recordAudit({ actorId: currentUserId(request), action: 'auth.logout', targetType: 'session', targetId: request.user.sessionId, ip: request.ip });
    if (config.REFRESH_COOKIE_ENABLED) reply.clearCookie('dandan_refresh', { path: config.COOKIE_PATH, domain: config.COOKIE_DOMAIN });
    return { ok: true };
  });

  app.get('/api/users/me', { preHandler: app.authenticate }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: currentUserId(request) } });
    if (!user || user.status !== 'active') return reply.code(404).send({ error: 'USER_NOT_FOUND' });
    return { user: privateUserShape(user) };
  });

  app.put('/api/users/me', { preHandler: app.authenticate }, async (request, reply) => {
    const input = parseBody(profileUpdateSchema, request.body);
    try {
      const user = await prisma.user.update({
        where: { id: currentUserId(request) },
        data: input,
      });
      return { user: privateUserShape(user) };
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
        return reply.code(409).send({ error: 'DUPLICATE_USER', message: '昵称、邮箱或手机号已被使用' });
      }
      throw error;
    }
  });

  app.get('/api/users/me/stats', { preHandler: app.authenticate }, async (request, reply) => {
    const stats = await prisma.userStats.findUnique({ where: { userId: currentUserId(request) } });
    if (!stats) return reply.code(404).send({ error: 'STATS_NOT_FOUND' });
    return {
      stats: {
        ...stats,
        userId: stats.userId.toString(),
        knowledge: Number(stats.knowledge),
        skills: Number(stats.skills),
        charm: Number(stats.charm),
        money: Number(stats.money),
        reputation: Number(stats.reputation),
      },
    };
  });

  app.get('/api/users/me/characters', { preHandler: app.authenticate }, async (request) => {
    const characters = await prisma.userCharacter.findMany({
      where: { userId: currentUserId(request) },
      orderBy: { category: 'asc' },
    });
    return { characters: characters.map((character) => ({ ...character, id: character.id.toString(), userId: character.userId.toString() })) };
  });

  app.put('/api/users/me/characters/current', { preHandler: app.authenticate }, async (request, reply) => {
    const body = z.object({ category: z.enum(categories) }).parse(request.body);
    const userId = currentUserId(request);
    const selected = await prisma.userCharacter.findUnique({ where: { userId_category: { userId, category: body.category } } });
    if (!selected?.unlocked) return reply.code(400).send({ error: 'CHARACTER_LOCKED', message: '该角色尚未解锁' });
    await prisma.$transaction([
      prisma.userCharacter.updateMany({ where: { userId }, data: { isCurrent: false } }),
      prisma.userCharacter.update({ where: { userId_category: { userId, category: body.category } }, data: { isCurrent: true } }),
      prisma.user.update({ where: { id: userId }, data: { eggCategory: body.category } }),
    ]);
    return { ok: true, category: body.category };
  });

  app.get('/api/users/me/point-account', { preHandler: app.authenticate }, async (request, reply) => {
    const account = await prisma.pointAccount.findUnique({ where: { userId: currentUserId(request) } });
    if (!account) return reply.code(404).send({ error: 'ACCOUNT_NOT_FOUND' });
    return { account: { ...account, userId: account.userId.toString() } };
  });

  app.get('/api/users/me/point-transactions', { preHandler: app.authenticate }, async (request) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(request.query);
    const transactions = await prisma.pointTransaction.findMany({
      where: { userId: currentUserId(request) },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });
    return { transactions: transactions.map((transaction) => ({ ...transaction, id: transaction.id.toString(), userId: transaction.userId.toString(), taskId: transaction.taskId?.toString() ?? null, operatorId: transaction.operatorId?.toString() ?? null })) };
  });

  app.get('/api/users/:id/public-profile', async (request, reply) => {
    const params = z.object({ id: z.coerce.bigint() }).parse(request.params);
    const user = await prisma.user.findUnique({ where: { id: params.id } });
    if (!user || user.status !== 'active') return reply.code(404).send({ error: 'USER_NOT_FOUND' });
    return { user: publicUserShape(user) };
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: '请求参数不符合要求', details: error.flatten() });
    }
    app.log.error(error);
    return reply.code(500).send({ error: 'INTERNAL_ERROR', message: '服务器内部错误' });
  });

  return app;
}
