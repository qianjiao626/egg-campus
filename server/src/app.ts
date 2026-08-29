import crypto from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import { Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { hashPassword, verifyPassword } from './auth/password.js';
import {
  loginSchema,
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
import { assertSafeJsonText, assertSafeSkillTags, assertSafeText, CONTENT_BLOCKED_MESSAGE } from './content-filter.js';
import { DAILY_TASK_PUBLISH_LIMIT, isSameUtcDay, publishRewardForAttempt } from './task-rules.js';
import { taskVisibilityWhere } from './task-visibility.js';
import { mbtiGroupFor, prepareProfileUpdate, profileMbtiTypeSchema, ProfileRuleError, profileUpdateSchema } from './profile.js';
import {
  assertFeedbackCanReopen,
  assertFeedbackTransition,
  assertUserCanAppendFeedback,
  feedbackStatusSchema,
  FeedbackRuleError,
  mapLegacyFeedbackStatus,
} from './feedback.js';
import {
  AuthorizationError,
  assertProtectedAdminMutationAllowed,
  loadAuthorizationContext,
  requirePermission as assertPermission,
  resolveGrantWindow,
  type AuthorizationContext,
} from './authorization.js';
import { hasAdministrativePermission, isPermissionKey, PERMISSIONS, PERMISSION_KEYS, type PermissionKey } from './permissions.js';
import {
  MAX_FEEDBACK_ATTACHMENT_BYTES,
  MAX_FEEDBACK_ATTACHMENTS_PER_UPLOAD,
  persistProtectedFile,
  ProtectedFileError,
  readProtectedFile,
  removeProtectedFile,
  type ValidatedFeedbackAttachment,
  validateFeedbackAttachment,
} from './protected-files.js';
import {
  calculateShopOrderTotal,
  createShopOrderSchema,
  orderStatusSchema,
  productInputSchema,
  productPatchSchema,
  productStatusSchema,
  serializeShopOrder,
  serializeShopProduct,
  shippingAddressInputSchema,
} from './shop.js';
import { offSalePublisherProductsIfUnauthorized, runShopMaintenance, type ShopMaintenanceClient } from './shop-maintenance.js';
import { decryptRedeemCode, encryptRedeemCode, hashRedeemCode, maskRedeemCode } from './redeem-code.js';
import { bindInvitation, InvitationError, rewardInvitationForApprovedTask } from './invitations.js';
import { createRealtimeHub, type RealtimeEvent, type RealtimeScope } from './realtime.js';
import {
  BLACKLIST_METRICS,
  BLACKLIST_METRIC_KEYS,
  averageScores,
  displayBlacklistSchoolName,
  maskBlacklistNickname,
  metricKey,
  normalizeBlacklistSchoolName,
  rankBlacklistSchools,
  serializeBlacklistComment,
  serializeBlacklistSchool,
} from './blacklist.js';

const categories = ['study', 'job', 'side', 'hobby', 'game', 'life'] as const;

class BuddyPrestigeError extends Error {
  constructor(message: string) {
    super(message);
  }
}

class DailyTaskPublishLimitError extends Error {
  constructor() {
    super('TASK_DAILY_LIMIT_REACHED');
  }
}

class ShopRuleError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ShopRuleError';
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

async function issueSession(app: FastifyInstance, user: { id: bigint; role: 'student' | 'admin'; mustChangePassword?: boolean }, request: FastifyRequest) {
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
    { sub: user.id.toString(), sessionId, role: user.role, mustChangePassword: user.mustChangePassword ?? false },
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

function isPrismaDatabaseError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const name = 'name' in error && typeof error.name === 'string' ? error.name : '';
  return name.startsWith('PrismaClient') || error instanceof PrismaClientKnownRequestError;
}

function prismaErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  return typeof error.code === 'string' ? error.code : null;
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

export async function refundExpiredInquiries(now = new Date()) {
  const expired = await prisma.inquiry.findMany({
    where: { deadline: { lt: now }, adopted: false, coinStatus: 'frozen', bounty: { gt: 0 } },
    orderBy: { deadline: 'asc' },
    take: 100,
    select: { id: true, userId: true, bounty: true },
  });
  let refunded = 0;
  for (const item of expired) {
    try {
      const didRefund = await prisma.$transaction(async (tx) => {
        const current = await tx.inquiry.findUnique({ where: { id: item.id } });
        if (!current || current.adopted || current.coinStatus !== 'frozen' || !current.deadline || current.deadline >= now) return false;
        const answer = await tx.inquiryReply.findFirst({ where: { inquiryId: item.id, kind: 'answer' }, select: { id: true } });
        if (answer) return false;
        await applyBuddyPointDelta(tx, current.userId, current.bounty, `inquiry-refund:${current.id.toString()}`, 'inquiry_refund', `打听到期无人回答退回蛋蛋币:${current.id.toString()}`);
        await tx.inquiry.update({ where: { id: current.id }, data: { coinStatus: 'refunded', status: 'expired' } });
        await tx.notification.create({ data: { userId: current.userId, type: 'inquiry_refunded', refId: current.id.toString(), payload: { bounty: current.bounty } } });
        return true;
      });
      if (didRefund) refunded += 1;
    } catch (error) {
      if (error instanceof BuddyPrestigeError) continue;
      throw error;
    }
  }
  return { scanned: expired.length, refunded };
}

export function buildApp(): FastifyInstance {
  const config = loadConfig();
  const app = Fastify({ logger: true });
  const verificationProvider: VerificationProvider = createVerificationProvider(config.VERIFICATION_PROVIDER);
  const shopRedeemCodeSecret = config.SHOP_REDEEM_CODE_SECRET ?? config.JWT_SECRET;
  const verificationLimiter = new InMemoryRateLimiter();
  const authorizationCache = new WeakMap<FastifyRequest, Promise<AuthorizationContext>>();
  const realtime = createRealtimeHub({
    loadPermissions: async (userId) => (await loadAuthorizationContext(prisma, userId)).permissionKeys,
  });
  const realtimeEvent = (type: string, resourceId: bigint | string, scope: RealtimeScope): RealtimeEvent => ({
    type,
    resourceId: resourceId.toString(),
    scope,
    occurredAt: new Date().toISOString(),
  });
  const publishRealtime = (publish: () => void | Promise<void>) => {
    try {
      void Promise.resolve(publish()).catch((error) => app.log.warn({ err: error }, 'realtime publish failed'));
    } catch (error) {
      app.log.warn({ err: error }, 'realtime publish failed');
    }
  };

  app.register(websocket, { options: { maxPayload: 1024 } });
  app.decorate('realtime', realtime);
  app.register(helmet);
  app.register(cookie);
  app.register(cors, { origin: config.CORS_ORIGIN, credentials: true });
  app.register(jwt, {
    secret: config.JWT_SECRET,
    verify: {
      extractToken: (request) => {
        const query = request.query as { token?: unknown };
        if (request.url.startsWith('/api/realtime') && typeof query?.token === 'string') return query.token;
        const authorization = request.headers.authorization;
        return authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
      },
    },
  });
  app.register(multipart, {
    limits: {
      files: 11,
      fileSize: MAX_FEEDBACK_ATTACHMENT_BYTES + 1,
    },
  });

  app.decorate('authenticate', async function authenticate(request, reply) {
    try {
      await request.jwtVerify();
      const session = await prisma.authSession.findUnique({ where: { id: request.user.sessionId } });
      if (!session || session.revokedAt || session.expiresAt <= new Date()) {
        return reply.code(401).send({ error: 'SESSION_EXPIRED', message: '登录状态已失效' });
      }
      if (request.user.mustChangePassword && request.url !== '/api/auth/change-required-password' && request.url !== '/api/auth/logout') {
        return reply.code(403).send({ error: 'PASSWORD_CHANGE_REQUIRED', message: '首次登录必须先修改密码' });
      }
    } catch {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: '请先登录' });
    }
  });

  app.register(async function realtimeRoutes(instance) {
    instance.get('/api/realtime', {
      websocket: true,
      logLevel: 'silent',
      onRequest: async (request, reply) => {
        const query = request.query as { token?: unknown };
        if (typeof query.token !== 'string' || query.token.length === 0) {
          return reply.code(401).send({ error: 'UNAUTHORIZED', message: '请先登录' });
        }
      },
      preValidation: instance.authenticate,
    }, (socket, request) => {
      const disconnect = realtime.connect({ userId: currentUserId(request), socket });
      socket.once('close', disconnect);
      socket.once('error', disconnect);
    });
  });

  app.addHook('onClose', async () => {
    realtime.closeAll();
  });

  app.get('/health', async () => ({ status: 'ok' }));

  // Public university blacklist reads. These routes intentionally do not use authentication.
  app.get('/api/blacklist/metrics', async () => ({ metrics: BLACKLIST_METRICS }));
  app.get('/api/blacklist/stats', async () => {
    const [schoolCount, commentCount, scoreSummary] = await Promise.all([
      prisma.blacklistSchool.count(),
      prisma.blacklistComment.count({ where: { status: 'approved' } }),
      prisma.blacklistScore.aggregate({
        where: { comment: { status: 'approved' } },
        _avg: { score: true },
      }),
    ]);
    const average = Number(Number(scoreSummary._avg.score ?? 0).toFixed(1));
    return { schoolCount, commentCount, totalTousu: commentCount, averageScore: average, avgScore: average, metricCount: BLACKLIST_METRICS.length };
  });
  app.get('/api/blacklist/rank', async (request) => {
    const query = z.object({ metric: z.string().default('all'), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) }).parse(request.query);
    if (query.metric !== 'all' && !metricKey(query.metric)) throw new z.ZodError([{ code: 'custom', path: ['metric'], message: '指标无效' }]);
    return rankBlacklistSchools(prisma, query.metric as any, query.page, query.pageSize);
  });
  app.get('/api/blacklist/metric-rank', async (request) => {
    const query = z.object({ metric: z.string(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) }).parse(request.query);
    if (!metricKey(query.metric)) throw new z.ZodError([{ code: 'custom', path: ['metric'], message: '指标无效' }]);
    return rankBlacklistSchools(prisma, query.metric, query.page, query.pageSize);
  });
  app.get('/api/blacklist/extremes', async () => {
    const ranked = await rankBlacklistSchools(prisma, 'all', 1, 50);
    const worst = ranked.rows[0] ?? null;
    const best = ranked.rows.at(-1) ?? null;
    return { worst, best, highest: ranked.rows.slice(0, 3), lowest: ranked.rows.slice(-3).reverse() };
  });
  app.get('/api/blacklist/search', async (request) => {
    const query = z.object({ keyword: z.string().trim().min(1).max(50) }).parse(request.query);
    const schools = await prisma.blacklistSchool.findMany({ where: { name: { contains: normalizeBlacklistSchoolName(query.keyword) } }, orderBy: { name: 'asc' }, take: 20 });
    const stats = schools.length ? await prisma.blacklistComment.groupBy({
      where: { schoolId: { in: schools.map((school) => school.id) }, status: 'approved' },
      by: ['schoolId'],
      _count: { _all: true },
      _avg: { averageScore: true },
    }) : [];
    const statsBySchoolId = new Map(stats.map((item) => [item.schoolId.toString(), item]));
    const list = schools.map((school) => {
      const item = serializeBlacklistSchool(school);
      const current = statsBySchoolId.get(school.id.toString());
      const commentCount = current?._count._all ?? 0;
      const avgScore = commentCount ? Number(Number(current?._avg.averageScore ?? 0).toFixed(1)) : 0;
      return { ...item, commentCount, count: commentCount, avgScore, score: avgScore };
    });
    return { schools: list, list };
  });
  app.get('/api/blacklist/wall', async (request) => {
    const query = z.object({ schoolId: z.coerce.bigint().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) }).parse(request.query);
    const where = { status: 'approved' as const, ...(query.schoolId ? { schoolId: query.schoolId } : {}) };
    const [total, comments] = await Promise.all([
      prisma.blacklistComment.count({ where }),
      prisma.blacklistComment.findMany({ where, include: { user: { select: { nickname: true } }, school: true, scores: true }, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    ]);
    const list = comments.map((comment: any) => ({ ...serializeBlacklistComment(comment), schoolName: comment.school?.name, displayName: comment.school ? displayBlacklistSchoolName(comment.school.name) : undefined, userName: maskBlacklistNickname(comment.user?.nickname), text: comment.content, score: Number(comment.averageScore), time: comment.createdAt }));
    return { comments: list, list, total, page: query.page, pageSize: query.pageSize };
  });
  app.get('/api/blacklist/school/:id', async (request, reply) => {
    const params = z.object({ id: z.coerce.bigint() }).parse(request.params);
    const query = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) }).parse(request.query);
    const school = await prisma.blacklistSchool.findUnique({ where: { id: params.id } });
    if (!school) return reply.code(404).send({ error: 'SCHOOL_NOT_FOUND', message: '学校不存在' });
    const where = { schoolId: school.id, status: 'approved' as const };
    const [total, comments, average, metricRows] = await Promise.all([
      prisma.blacklistComment.count({ where }),
      prisma.blacklistComment.findMany({ where, include: { user: { select: { nickname: true } }, scores: true }, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      prisma.blacklistComment.aggregate({ where, _avg: { averageScore: true } }),
      prisma.blacklistScore.groupBy({ where: { comment: where }, by: ['metricKey'], _avg: { score: true } }),
    ]);
    const metricAverages = Object.fromEntries(metricRows.map((row) => [row.metricKey, Number(Number(row._avg.score ?? 0).toFixed(1))]));
    for (const key of BLACKLIST_METRIC_KEYS) if (!(key in metricAverages)) metricAverages[key] = 0;
    const avgScore = Number(Number(average._avg.averageScore ?? 0).toFixed(1));
    return { school: serializeBlacklistSchool(school), schoolId: school.id.toString(), schoolName: school.name, displayName: displayBlacklistSchoolName(school.name), count: total, avgScore, metrics: metricAverages, stats: { commentCount: total, averageScore: avgScore, metricAverages }, comments: comments.map(serializeBlacklistComment), page: query.page, pageSize: query.pageSize, total };
  });
  app.post('/api/blacklist/school/add', { preHandler: app.authenticate }, async (request, reply) => {
    const input = z.object({ schoolName: z.string().trim().min(2).max(200).optional(), name: z.string().trim().min(2).max(200).optional() }).parse(request.body);
    const requestedName = input.schoolName ?? input.name;
    if (!requestedName) return reply.code(400).send({ error: 'SCHOOL_NAME_REQUIRED', message: '请填写学校名称' });
    assertSafeText(requestedName);
    const name = normalizeBlacklistSchoolName(requestedName);
    try {
      const school = await prisma.blacklistSchool.upsert({ where: { name }, create: { name }, update: {} });
      return reply.code(201).send({ success: true, ...serializeBlacklistSchool(school) });
    } catch (error) {
      if (prismaErrorCode(error) === 'P2002') return reply.code(409).send({ error: 'SCHOOL_ALREADY_EXISTS', message: '学校已存在' });
      throw error;
    }
  });
  app.get('/api/blacklist/my-count', { preHandler: app.authenticate }, async (request) => {
    const totalCount = await prisma.blacklistComment.count({ where: { userId: currentUserId(request) } });
    const rewardedCount = Math.min(totalCount, 2);
    return { totalCount, rewardedCount, remainingReward: Math.max(0, 2 - rewardedCount) };
  });
  app.post('/api/blacklist/submit', { preHandler: app.authenticate }, async (request, reply) => {
    const raw = z.object({ schoolId: z.coerce.bigint().optional(), schoolName: z.string().trim().min(2).max(200).optional(), scores: z.record(z.string(), z.coerce.number()), comment: z.string().trim().max(5000).optional() }).parse(request.body);
    const missing = BLACKLIST_METRIC_KEYS.filter((key) => !(key in raw.scores));
    const unknown = Object.keys(raw.scores).filter((key) => !metricKey(key));
    if (missing.length || unknown.length) return reply.code(400).send({ error: 'INVALID_SCORES', message: '必须完整填写 16 项评分' });
    for (const key of BLACKLIST_METRIC_KEYS) {
      const value = raw.scores[key];
      if (!Number.isInteger(value) || value < 0 || value > 10) return reply.code(400).send({ error: 'INVALID_SCORE', message: `${key} 评分必须为 0-10 的整数` });
    }
    const schoolName = raw.schoolName ? normalizeBlacklistSchoolName(raw.schoolName) : undefined;
    if (!raw.schoolId && !schoolName) return reply.code(400).send({ error: 'SCHOOL_REQUIRED', message: '请选择或填写学校' });
    assertSafeText(raw.comment ?? '', schoolName ?? '');
    const userId = currentUserId(request);
    try {
      const result = await prisma.$transaction(async (tx) => {
        let school = raw.schoolId ? await tx.blacklistSchool.findUnique({ where: { id: raw.schoolId } }) : null;
        if (raw.schoolId && !school) throw new Error('SCHOOL_NOT_FOUND');
        if (!school) school = await tx.blacklistSchool.upsert({ where: { name: schoolName! }, create: { name: schoolName! }, update: {} });
        const existing = await tx.blacklistComment.findUnique({ where: { userId_schoolId: { userId, schoolId: school.id } } });
        if (existing) throw new Error('BLACKLIST_ALREADY_SUBMITTED');
        const total = await tx.blacklistComment.count({ where: { userId } });
        const averageScore = averageScores(raw.scores);
        const comment = await tx.blacklistComment.create({ data: { userId, schoolId: school.id, content: raw.comment || null, averageScore, scores: { create: BLACKLIST_METRIC_KEYS.map((metricKey) => ({ metricKey, score: raw.scores[metricKey] })) } }, include: { user: { select: { nickname: true } }, scores: true } });
        let reward = 0;
        if (total < 2) {
          reward = 10;
          await applyBuddyPointDelta(tx, userId, 10, `blacklist-reward:${comment.id.toString()}`, 'blacklist_submit_reward', `大学吐槽榜第${total + 1}次提交奖励`);
          await tx.userStats.upsert({ where: { userId }, create: { userId, experience: 10 }, update: { experience: { increment: 10 } } });
        }
        return { comment, school, reward };
      });
      publishRealtime(() => realtime.publishPublic(realtimeEvent('blacklist.updated', result.school.id, 'public')));
      const remainingTimes = Math.max(0, 2 - Math.min(2, await prisma.blacklistComment.count({ where: { userId } })));
      return reply.code(201).send({ success: true, comment: serializeBlacklistComment(result.comment), school: serializeBlacklistSchool(result.school), reward: { coins: result.reward, experience: result.reward }, expGain: result.reward, coinGain: result.reward, remainingTimes });
    } catch (error) {
      const code = prismaErrorCode(error);
      if (code === 'P2002' || error instanceof Error && error.message === 'BLACKLIST_ALREADY_SUBMITTED') return reply.code(409).send({ error: 'BLACKLIST_ALREADY_SUBMITTED', message: '你已经评价过这所学校' });
      if (error instanceof Error && error.message === 'SCHOOL_NOT_FOUND') return reply.code(404).send({ error: 'SCHOOL_NOT_FOUND', message: '学校不存在' });
      throw error;
    }
  });
  app.patch('/api/admin/blacklist/comments/:id', { preHandler: app.authenticate }, async (request, reply) => {
    if (!await requireRequestPermission(request, reply, PERMISSION_KEYS.blacklistCommentModerate)) return;
    const params = z.object({ id: z.coerce.bigint() }).parse(request.params);
    const input = z.object({ status: z.literal('deleted') }).parse(request.body);
    const comment = await prisma.blacklistComment.update({ where: { id: params.id }, data: { status: input.status } });
    publishRealtime(() => realtime.publishPublic(realtimeEvent('blacklist.updated', comment.schoolId, 'public')));
    return { success: true, id: comment.id.toString(), status: comment.status };
  });

  const buddyPreferenceSchema = z.object({
    mbtiType: profileMbtiTypeSchema.nullable().optional(),
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
  const buddyRecommendationQuerySchema = z.object({
    action: z.string().trim().max(80).optional(),
  });
  const taskCreateSchema = z.object({
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(10000),
    remark: z.string().trim().max(5000).nullable().optional(),
    taskType: z.enum(['teach', 'help', 'team', 'reward']).default('teach'),
    claimMode: z.enum(['single', 'multiple']).default('single'),
    reward: z.coerce.number().int().min(0).max(10000).default(0),
    maxClaimers: z.coerce.number().int().min(1).max(100).default(1),
    contact: z.string().trim().max(160).nullable().optional(),
    requirements: z.string().trim().max(5000).nullable().optional(),
    skillCategory: z.string().trim().min(1).max(50).nullable().optional(),
    skillSubcategory: z.string().trim().min(1).max(50).nullable().optional(),
  });
  const taskUpdateSchema = taskCreateSchema.partial().refine((input) => Object.keys(input).length > 0, { message: '至少修改一个字段' });
  const taskMineQuerySchema = z.object({ status: z.string().trim().max(30).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
  const taskReviewSchema = z.object({ status: z.enum(['approved', 'completed', 'needs_revision']), reviewReason: z.string().trim().max(500).nullable().optional() });
  const taskClaimSchema = z.object({ contact: z.string().trim().max(160).nullable().optional() });
  const taskCompleteSchema = z.object({ claimId: z.coerce.bigint().nullable().optional() });
  const taskAssignSchema = z.object({ claimIds: z.array(z.coerce.bigint()).min(1).max(100) });
  const taskCancellationRequestSchema = z.object({ reason: z.string().trim().min(1).max(500) });
  const taskCancellationRequestParamsSchema = z.object({ id: z.coerce.bigint(), requestId: z.coerce.bigint() });
  const taskCancellationResponseSchema = z.object({ status: z.enum(['accepted', 'rejected']) });
  const taskRatingSchema = z.object({ toUserId: z.coerce.bigint(), score: z.coerce.number().int().min(1).max(5), comment: z.string().trim().max(2000).nullable().optional() });
  const feedbackSchema = z.object({ type: z.string().trim().min(1).max(50), content: z.string().trim().min(1).max(10000), contact: z.string().trim().max(160).nullable().optional(), source: z.string().trim().max(100).nullable().optional() });
  const feedbackAdminSchema = z.object({ status: feedbackStatusSchema.optional(), adminRemark: z.string().trim().max(10000).nullable().optional() });
  const feedbackMessageSchema = z.object({ content: z.string().trim().min(1).max(10000) });
  const feedbackReopenSchema = z.object({ reason: z.string().trim().min(1).max(2000) });
  const feedbackAttachmentParamsSchema = z.object({ id: z.coerce.bigint(), attachmentId: z.coerce.bigint() });
  const roleInputSchema = z.object({
    code: z.string().trim().regex(/^[a-z][a-z0-9_]{2,79}$/),
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500).nullable().optional(),
    permissionKeys: z.array(z.string()).max(100),
  });
  const roleUpdateSchema = roleInputSchema.omit({ code: true }).partial().extend({ enabled: z.boolean().optional() });
  const roleGrantSchema = z.object({
    userId: z.coerce.bigint(),
    roleId: z.coerce.bigint(),
    preset: z.enum(['1h', '7d', '1m', '1q', 'permanent', 'custom']),
    customExpiresAt: z.coerce.date().optional(),
    reason: z.string().trim().min(1).max(500),
  });
  const requiredPasswordChangeSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(8).max(128) });
  const inquiryCreateSchema = z.object({ title: z.string().trim().min(1).max(160), content: z.string().trim().min(1).max(10000), tags: z.array(z.string().trim().max(40)).max(8).default([]), bounty: z.coerce.number().int().min(0).max(10000).default(0), deadline: z.coerce.date().nullable().optional() });
  const inquiryReplySchema = z.object({ content: z.string().trim().min(1).max(10000), kind: z.enum(['answer', 'comment']).default('answer'), parentId: z.coerce.bigint().nullable().optional() });
  const notificationParamsSchema = z.object({ id: z.coerce.bigint() });

  const activeTaskClaimStatuses = ['pending', 'assigned', 'submitted'] as const;
  function taskListInclude(userId: bigint) {
    return {
      _count: { select: { claims: { where: { status: { in: [...activeTaskClaimStatuses] } } } } },
      claims: { where: { claimerId: userId }, select: { status: true }, take: 1 },
      user: { select: { id: true, nickname: true, eggCategory: true, eggRarity: true } },
    };
  }
  function serializeTask(task: any) {
    const { _count, claims, user, ...record } = task;
    return {
      ...record,
      id: task.id.toString(),
      userId: task.userId.toString(),
      publisher: user ? {
        id: user.id.toString(),
        nickname: user.nickname,
        eggCategory: user.eggCategory,
        eggRarity: user.eggRarity,
      } : null,
      activeClaimCount: _count?.claims ?? 0,
      claimStatus: claims?.[0]?.status ?? null,
    };
  }
  function serializeTaskCancellationRequest(request: any) {
    return {
      ...request,
      id: request.id.toString(),
      taskId: request.taskId.toString(),
      requesterId: request.requesterId.toString(),
      recipientId: request.recipientId.toString(),
    };
  }
  async function cancelTaskAndRefund(tx: Prisma.TransactionClient, task: any, claims: Array<{ id: bigint; claimerId: bigint; frozenAmount: number }>) {
    if (task.reward > 0 && (task.taskType === 'help' || task.taskType === 'team' || task.taskType === 'reward')) {
      const refund = task.taskType === 'team' ? task.reward * task.maxClaimers : task.reward;
      await applyBuddyPointDelta(tx, task.userId, refund, `task-cancel-refund:${task.id.toString()}`, 'task_reward_refund', `取消任务退回蛋蛋币:${task.id.toString()}`);
    }
    for (const claim of claims) {
      if (claim.frozenAmount > 0) {
        await applyBuddyPointDelta(tx, task.userId, claim.frozenAmount, `task-cancel-claim-refund:${task.id.toString()}:${claim.id.toString()}`, 'task_tuition_paid', `取消任务支付发布者蛋蛋币:${task.id.toString()}`);
      }
    }
    await tx.taskClaim.updateMany({ where: { taskId: task.id, status: { in: ['pending', 'assigned', 'submitted'] } }, data: { status: 'cancelled' } });
    return tx.task.update({ where: { id: task.id }, data: { status: 'cancelled' } });
  }
  function serializeFeedback(feedback: any) {
    return {
      ...feedback,
      id: feedback.id.toString(),
      userId: feedback.userId.toString(),
      status: mapLegacyFeedbackStatus(feedback.status),
      messages: Array.isArray(feedback.messages) ? feedback.messages.map((message: any) => ({
        ...message,
        id: message.id.toString(),
        feedbackId: message.feedbackId.toString(),
        authorId: message.authorId == null ? null : message.authorId.toString(),
      })) : [],
      attachments: Array.isArray(feedback.attachments) ? feedback.attachments.map((attachment: any) => ({
        id: attachment.id.toString(),
        feedbackId: attachment.feedbackId.toString(),
        messageId: attachment.messageId == null ? null : attachment.messageId.toString(),
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        hidden: attachment.hiddenAt !== null,
        createdAt: attachment.createdAt,
      })) : [],
    };
  }
  function serializeInquiry(inquiry: any) {
    return { ...inquiry, id: inquiry.id.toString(), userId: inquiry.userId.toString(), bounty: Number(inquiry.bounty), tags: Array.isArray(inquiry.tags) ? inquiry.tags : [], adoptedReplyId: inquiry.adoptedReplyId == null ? null : inquiry.adoptedReplyId.toString(), deadline: inquiry.deadline ?? null };
  }
  function serializeNotification(notification: any) {
    return { ...notification, id: notification.id.toString(), userId: notification.userId.toString() };
  }
  function authorizationFor(request: FastifyRequest) {
    const existing = authorizationCache.get(request);
    if (existing) return existing;
    const loading = loadAuthorizationContext(prisma, currentUserId(request));
    authorizationCache.set(request, loading);
    return loading;
  }

  async function hasRequestPermission(request: FastifyRequest, key: PermissionKey) {
    try {
      const context = await authorizationFor(request);
      assertPermission(context.permissionKeys, key);
      return true;
    } catch (error) {
      if (error instanceof AuthorizationError) return false;
      throw error;
    }
  }

  async function requireRequestPermission(request: FastifyRequest, reply: FastifyReply, key: PermissionKey) {
    if (await hasRequestPermission(request, key)) return true;
    reply.code(403).send({ error: 'FORBIDDEN', message: '没有执行此操作的权限' });
    return false;
  }

  function validateAssignablePermissionKeys(keys: readonly string[]) {
    if (!keys.every(isPermissionKey)) throw new AuthorizationError('FORBIDDEN', '包含未知权限');
    const definitions = keys.map((key) => PERMISSIONS.find((item) => item.key === key)!);
    if (definitions.some((item) => item.protected)) throw new AuthorizationError('FORBIDDEN', '权限管理能力不能授予其他角色');
    return keys as PermissionKey[];
  }

  app.get('/api/admin/permissions', { preHandler: app.authenticate }, async (request, reply) => {
    if (!await requireRequestPermission(request, reply, PERMISSION_KEYS.permissionRoleGrant)) return;
    return { permissions: PERMISSIONS };
  });

  app.get('/api/admin/roles', { preHandler: app.authenticate }, async (request, reply) => {
    if (!await requireRequestPermission(request, reply, PERMISSION_KEYS.permissionRoleGrant)) return;
    const roles = await prisma.role.findMany({
      orderBy: { createdAt: 'asc' },
      include: { permissions: { include: { permission: true } }, _count: { select: { grants: true } } },
    });
    return { roles: roles.map((role) => ({ ...role, id: role.id.toString(), permissionKeys: role.permissions.map((item) => item.permission.key), userCount: role._count.grants, permissions: undefined, _count: undefined })) };
  });

  app.post('/api/admin/roles', { preHandler: app.authenticate }, async (request, reply) => {
    if (!await requireRequestPermission(request, reply, PERMISSION_KEYS.permissionRoleCreate)) return;
    const input = roleInputSchema.parse(request.body);
    assertSafeText(input.name, input.description);
    const keys = validateAssignablePermissionKeys(input.permissionKeys);
    const role = await prisma.$transaction(async (tx) => {
      const permissions = await tx.permission.findMany({ where: { key: { in: keys } }, select: { id: true, key: true } });
      if (permissions.length !== new Set(keys).size) throw new AuthorizationError('FORBIDDEN', '权限目录尚未完成初始化');
      return tx.role.create({
        data: {
          code: input.code,
          name: input.name,
          description: input.description ?? null,
          permissions: { create: permissions.map((permission) => ({ permissionId: permission.id })) },
        },
      });
    });
    await recordAudit({ actorId: currentUserId(request), action: 'rbac.role.create', targetType: 'role', targetId: role.id.toString(), ip: request.ip, afterData: { code: role.code, permissionKeys: keys } });
    return reply.code(201).send({ role: { ...role, id: role.id.toString() } });
  });

  app.patch('/api/admin/roles/:id', { preHandler: app.authenticate }, async (request, reply) => {
    if (!await requireRequestPermission(request, reply, PERMISSION_KEYS.permissionRoleEdit)) return;
    const params = notificationParamsSchema.parse(request.params);
    const input = roleUpdateSchema.parse(request.body);
    assertSafeText(input.name, input.description);
    const current = await prisma.role.findUnique({ where: { id: params.id } });
    if (!current) return reply.code(404).send({ error: 'ROLE_NOT_FOUND', message: '角色不存在' });
    if (current.systemProtected) return reply.code(403).send({ error: 'PROTECTED_ROLE', message: '系统保护角色不能修改' });
    const keys = input.permissionKeys ? validateAssignablePermissionKeys(input.permissionKeys) : null;
    const role = await prisma.$transaction(async (tx) => {
      if (keys) {
        const permissions = await tx.permission.findMany({ where: { key: { in: keys } }, select: { id: true } });
        if (permissions.length !== new Set(keys).size) throw new AuthorizationError('FORBIDDEN', '权限目录尚未完成初始化');
        await tx.rolePermission.deleteMany({ where: { roleId: current.id } });
        if (permissions.length) await tx.rolePermission.createMany({ data: permissions.map((permission) => ({ roleId: current.id, permissionId: permission.id })) });
      }
      const updated = await tx.role.update({ where: { id: current.id }, data: { ...(input.name === undefined ? {} : { name: input.name }), ...(input.description === undefined ? {} : { description: input.description }), ...(input.enabled === undefined ? {} : { enabled: input.enabled }) } });
      const publishingRemoved = input.enabled === false || (keys !== null && !keys.includes(PERMISSION_KEYS.shopProductCreateOwn));
      if (publishingRemoved) {
        const affected = await tx.userRoleGrant.findMany({ where: { roleId: current.id }, distinct: ['userId'], select: { userId: true } });
        for (const grant of affected) {
          await offSalePublisherProductsIfUnauthorized(tx as unknown as ShopMaintenanceClient, grant.userId);
        }
      }
      return updated;
    });
    await recordAudit({ actorId: currentUserId(request), action: 'rbac.role.update', targetType: 'role', targetId: role.id.toString(), ip: request.ip, afterData: { enabled: role.enabled, permissionKeys: keys ?? undefined } });
    if (keys !== null || input.enabled !== undefined) realtime.invalidatePermissions();
    return { role: { ...role, id: role.id.toString() } };
  });

  app.get('/api/admin/users', { preHandler: app.authenticate }, async (request, reply) => {
    if (!await requireRequestPermission(request, reply, PERMISSION_KEYS.userList)) return;
    const query = z.object({ q: z.string().trim().max(100).default('') }).parse(request.query);
    const users = await prisma.user.findMany({
      where: query.q ? { OR: [{ nickname: { contains: query.q } }, { email: { contains: query.q } }] } : {},
      orderBy: { createdAt: 'desc' }, take: 50,
      select: {
        id: true,
        nickname: true,
        email: true,
        status: true,
        school: true,
        major: true,
        grade: true,
        protectedAdminKey: true,
        createdAt: true,
        account: { select: { availableBalance: true } },
        stats: { select: { completedTasks: true, experience: true } },
        _count: { select: { taskClaims: { where: { status: { in: ['pending', 'assigned', 'submitted'] } } } } },
      },
    });
    return {
      users: users.map(({ account, stats, _count, protectedAdminKey, ...user }) => ({
        ...user,
        id: user.id.toString(),
        completedTasks: stats?.completedTasks ?? 0,
        inProgressTasks: _count.taskClaims,
        points: account?.availableBalance ?? 0,
        experience: stats?.experience ?? 0,
        protected: Boolean(protectedAdminKey),
      })),
    };
  });

  app.get('/api/admin/users/:id/roles', { preHandler: app.authenticate }, async (request, reply) => {
    if (!await requireRequestPermission(request, reply, PERMISSION_KEYS.permissionRoleGrant)) return;
    const params = notificationParamsSchema.parse(request.params);
    const grants = await prisma.userRoleGrant.findMany({ where: { userId: params.id }, orderBy: { createdAt: 'desc' }, include: { role: true } });
    return { grants: grants.map((grant) => ({ ...grant, id: grant.id.toString(), userId: grant.userId.toString(), roleId: grant.roleId.toString(), grantedBy: grant.grantedBy?.toString() ?? null, revokedBy: grant.revokedBy?.toString() ?? null, role: { ...grant.role, id: grant.role.id.toString() } })) };
  });

  app.post('/api/admin/role-grants', { preHandler: app.authenticate }, async (request, reply) => {
    if (!await requireRequestPermission(request, reply, PERMISSION_KEYS.permissionRoleGrant)) return;
    const input = roleGrantSchema.parse(request.body);
    assertSafeText(input.reason);
    const [target, role] = await Promise.all([
      prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, protectedAdminKey: true } }),
      prisma.role.findUnique({ where: { id: input.roleId } }),
    ]);
    if (!target) return reply.code(404).send({ error: 'USER_NOT_FOUND', message: '用户不存在' });
    if (!role || !role.enabled) return reply.code(404).send({ error: 'ROLE_NOT_FOUND', message: '角色不存在或已停用' });
    assertProtectedAdminMutationAllowed(target, 'change_grants');
    if (role.systemProtected) return reply.code(403).send({ error: 'PROTECTED_ROLE', message: '系统保护角色不能授予其他账号' });
    const window = resolveGrantWindow({ preset: input.preset, customExpiresAt: input.customExpiresAt });
    const actorId = currentUserId(request);
    const grant = await prisma.$transaction(async (tx) => {
      const existing = await tx.userRoleGrant.findFirst({ where: { userId: input.userId, roleId: input.roleId }, orderBy: { createdAt: 'desc' } });
      const beforeData = existing ? { startsAt: existing.startsAt.toISOString(), expiresAt: existing.expiresAt?.toISOString() ?? null, revokedAt: existing.revokedAt?.toISOString() ?? null } : undefined;
      const saved = existing
        ? await tx.userRoleGrant.update({ where: { id: existing.id }, data: { ...window, grantedBy: actorId, revokedAt: null, revokedBy: null, revokeReason: null } })
        : await tx.userRoleGrant.create({ data: { userId: input.userId, roleId: input.roleId, grantedBy: actorId, ...window } });
      await tx.roleGrantAudit.create({ data: { grantId: saved.id, actorId, action: existing ? 'renew' : 'grant', beforeData, afterData: { startsAt: saved.startsAt.toISOString(), expiresAt: saved.expiresAt?.toISOString() ?? null, isPermanent: saved.isPermanent }, reason: input.reason } });
      return saved;
    });
    realtime.invalidatePermissions([input.userId]);
    return reply.code(201).send({ grant: { ...grant, id: grant.id.toString(), userId: grant.userId.toString(), roleId: grant.roleId.toString(), grantedBy: grant.grantedBy?.toString() ?? null } });
  });

  app.post('/api/admin/role-grants/:id/revoke', { preHandler: app.authenticate }, async (request, reply) => {
    if (!await requireRequestPermission(request, reply, PERMISSION_KEYS.permissionRoleRevoke)) return;
    const params = notificationParamsSchema.parse(request.params);
    const input = z.object({ reason: z.string().trim().min(1).max(500) }).parse(request.body);
    assertSafeText(input.reason);
    const current = await prisma.userRoleGrant.findUnique({ where: { id: params.id }, include: { user: { select: { protectedAdminKey: true } }, role: true } });
    if (!current) return reply.code(404).send({ error: 'GRANT_NOT_FOUND', message: '授权不存在' });
    assertProtectedAdminMutationAllowed(current.user, 'change_grants');
    if (current.role.systemProtected) return reply.code(403).send({ error: 'PROTECTED_ROLE', message: '系统保护授权不能撤销' });
    const actorId = currentUserId(request);
    const grant = await prisma.$transaction(async (tx) => {
      const updated = await tx.userRoleGrant.update({ where: { id: current.id }, data: { revokedAt: new Date(), revokedBy: actorId, revokeReason: input.reason } });
      await tx.roleGrantAudit.create({ data: { grantId: current.id, actorId, action: 'revoke', beforeData: { revokedAt: current.revokedAt?.toISOString() ?? null }, afterData: { revokedAt: updated.revokedAt?.toISOString() ?? null }, reason: input.reason } });
      await offSalePublisherProductsIfUnauthorized(tx as unknown as ShopMaintenanceClient, current.userId);
      return updated;
    });
    realtime.invalidatePermissions([current.userId]);
    return { grant: { ...grant, id: grant.id.toString(), userId: grant.userId.toString(), roleId: grant.roleId.toString(), grantedBy: grant.grantedBy?.toString() ?? null, revokedBy: grant.revokedBy?.toString() ?? null } };
  });

  app.get('/api/admin/role-grant-audit', { preHandler: app.authenticate }, async (request, reply) => {
    if (!await requireRequestPermission(request, reply, PERMISSION_KEYS.permissionRoleGrant)) return;
    const query = z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) }).parse(request.query);
    const audits = await prisma.roleGrantAudit.findMany({
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      include: {
        actor: { select: { id: true, nickname: true } },
        grant: { include: { user: { select: { id: true, nickname: true } }, role: { select: { id: true, name: true } } } },
      },
    });
    return { audits: audits.map((audit) => ({
      ...audit,
      id: audit.id.toString(),
      grantId: audit.grantId?.toString() ?? null,
      actorId: audit.actorId?.toString() ?? null,
      actor: audit.actor ? { ...audit.actor, id: audit.actor.id.toString() } : null,
      grant: audit.grant ? {
        id: audit.grant.id.toString(),
        user: { ...audit.grant.user, id: audit.grant.user.id.toString() },
        role: { ...audit.grant.role, id: audit.grant.role.id.toString() },
      } : null,
    })) };
  });

  const shopCatalogQuerySchema = z.object({
    q: z.string().trim().max(120).default(''),
    type: z.enum(['virtual', 'physical']).optional(),
    category: z.string().trim().max(60).optional(),
    sort: z.enum(['newest', 'price_asc', 'price_desc', 'sales']).default('newest'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  });
  const shopCartInputSchema = z.object({ productId: z.coerce.bigint(), quantity: z.coerce.number().int().min(1).max(100) });
  const shopCartParamsSchema = z.object({ id: z.coerce.bigint() });
  const shopOrderListQuerySchema = z.object({ status: orderStatusSchema.optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });

  app.post('/api/shop/images', { preHandler: app.authenticate }, async (request, reply) => {
    const canUpload = await hasRequestPermission(request, PERMISSION_KEYS.shopProductCreateOwn)
      || await hasRequestPermission(request, PERMISSION_KEYS.shopProductViewAll);
    if (!canUpload) return reply.code(403).send({ error: 'FORBIDDEN', message: '没有上传商品图片的权限' });
    const validated: ValidatedFeedbackAttachment[] = [];
    try {
      for await (const part of request.files()) {
        const buffer = await part.toBuffer();
        if (validated.length >= 10) return reply.code(400).send({ error: 'TOO_MANY_SHOP_IMAGES', message: '每次最多上传 10 张商品图片' });
        if (part.file.truncated || buffer.length > MAX_FEEDBACK_ATTACHMENT_BYTES) throw new ProtectedFileError('FILE_TOO_LARGE');
        validated.push(await validateFeedbackAttachment({ buffer, originalName: part.filename, declaredMime: part.mimetype }));
      }
    } catch (error) {
      const code = error instanceof ProtectedFileError ? error.code : (error as { code?: string }).code;
      if (code === 'FILE_TOO_LARGE' || code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ error: 'FILE_TOO_LARGE', message: '单张图片不能超过 5 MiB' });
      if (error instanceof ProtectedFileError) return reply.code(400).send({ error: error.code, message: '商品图片必须是内容真实匹配的 JPG、PNG 或 WebP 图片' });
      throw error;
    }
    if (!validated.length) return reply.code(400).send({ error: 'SHOP_IMAGE_REQUIRED', message: '请选择需要上传的商品图片' });
    const persisted: string[] = [];
    try {
      for (const image of validated) {
        await persistProtectedFile(config.SHOP_IMAGE_ROOT, image);
        persisted.push(image.storageKey);
      }
    } catch (error) {
      await Promise.all(persisted.map((storageKey) => removeProtectedFile(config.SHOP_IMAGE_ROOT, storageKey)));
      throw error;
    }
    return reply.code(201).send({ images: validated.map((image) => ({
      url: `/api/shop/images/${image.storageKey}`,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
    })) });
  });

  app.get('/api/shop/images/:key', async (request, reply) => {
    const params = z.object({ key: z.string().regex(/^[a-f0-9-]+\.(?:jpg|png|webp)$/) }).parse(request.params);
    try {
      const content = await readProtectedFile(config.SHOP_IMAGE_ROOT, params.key);
      const extension = params.key.slice(params.key.lastIndexOf('.') + 1);
      const mimeType = extension === 'jpg' ? 'image/jpeg' : `image/${extension}`;
      return reply.header('Content-Type', mimeType).header('Cache-Control', 'public, max-age=31536000, immutable').header('X-Content-Type-Options', 'nosniff').send(content);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return reply.code(404).send({ error: 'SHOP_IMAGE_NOT_FOUND', message: '商品图片不存在' });
      throw error;
    }
  });

  app.get('/api/shop/products', { preHandler: app.authenticate }, async (request) => {
    const query = shopCatalogQuerySchema.parse(request.query);
    const orderBy = query.sort === 'price_asc' ? { price: 'asc' as const }
      : query.sort === 'price_desc' ? { price: 'desc' as const }
      : query.sort === 'sales' ? { salesCount: 'desc' as const }
      : { publishedAt: 'desc' as const };
    const products = await prisma.shopProduct.findMany({
      where: {
        status: 'on_sale',
        ...(query.type ? { type: query.type } : {}),
        ...(query.category ? { category: query.category } : {}),
        ...(query.q ? { OR: [{ name: { contains: query.q } }, { summary: { contains: query.q } }, { description: { contains: query.q } }] } : {}),
      },
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: { images: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } }, _count: { select: { reviews: true } } },
    });
    return { products: products.map(serializeShopProduct), page: query.page, pageSize: query.pageSize };
  });

  app.get('/api/shop/products/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const params = shopCartParamsSchema.parse(request.params);
    const product = await prisma.shopProduct.findFirst({
      where: { id: params.id, status: 'on_sale' },
      include: {
        images: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } },
        reviews: { where: { visible: true }, orderBy: { createdAt: 'desc' }, take: 30, select: { id: true, userId: true, rating: true, content: true, createdAt: true } },
      },
    });
    if (!product) return reply.code(404).send({ error: 'SHOP_PRODUCT_NOT_FOUND', message: '商品不存在或已下架' });
    await prisma.shopProduct.update({ where: { id: product.id }, data: { viewCount: { increment: 1 } } }).catch(() => undefined);
    return { product: serializeShopProduct(product) };
  });

  app.get('/api/shop/cart', { preHandler: app.authenticate }, async (request) => {
    const items = await prisma.shopCartItem.findMany({
      where: { userId: currentUserId(request) },
      orderBy: { updatedAt: 'desc' },
      include: { product: { include: { images: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' }, take: 1 } } } },
    });
    return { items: items.map((item) => ({ ...serializeShopProduct(item), changed: item.product.status !== 'on_sale' || (!item.product.unlimitedStock && (item.product.stock ?? 0) < item.quantity) })) };
  });

  app.post('/api/shop/cart', { preHandler: app.authenticate }, async (request, reply) => {
    const input = shopCartInputSchema.parse(request.body);
    const product = await prisma.shopProduct.findFirst({ where: { id: input.productId, status: 'on_sale' } });
    if (!product) return reply.code(404).send({ error: 'SHOP_PRODUCT_NOT_FOUND', message: '商品不存在或已下架' });
    if (input.quantity < product.minQuantity || input.quantity > product.maxQuantity) return reply.code(409).send({ error: 'SHOP_QUANTITY_LIMIT', message: '购买数量超出商品限制' });
    if (!product.unlimitedStock && (product.stock ?? 0) < input.quantity) return reply.code(409).send({ error: 'SHOP_STOCK_INSUFFICIENT', message: '商品库存不足' });
    const item = await prisma.shopCartItem.upsert({
      where: { userId_productId: { userId: currentUserId(request), productId: product.id } },
      create: { userId: currentUserId(request), productId: product.id, quantity: input.quantity },
      update: { quantity: input.quantity },
    });
    return reply.code(201).send({ item: serializeShopProduct(item) });
  });

  app.patch('/api/shop/cart/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const params = shopCartParamsSchema.parse(request.params);
    const input = z.object({ quantity: z.coerce.number().int().min(1).max(100) }).parse(request.body);
    const current = await prisma.shopCartItem.findFirst({ where: { id: params.id, userId: currentUserId(request) }, include: { product: true } });
    if (!current) return reply.code(404).send({ error: 'SHOP_CART_ITEM_NOT_FOUND', message: '购物车商品不存在' });
    if (input.quantity < current.product.minQuantity || input.quantity > current.product.maxQuantity) return reply.code(409).send({ error: 'SHOP_QUANTITY_LIMIT', message: '购买数量超出商品限制' });
    const item = await prisma.shopCartItem.update({ where: { id: current.id }, data: { quantity: input.quantity } });
    return { item: serializeShopProduct(item) };
  });

  app.delete('/api/shop/cart/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const params = shopCartParamsSchema.parse(request.params);
    const current = await prisma.shopCartItem.findFirst({ where: { id: params.id, userId: currentUserId(request) } });
    if (!current) return reply.code(404).send({ error: 'SHOP_CART_ITEM_NOT_FOUND', message: '购物车商品不存在' });
    await prisma.shopCartItem.delete({ where: { id: current.id } });
    return reply.code(204).send();
  });

  app.get('/api/shop/addresses', { preHandler: app.authenticate }, async (request) => {
    const addresses = await prisma.shippingAddress.findMany({ where: { userId: currentUserId(request) }, orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }] });
    return { addresses: addresses.map(serializeShopProduct) };
  });

  app.post('/api/shop/addresses', { preHandler: app.authenticate }, async (request, reply) => {
    const input = shippingAddressInputSchema.parse(request.body);
    assertSafeText(input.recipientName, input.province, input.city, input.district, input.detail);
    const userId = currentUserId(request);
    const address = await prisma.$transaction(async (tx) => {
      const count = await tx.shippingAddress.count({ where: { userId } });
      const makeDefault = input.isDefault || count === 0;
      if (makeDefault) await tx.shippingAddress.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
      return tx.shippingAddress.create({ data: { ...input, postalCode: input.postalCode ?? null, isDefault: makeDefault, userId } });
    });
    return reply.code(201).send({ address: serializeShopProduct(address) });
  });

  app.patch('/api/shop/addresses/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const params = shopCartParamsSchema.parse(request.params);
    const input = shippingAddressInputSchema.partial().parse(request.body);
    assertSafeText(input.recipientName, input.province, input.city, input.district, input.detail);
    const userId = currentUserId(request);
    const current = await prisma.shippingAddress.findFirst({ where: { id: params.id, userId } });
    if (!current) return reply.code(404).send({ error: 'SHOP_ADDRESS_NOT_FOUND', message: '收货地址不存在' });
    const address = await prisma.$transaction(async (tx) => {
      if (input.isDefault) await tx.shippingAddress.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
      return tx.shippingAddress.update({ where: { id: current.id }, data: input });
    });
    return { address: serializeShopProduct(address) };
  });

  app.delete('/api/shop/addresses/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const params = shopCartParamsSchema.parse(request.params);
    const userId = currentUserId(request);
    const current = await prisma.shippingAddress.findFirst({ where: { id: params.id, userId } });
    if (!current) return reply.code(404).send({ error: 'SHOP_ADDRESS_NOT_FOUND', message: '收货地址不存在' });
    await prisma.shippingAddress.delete({ where: { id: current.id } });
    if (current.isDefault) {
      const next = await prisma.shippingAddress.findFirst({ where: { userId }, orderBy: { updatedAt: 'desc' } });
      if (next) await prisma.shippingAddress.update({ where: { id: next.id }, data: { isDefault: true } });
    }
    return reply.code(204).send();
  });

  app.get('/api/shop/entitlements', { preHandler: app.authenticate }, async (request) => {
    const entitlements = await prisma.userEntitlement.findMany({
      where: { userId: currentUserId(request) },
      orderBy: { acquiredAt: 'desc' },
      include: {
        product: { select: { name: true } },
        orderItem: { select: { id: true, redeemCodes: { where: { status: 'assigned' }, select: { id: true, codeMask: true, codeCiphertext: true, status: true } } } },
      },
    });
    return { entitlements: entitlements.map((entitlement) => {
      const serialized = serializeShopProduct(entitlement) as Record<string, unknown>;
      if (entitlement.type === 'redeem_code') {
        serialized.payload = {
          ...(entitlement.payload && typeof entitlement.payload === 'object' && !Array.isArray(entitlement.payload) ? entitlement.payload as Record<string, unknown> : {}),
          codes: entitlement.orderItem.redeemCodes.map((code) => decryptRedeemCode(code.codeCiphertext, shopRedeemCodeSecret)),
          masks: entitlement.orderItem.redeemCodes.map((code) => code.codeMask),
        };
      }
      serialized.orderItem = { id: entitlement.orderItem.id.toString() };
      return serialized;
    }) };
  });

  app.get('/api/shop/orders', { preHandler: app.authenticate }, async (request) => {
    const query = shopOrderListQuerySchema.parse(request.query);
    const orders = await prisma.shopOrder.findMany({ where: { userId: currentUserId(request), ...(query.status ? { status: query.status } : {}) }, orderBy: { createdAt: 'desc' }, take: query.limit, include: { items: true } });
    return { orders: orders.map(serializeShopOrder) };
  });

  app.post('/api/shop/orders', { preHandler: app.authenticate }, async (request, reply) => {
    const input = createShopOrderSchema.parse(request.body);
    const userId = currentUserId(request);
    const existing = await prisma.shopOrder.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { items: true } });
    if (existing) {
      if (existing.userId !== userId) return reply.code(409).send({ error: 'SHOP_IDEMPOTENCY_CONFLICT', message: '幂等键已被使用' });
      return { order: serializeShopOrder(existing), duplicate: true };
    }
    try {
      const order = await prisma.$transaction(async (tx) => {
        const duplicate = await tx.shopOrder.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { items: true } });
        if (duplicate) {
          if (duplicate.userId !== userId) throw new ShopRuleError('SHOP_IDEMPOTENCY_CONFLICT');
          return duplicate;
        }
        const productIds = input.items.map((item) => BigInt(item.productId));
        await tx.$queryRaw(Prisma.sql`SELECT id FROM shop_products WHERE id IN (${Prisma.join(productIds)}) FOR UPDATE`);
        const products = await tx.shopProduct.findMany({ where: { id: { in: productIds }, status: 'on_sale' } });
        if (products.length !== productIds.length) throw new ShopRuleError('SHOP_PRODUCT_UNAVAILABLE');
        const productById = new Map(products.map((product) => [product.id.toString(), product]));
        const checked = input.items.map((item) => {
          const product = productById.get(item.productId);
          if (!product) throw new ShopRuleError('SHOP_PRODUCT_UNAVAILABLE');
          if (item.quantity < product.minQuantity || item.quantity > product.maxQuantity) throw new ShopRuleError('SHOP_QUANTITY_LIMIT');
          if (!product.unlimitedStock && (product.stock ?? 0) < item.quantity) throw new ShopRuleError('SHOP_STOCK_INSUFFICIENT');
          return { product, quantity: item.quantity, price: product.price };
        });
        const needsShipment = checked.some((item) => item.product.type === 'physical');
        const address = needsShipment && input.addressId
          ? await tx.shippingAddress.findFirst({ where: { id: BigInt(input.addressId), userId } })
          : null;
        if (needsShipment && !address) throw new ShopRuleError('SHOP_ADDRESS_REQUIRED');
        const totalAmount = calculateShopOrderTotal(checked);
        await tx.$queryRaw(Prisma.sql`SELECT user_id FROM point_accounts WHERE user_id = ${userId} FOR UPDATE`);
        const account = await tx.pointAccount.findUnique({ where: { userId } });
        if (!account) throw new ShopRuleError('SHOP_POINT_ACCOUNT_NOT_FOUND');
        if (account.availableBalance < totalAmount) throw new ShopRuleError('SHOP_POINTS_INSUFFICIENT');

        const created = await tx.shopOrder.create({
          data: {
            userId,
            status: needsShipment ? 'awaiting_shipment' : 'completed',
            totalAmount,
            needsShipment,
            idempotencyKey: input.idempotencyKey,
            addressId: address?.id ?? null,
            recipientName: address?.recipientName ?? null,
            phone: address?.phone ?? null,
            addressSnapshot: address ? {
              recipientName: address.recipientName,
              phone: address.phone,
              province: address.province,
              city: address.city,
              district: address.district,
              detail: address.detail,
              postalCode: address.postalCode,
            } : undefined,
            completedAt: needsShipment ? null : new Date(),
            items: {
              create: checked.map(({ product, quantity }) => ({
                productId: product.id,
                productName: product.name,
                productType: product.type,
                unitPrice: product.price,
                quantity,
                fulfillmentStatus: product.type === 'virtual' ? 'delivered' : 'pending',
                fulfillmentData: product.type === 'virtual' ? (product.fulfillmentData ?? undefined) : undefined,
              })),
            },
          },
          include: { items: true },
        });

        for (const { product, quantity } of checked) {
          if (!product.unlimitedStock) {
            const changed = await tx.shopProduct.updateMany({ where: { id: product.id, stock: { gte: quantity }, status: 'on_sale' }, data: { stock: { decrement: quantity }, salesCount: { increment: quantity } } });
            if (changed.count !== 1) throw new ShopRuleError('SHOP_STOCK_INSUFFICIENT');
          } else {
            await tx.shopProduct.update({ where: { id: product.id }, data: { salesCount: { increment: quantity } } });
          }
          if (product.type === 'virtual') {
            const orderItem = created.items.find((item) => item.productId === product.id)!;
            if (product.virtualType === 'redeem_code') {
              const codes = await tx.productRedeemCode.findMany({ where: { productId: product.id, status: 'available' }, orderBy: { id: 'asc' }, take: quantity });
              if (codes.length !== quantity) throw new ShopRuleError('SHOP_REDEEM_CODE_INSUFFICIENT');
              for (const code of codes) {
                const assigned = await tx.productRedeemCode.updateMany({ where: { id: code.id, status: 'available' }, data: { status: 'assigned', orderItemId: orderItem.id, assignedAt: new Date() } });
                if (assigned.count !== 1) throw new ShopRuleError('SHOP_REDEEM_CODE_INSUFFICIENT');
              }
              await tx.userEntitlement.create({ data: { userId, productId: product.id, orderItemId: orderItem.id, type: 'redeem_code', payload: { redeemCodeIds: codes.map((code) => code.id.toString()) } } });
            } else {
              await tx.userEntitlement.create({ data: { userId, productId: product.id, orderItemId: orderItem.id, type: product.virtualType ?? 'digital', payload: (product.fulfillmentData ?? {}) as Prisma.InputJsonValue } });
            }
          }
        }
        await applyBuddyPointDelta(tx, userId, -totalAmount, `shop-order:${created.id.toString()}`, 'shop_purchase', `商城订单支付:${created.id.toString()}`);
        await tx.notification.create({ data: { userId, type: 'shop_order_paid', refId: created.id.toString(), payload: { orderId: created.id.toString(), totalAmount, needsShipment } } });
        await tx.shopCartItem.deleteMany({ where: { userId, productId: { in: productIds } } });
        return created;
      });
      return reply.code(201).send({ order: serializeShopOrder(order), duplicate: false });
    } catch (error) {
      if (error instanceof ShopRuleError) {
        const messages: Record<string, string> = {
          SHOP_IDEMPOTENCY_CONFLICT: '幂等键已被使用',
          SHOP_PRODUCT_UNAVAILABLE: '商品不存在或已下架',
          SHOP_QUANTITY_LIMIT: '购买数量超出商品限制',
          SHOP_STOCK_INSUFFICIENT: '商品库存不足',
          SHOP_ADDRESS_REQUIRED: '实物商品必须选择有效收货地址',
          SHOP_POINT_ACCOUNT_NOT_FOUND: '蛋蛋币账户不存在',
          SHOP_POINTS_INSUFFICIENT: '蛋蛋币余额不足',
          SHOP_REDEEM_CODE_INSUFFICIENT: '兑换码库存不足',
        };
        return reply.code(409).send({ error: error.code, message: messages[error.code] ?? '下单失败' });
      }
      throw error;
    }
  });

  app.get('/api/shop/orders/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const params = shopCartParamsSchema.parse(request.params);
    const order = await prisma.shopOrder.findFirst({ where: { id: params.id, userId: currentUserId(request) }, include: { items: { include: { entitlements: true, redeemCodes: { select: { id: true, codeMask: true, status: true, assignedAt: true, usedAt: true } }, reviews: true } } } });
    if (!order) return reply.code(404).send({ error: 'SHOP_ORDER_NOT_FOUND', message: '订单不存在' });
    return { order: serializeShopOrder(order) };
  });

  app.post('/api/shop/orders/:id/cancel', { preHandler: app.authenticate }, async (request, reply) => {
    const params = shopCartParamsSchema.parse(request.params);
    const input = z.object({ reason: z.string().trim().min(2).max(500) }).parse(request.body);
    assertSafeText(input.reason);
    const order = await prisma.shopOrder.findFirst({ where: { id: params.id, userId: currentUserId(request) } });
    if (!order) return reply.code(404).send({ error: 'SHOP_ORDER_NOT_FOUND', message: '订单不存在' });
    if (order.status !== 'awaiting_shipment') return reply.code(409).send({ error: 'SHOP_ORDER_CANNOT_CANCEL', message: order.status === 'shipped' ? '订单已发货，不能在线取消' : '当前订单状态不能取消' });
    const updated = await prisma.shopOrder.update({ where: { id: order.id }, data: { status: 'cancel_requested', cancelReason: input.reason } });
    return { order: serializeShopOrder(updated) };
  });

  app.post('/api/shop/orders/:id/confirm-receipt', { preHandler: app.authenticate }, async (request, reply) => {
    const params = shopCartParamsSchema.parse(request.params);
    const order = await prisma.shopOrder.findFirst({ where: { id: params.id, userId: currentUserId(request) } });
    if (!order) return reply.code(404).send({ error: 'SHOP_ORDER_NOT_FOUND', message: '订单不存在' });
    if (order.status !== 'shipped') return reply.code(409).send({ error: 'SHOP_ORDER_NOT_SHIPPED', message: '订单尚未发货或已完成' });
    const updated = await prisma.shopOrder.update({ where: { id: order.id }, data: { status: 'completed', completedAt: new Date() } });
    return { order: serializeShopOrder(updated) };
  });

  app.post('/api/shop/orders/:id/items/:itemId/review', { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ id: z.coerce.bigint(), itemId: z.coerce.bigint() }).parse(request.params);
    const input = z.object({ rating: z.coerce.number().int().min(1).max(5), content: z.string().trim().max(2000).nullable().optional() }).parse(request.body);
    assertSafeText(input.content);
    const order = await prisma.shopOrder.findFirst({ where: { id: params.id, userId: currentUserId(request), status: 'completed' }, include: { items: { where: { id: params.itemId }, select: { id: true, productId: true } } } });
    if (!order || order.items.length !== 1) return reply.code(404).send({ error: 'SHOP_ORDER_ITEM_NOT_REVIEWABLE', message: '订单商品不存在或尚未完成' });
    try {
      const review = await prisma.productReview.create({ data: { productId: order.items[0].productId, orderItemId: order.items[0].id, userId: currentUserId(request), rating: input.rating, content: input.content ?? null } });
      return reply.code(201).send({ review: serializeShopProduct(review) });
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') return reply.code(409).send({ error: 'SHOP_REVIEW_EXISTS', message: '该商品已经评价过' });
      throw error;
    }
  });

  app.get('/api/admin/shop/products', { preHandler: app.authenticate }, async (request, reply) => {
    if (!await requireRequestPermission(request, reply, PERMISSION_KEYS.shopProductViewAll)) return;
    const query = z.object({ status: productStatusSchema.optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(request.query);
    const products = await prisma.shopProduct.findMany({ where: query.status ? { status: query.status } : {}, orderBy: { createdAt: 'desc' }, take: query.limit, include: { images: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } } });
    return { products: products.map(serializeShopProduct) };
  });

  app.post('/api/admin/shop/products/:id/review', { preHandler: app.authenticate }, async (request, reply) => {
    if (!await requireRequestPermission(request, reply, PERMISSION_KEYS.shopProductReview)) return;
    const params = shopCartParamsSchema.parse(request.params);
    const input = z.object({ decision: z.enum(['approved', 'rejected']), reason: z.string().trim().max(500).nullable().optional(), price: z.coerce.number().int().positive().max(10_000_000).optional() }).parse(request.body);
    assertSafeText(input.reason);
    const current = await prisma.shopProduct.findUnique({ where: { id: params.id } });
    if (!current) return reply.code(404).send({ error: 'SHOP_PRODUCT_NOT_FOUND', message: '商品不存在' });
    if (current.status !== 'pending_review') return reply.code(409).send({ error: 'SHOP_PRODUCT_STATE_INVALID', message: '商品不在待审核状态' });
    if (input.decision === 'rejected' && !input.reason) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: '驳回时必须填写原因' });
    const product = await prisma.shopProduct.update({ where: { id: current.id }, data: { status: input.decision, reviewReason: input.reason ?? null, reviewedBy: currentUserId(request), reviewedAt: new Date(), ...(input.price === undefined ? {} : { price: input.price }) } });
    if (current.publisherId) await prisma.notification.create({ data: { userId: current.publisherId, type: input.decision === 'approved' ? 'shop_product_approved' : 'shop_product_rejected', refId: current.id.toString(), payload: { productId: current.id.toString(), reason: input.reason ?? null } } }).catch(() => undefined);
    await recordAudit({ actorId: currentUserId(request), action: `shop.product.${input.decision}`, targetType: 'shop_product', targetId: current.id.toString(), ip: request.ip, afterData: { status: input.decision, price: product.price } });
    return { product: serializeShopProduct(product) };
  });

  app.post('/api/admin/shop/products/:id/publish', { preHandler: app.authenticate }, async (request, reply) => {
    if (!await requireRequestPermission(request, reply, PERMISSION_KEYS.shopProductPublish)) return;
    const params = shopCartParamsSchema.parse(request.params);
    const current = await prisma.shopProduct.findUnique({ where: { id: params.id } });
    if (!current) return reply.code(404).send({ error: 'SHOP_PRODUCT_NOT_FOUND', message: '商品不存在' });
    if (!['approved', 'off_sale', 'sold_out'].includes(current.status)) return reply.code(409).send({ error: 'SHOP_PRODUCT_STATE_INVALID', message: '当前商品状态不能上架' });
    if (!current.unlimitedStock && (current.stock ?? 0) <= 0) return reply.code(409).send({ error: 'SHOP_STOCK_INSUFFICIENT', message: '库存不足，不能上架' });
    const product = await prisma.shopProduct.update({ where: { id: current.id }, data: { status: 'on_sale', publishedAt: new Date() } });
    await recordAudit({ actorId: currentUserId(request), action: 'shop.product.publish', targetType: 'shop_product', targetId: current.id.toString(), ip: request.ip });
    return { product: serializeShopProduct(product) };
  });

  app.post('/api/admin/shop/products/:id/off-sale', { preHandler: app.authenticate }, async (request, reply) => {
    if (!await requireRequestPermission(request, reply, PERMISSION_KEYS.shopProductPublish)) return;
    const params = shopCartParamsSchema.parse(request.params);
    const current = await prisma.shopProduct.findUnique({ where: { id: params.id } });
    if (!current) return reply.code(404).send({ error: 'SHOP_PRODUCT_NOT_FOUND', message: '商品不存在' });
    const product = await prisma.shopProduct.update({ where: { id: current.id }, data: { status: 'off_sale' } });
    if (current.publisherId) await prisma.notification.create({ data: { userId: current.publisherId, type: 'shop_product_off_sale', refId: current.id.toString(), payload: { productId: current.id.toString() } } }).catch(() => undefined);
    await recordAudit({ actorId: currentUserId(request), action: 'shop.product.off_sale', targetType: 'shop_product', targetId: current.id.toString(), ip: request.ip });
    return { product: serializeShopProduct(product) };
  });

  app.post('/api/admin/shop/products/:id/archive', { preHandler: app.authenticate }, async (request, reply) => {
    if (!await requireRequestPermission(request, reply, PERMISSION_KEYS.shopProductArchive)) return;
    const params = shopCartParamsSchema.parse(request.params);
    const current = await prisma.shopProduct.findUnique({ where: { id: params.id } });
    if (!current) return reply.code(404).send({ error: 'SHOP_PRODUCT_NOT_FOUND', message: '商品不存在' });
    const product = await prisma.shopProduct.update({ where: { id: current.id }, data: { status: 'archived', archivedAt: new Date() } });
    await recordAudit({ actorId: currentUserId(request), action: 'shop.product.archive', targetType: 'shop_product', targetId: current.id.toString(), ip: request.ip });
    return { product: serializeShopProduct(product) };
  });

  app.patch('/api/admin/shop/products/:id/inventory', { preHandler: app.authenticate }, async (request, reply) => {
    if (!await requireRequestPermission(request, reply, PERMISSION_KEYS.shopInventoryManage)) return;
    const params = shopCartParamsSchema.parse(request.params);
    const input = z.object({ stock: z.coerce.number().int().min(0).max(10_000_000) }).parse(request.body);
    const current = await prisma.shopProduct.findUnique({ where: { id: params.id } });
    if (!current) return reply.code(404).send({ error: 'SHOP_PRODUCT_NOT_FOUND', message: '商品不存在' });
    const product = await prisma.shopProduct.update({ where: { id: current.id }, data: { stock: input.stock, ...(input.stock === 0 && current.status === 'on_sale' ? { status: 'sold_out' as const } : {}) } });
    await recordAudit({ actorId: currentUserId(request), action: 'shop.inventory.update', targetType: 'shop_product', targetId: current.id.toString(), ip: request.ip, afterData: { stock: input.stock } });
    return { product: serializeShopProduct(product) };
  });

  app.post('/api/admin/shop/products/:id/redeem-codes', { preHandler: app.authenticate }, async (request, reply) => {
    if (!await requireRequestPermission(request, reply, PERMISSION_KEYS.shopRedeemCodeManage)) return;
    const params = shopCartParamsSchema.parse(request.params);
    const input = z.object({ codes: z.array(z.string().trim().min(4).max(200).regex(/^[^\r\n]+$/)).min(1).max(500) }).parse(request.body);
    const product = await prisma.shopProduct.findUnique({ where: { id: params.id } });
    if (!product) return reply.code(404).send({ error: 'SHOP_PRODUCT_NOT_FOUND', message: '商品不存在' });
    if (product.type !== 'virtual' || product.virtualType !== 'redeem_code') return reply.code(409).send({ error: 'SHOP_REDEEM_CODE_PRODUCT_REQUIRED', message: '只有兑换码型虚拟商品可以导入兑换码' });
    const codes = [...new Set(input.codes.map((code) => code.trim()))];
    const result = await prisma.productRedeemCode.createMany({
      data: codes.map((code) => ({
        productId: product.id,
        codeHash: hashRedeemCode(code),
        codeMask: maskRedeemCode(code),
        codeCiphertext: encryptRedeemCode(code, shopRedeemCodeSecret),
      })),
      skipDuplicates: true,
    });
    await recordAudit({ actorId: currentUserId(request), action: 'shop.redeem_code.import', targetType: 'shop_product', targetId: product.id.toString(), ip: request.ip, afterData: { imported: result.count, submitted: codes.length } });
    return reply.code(201).send({ imported: result.count });
  });

  app.get('/api/admin/shop/orders', { preHandler: app.authenticate }, async (request, reply) => {
    if (!await requireRequestPermission(request, reply, PERMISSION_KEYS.shopOrderView)) return;
    const query = shopOrderListQuerySchema.parse(request.query);
    const orders = await prisma.shopOrder.findMany({ where: query.status ? { status: query.status } : {}, orderBy: { createdAt: 'desc' }, take: query.limit, include: { items: true, user: { select: { id: true, nickname: true } } } });
    return { orders: orders.map(serializeShopOrder) };
  });

  app.post('/api/admin/shop/orders/:id/ship', { preHandler: app.authenticate }, async (request, reply) => {
    if (!await requireRequestPermission(request, reply, PERMISSION_KEYS.shopOrderShip)) return;
    const params = shopCartParamsSchema.parse(request.params);
    const input = z.object({ carrier: z.string().trim().min(2).max(60), trackingNumber: z.string().trim().min(4).max(100) }).parse(request.body);
    assertSafeText(input.carrier, input.trackingNumber);
    const order = await prisma.shopOrder.findUnique({ where: { id: params.id } });
    if (!order) return reply.code(404).send({ error: 'SHOP_ORDER_NOT_FOUND', message: '订单不存在' });
    if (order.status !== 'awaiting_shipment') return reply.code(409).send({ error: 'SHOP_ORDER_CANNOT_SHIP', message: '当前订单状态不能发货' });
    const updated = await prisma.shopOrder.update({ where: { id: order.id }, data: { status: 'shipped', carrier: input.carrier, trackingNumber: input.trackingNumber, shippedAt: new Date() } });
    await prisma.notification.create({ data: { userId: order.userId, type: 'shop_order_shipped', refId: order.id.toString(), payload: { orderId: order.id.toString(), carrier: input.carrier, trackingNumber: input.trackingNumber } } });
    await recordAudit({ actorId: currentUserId(request), action: 'shop.order.ship', targetType: 'shop_order', targetId: order.id.toString(), ip: request.ip });
    return { order: serializeShopOrder(updated) };
  });

  app.post('/api/admin/shop/orders/:id/refund', { preHandler: app.authenticate }, async (request, reply) => {
    if (!await requireRequestPermission(request, reply, PERMISSION_KEYS.shopOrderRefund)) return;
    if (!await requireRequestPermission(request, reply, PERMISSION_KEYS.pointsRefund)) return;
    const params = shopCartParamsSchema.parse(request.params);
    const input = z.object({ reason: z.string().trim().min(2).max(500) }).parse(request.body);
    assertSafeText(input.reason);
    try {
      const order = await prisma.$transaction(async (tx) => {
        const current = await tx.shopOrder.findUnique({ where: { id: params.id } });
        if (!current) throw new ShopRuleError('SHOP_ORDER_NOT_FOUND');
        if (current.status === 'refunded') return current;
        if (!['awaiting_shipment', 'cancel_requested', 'refunding'].includes(current.status)) throw new ShopRuleError('SHOP_ORDER_CANNOT_REFUND');
        await applyBuddyPointDelta(tx, current.userId, current.totalAmount, `shop-refund:${current.id.toString()}`, 'shop_refund', `商城订单退款:${current.id.toString()}`);
        const updated = await tx.shopOrder.update({ where: { id: current.id }, data: { status: 'refunded', refundReason: input.reason, refundedAt: new Date(), cancelledAt: new Date() } });
        await tx.notification.create({ data: { userId: current.userId, type: 'shop_order_refunded', refId: current.id.toString(), payload: { orderId: current.id.toString(), amount: current.totalAmount } } });
        return updated;
      });
      await recordAudit({ actorId: currentUserId(request), action: 'shop.order.refund', targetType: 'shop_order', targetId: params.id.toString(), ip: request.ip, afterData: { reason: input.reason } });
      return { order: serializeShopOrder(order) };
    } catch (error) {
      if (error instanceof ShopRuleError) return reply.code(error.code === 'SHOP_ORDER_NOT_FOUND' ? 404 : 409).send({ error: error.code, message: error.code === 'SHOP_ORDER_NOT_FOUND' ? '订单不存在' : '当前订单状态不能退款' });
      throw error;
    }
  });

  app.get('/api/admin/shop/reviews', { preHandler: app.authenticate }, async (request, reply) => {
    if (!await requireRequestPermission(request, reply, PERMISSION_KEYS.shopReviewModerate)) return;
    const reviews = await prisma.productReview.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { product: { select: { id: true, name: true } }, user: { select: { id: true, nickname: true } } } });
    return { reviews: reviews.map(serializeShopProduct) };
  });

  app.post('/api/admin/shop/reviews/:id/hide', { preHandler: app.authenticate }, async (request, reply) => {
    if (!await requireRequestPermission(request, reply, PERMISSION_KEYS.shopReviewModerate)) return;
    const params = shopCartParamsSchema.parse(request.params);
    const input = z.object({ reason: z.string().trim().min(2).max(500) }).parse(request.body);
    assertSafeText(input.reason);
    const current = await prisma.productReview.findUnique({ where: { id: params.id } });
    if (!current) return reply.code(404).send({ error: 'SHOP_REVIEW_NOT_FOUND', message: '评价不存在' });
    const review = await prisma.productReview.update({ where: { id: current.id }, data: { visible: false, hiddenReason: input.reason, hiddenAt: new Date() } });
    await recordAudit({ actorId: currentUserId(request), action: 'shop.review.hide', targetType: 'product_review', targetId: current.id.toString(), ip: request.ip, afterData: { reason: input.reason } });
    return { review: serializeShopProduct(review) };
  });

  app.post('/api/admin/shop/maintenance', { preHandler: app.authenticate }, async (request, reply) => {
    if (!await requireRequestPermission(request, reply, PERMISSION_KEYS.shopMaintenanceRun)) return;
    const result = await runShopMaintenance(prisma as unknown as ShopMaintenanceClient);
    await recordAudit({
      actorId: currentUserId(request),
      action: 'shop.maintenance.run',
      targetType: 'shop',
      targetId: 'maintenance',
      ip: request.ip,
      afterData: result,
    });
    return result;
  });

  app.get('/api/shop/publisher/products', { preHandler: app.authenticate }, async (request, reply) => {
    if (!await requireRequestPermission(request, reply, PERMISSION_KEYS.shopProductCreateOwn)) return;
    const products = await prisma.shopProduct.findMany({ where: { publisherId: currentUserId(request) }, orderBy: { createdAt: 'desc' }, include: { images: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } } });
    return { products: products.map(serializeShopProduct) };
  });

  app.post('/api/shop/publisher/products', { preHandler: app.authenticate }, async (request, reply) => {
    if (!await requireRequestPermission(request, reply, PERMISSION_KEYS.shopProductCreateOwn)) return;
    const input = productInputSchema.parse(request.body);
    assertSafeText(input.name, input.category, input.summary, input.description, input.virtualType);
    assertSafeJsonText(input.fulfillmentData);
    const userId = currentUserId(request);
    const owner = await prisma.user.findUnique({ where: { id: userId }, select: { nickname: true } });
    if (!owner) return reply.code(404).send({ error: 'USER_NOT_FOUND', message: '用户不存在' });
    const product = await prisma.shopProduct.create({
      data: {
        publisherId: userId,
        publisherNickname: owner.nickname,
        name: input.name,
        type: input.type,
        category: input.category ?? null,
        summary: input.summary ?? null,
        description: input.description,
        price: input.price,
        stock: input.type === 'physical' ? input.stock : null,
        unlimitedStock: input.type === 'virtual',
        minQuantity: input.minQuantity,
        maxQuantity: input.maxQuantity,
        virtualType: input.virtualType ?? null,
        fulfillmentData: input.fulfillmentData as Prisma.InputJsonValue | undefined,
        images: input.imageUrls.length ? { create: input.imageUrls.map((url, index) => ({ url, kind: index === 0 ? 'main' : 'detail', sortOrder: index })) } : undefined,
      },
      include: { images: true },
    });
    return reply.code(201).send({ product: serializeShopProduct(product) });
  });

  app.patch('/api/shop/publisher/products/:id', { preHandler: app.authenticate }, async (request, reply) => {
    if (!await requireRequestPermission(request, reply, PERMISSION_KEYS.shopProductEditOwn)) return;
    const params = shopCartParamsSchema.parse(request.params);
    const input = productPatchSchema.parse(request.body);
    assertSafeText(input.name, input.category, input.summary, input.description, input.virtualType);
    assertSafeJsonText(input.fulfillmentData);
    const current = await prisma.shopProduct.findFirst({ where: { id: params.id, publisherId: currentUserId(request) } });
    if (!current) return reply.code(404).send({ error: 'SHOP_PRODUCT_NOT_FOUND', message: '商品不存在' });
    const importantChanged = ['name', 'type', 'price', 'stock', 'virtualType', 'fulfillmentData', 'imageUrls'].some((key) => key in input);
    const data: Prisma.ShopProductUpdateInput = {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.type === undefined ? {} : { type: input.type }),
      ...(input.category === undefined ? {} : { category: input.category }),
      ...(input.summary === undefined ? {} : { summary: input.summary }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.price === undefined ? {} : { price: input.price }),
      ...(input.stock === undefined ? {} : { stock: input.stock }),
      ...(input.minQuantity === undefined ? {} : { minQuantity: input.minQuantity }),
      ...(input.maxQuantity === undefined ? {} : { maxQuantity: input.maxQuantity }),
      ...(input.virtualType === undefined ? {} : { virtualType: input.virtualType }),
      ...(input.fulfillmentData === undefined ? {} : { fulfillmentData: input.fulfillmentData as Prisma.InputJsonValue }),
      ...(current.status === 'on_sale' && importantChanged ? { status: 'pending_review', publishedAt: null } : {}),
    };
    const product = await prisma.shopProduct.update({ where: { id: current.id }, data });
    return { product: serializeShopProduct(product) };
  });

  app.post('/api/shop/publisher/products/:id/submit-review', { preHandler: app.authenticate }, async (request, reply) => {
    if (!await requireRequestPermission(request, reply, PERMISSION_KEYS.shopProductSubmitOwn)) return;
    const params = shopCartParamsSchema.parse(request.params);
    const current = await prisma.shopProduct.findFirst({ where: { id: params.id, publisherId: currentUserId(request) } });
    if (!current) return reply.code(404).send({ error: 'SHOP_PRODUCT_NOT_FOUND', message: '商品不存在' });
    if (!['draft', 'rejected', 'off_sale'].includes(current.status)) return reply.code(409).send({ error: 'SHOP_PRODUCT_STATE_INVALID', message: '当前商品状态不能提交审核' });
    const product = await prisma.shopProduct.update({ where: { id: current.id }, data: { status: 'pending_review', reviewReason: null } });
    return { product: serializeShopProduct(product) };
  });

  app.get('/api/shop/publisher/products/:id/stats', { preHandler: app.authenticate }, async (request, reply) => {
    if (!await requireRequestPermission(request, reply, PERMISSION_KEYS.shopProductStatsOwn)) return;
    const params = shopCartParamsSchema.parse(request.params);
    const product = await prisma.shopProduct.findFirst({ where: { id: params.id, publisherId: currentUserId(request) }, select: { id: true, viewCount: true, salesCount: true, stock: true, price: true } });
    if (!product) return reply.code(404).send({ error: 'SHOP_PRODUCT_NOT_FOUND', message: '商品不存在' });
    const aggregate = await prisma.shopOrderItem.aggregate({ where: { productId: product.id, order: { status: { notIn: ['cancelled', 'refunded', 'failed'] } } }, _sum: { quantity: true, unitPrice: true }, _count: { id: true } });
    return { stats: { productId: product.id.toString(), views: product.viewCount, sales: product.salesCount, stock: product.stock, orderCount: aggregate._count.id, units: aggregate._sum.quantity ?? 0 } };
  });

  app.post('/api/tasks', { preHandler: app.authenticate }, async (request, reply) => {
    const input = taskCreateSchema.parse(request.body);
    assertSafeText(input.title, input.description, input.remark, input.contact, input.requirements);
    assertSafeSkillTags(input.skillCategory, input.skillSubcategory);
    const userId = currentUserId(request);
    try {
      const task = await prisma.$transaction(async (tx) => {
        const now = new Date();
        // Lock the stats row so concurrent publishes cannot consume the same daily slot.
        await tx.$queryRaw(Prisma.sql`SELECT user_id FROM user_stats WHERE user_id = ${userId} FOR UPDATE`);
        const stats = await tx.userStats.findUnique({ where: { userId } });
        const sameDay = isSameUtcDay(stats?.dailyPublishDate, now);
        const currentCount = sameDay ? (stats?.dailyPublishCount ?? 0) : 0;
        const attempt = currentCount + 1;
        const publishExpReward = publishRewardForAttempt(attempt);
        if (!publishExpReward) throw new DailyTaskPublishLimitError();
        await tx.userStats.update({
          where: { userId },
          data: { dailyPublishDate: now, dailyPublishCount: attempt, publishedTasks: { increment: 1 } },
        });
        return tx.task.create({ data: { userId, title: input.title, description: input.description, remark: input.remark ?? null, taskType: input.taskType, claimMode: input.claimMode, reward: input.reward, publishExpReward, maxClaimers: input.maxClaimers, contact: input.contact ?? null, requirements: input.requirements ?? null, skillCategory: input.skillCategory ?? null, skillSubcategory: input.skillSubcategory ?? null } });
      });
      publishRealtime(() => realtime.publishAdmin(realtimeEvent('task.pending', task.id, 'admin'), PERMISSION_KEYS.taskReview));
      return reply.code(201).send({ task: serializeTask(task) });
    } catch (error) {
      if (error instanceof DailyTaskPublishLimitError) return reply.code(429).send({ error: error.message, message: `每日最多发布 ${DAILY_TASK_PUBLISH_LIMIT} 次任务` });
      throw error;
    }
  });

  app.get('/api/tasks', { preHandler: app.authenticate }, async (request) => {
    const userId = currentUserId(request);
    const tasks = await prisma.task.findMany({
      where: taskVisibilityWhere({ userId, canReview: false, view: 'public' }),
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: taskListInclude(userId),
    });
    return { tasks: tasks.map(serializeTask) };
  });

  app.get('/api/admin/tasks/review-queue', { preHandler: app.authenticate }, async (request, reply) => {
    if (!await requireRequestPermission(request, reply, PERMISSION_KEYS.taskReview)) return;
    const userId = currentUserId(request);
    const tasks = await prisma.task.findMany({
      where: taskVisibilityWhere({ userId, canReview: true, view: 'review' }),
      orderBy: { createdAt: 'asc' },
      take: 100,
      include: taskListInclude(userId),
    });
    return { tasks: tasks.map(serializeTask) };
  });

  app.patch('/api/tasks/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const params = notificationParamsSchema.parse(request.params);
    const input = taskUpdateSchema.parse(request.body);
    assertSafeText(input.title, input.description, input.remark, input.contact, input.requirements);
    assertSafeSkillTags(input.skillCategory, input.skillSubcategory);
    const existing = await prisma.task.findUnique({ where: { id: params.id } });
    if (!existing) return reply.code(404).send({ error: 'TASK_NOT_FOUND', message: '任务不存在' });
    if (existing.userId !== currentUserId(request)) return reply.code(403).send({ error: 'FORBIDDEN', message: '只能编辑自己发布的任务' });
    if (!['draft', 'needs_revision', 'rejected'].includes(existing.status)) return reply.code(409).send({ error: 'TASK_STATE_INVALID', message: '当前任务状态不能编辑' });
    const task = await prisma.task.update({
      where: { id: existing.id },
      data: { ...input, status: 'pending_review', reviewReason: null, reviewedAt: null },
    });
    publishRealtime(() => realtime.publishAdmin(realtimeEvent('task.updated', task.id, 'admin'), PERMISSION_KEYS.taskReview));
    return { task: serializeTask(task) };
  });

  app.get('/api/tasks/mine', { preHandler: app.authenticate }, async (request) => {
    const query = taskMineQuerySchema.parse(request.query);
    const userId = currentUserId(request);
    const tasks = await prisma.task.findMany({ where: { ...taskVisibilityWhere({ userId, canReview: false, view: 'mine' }), ...(query.status ? { status: query.status } : {}) }, orderBy: { createdAt: 'desc' }, take: query.limit, include: taskListInclude(userId) });
    return { tasks: tasks.map(serializeTask) };
  });

  app.get('/api/tasks/claimed', { preHandler: app.authenticate }, async (request) => {
    const userId = currentUserId(request);
    const claims = await prisma.taskClaim.findMany({
      where: { claimerId: userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { task: true },
    });
    const ratedTaskIds = new Set((claims.length > 0
      ? await prisma.rating.findMany({
        where: { fromUserId: userId, taskId: { in: claims.map((claim) => claim.taskId) } },
        select: { taskId: true },
      })
      : []
    ).map((rating) => rating.taskId.toString()));
    return {
      claims: claims.map((claim) => ({
        ...claim,
        id: claim.id.toString(),
        taskId: claim.taskId.toString(),
        claimerId: claim.claimerId.toString(),
        ratedByCurrentUser: ratedTaskIds.has(claim.taskId.toString()),
        task: serializeTask(claim.task),
      })),
    };
  });

  app.patch('/api/tasks/:id/review', { preHandler: app.authenticate }, async (request, reply) => {
    if (!await requireRequestPermission(request, reply, PERMISSION_KEYS.taskReview)) return;
    const params = notificationParamsSchema.parse(request.params);
    const input = taskReviewSchema.parse(request.body);
    assertSafeText(input.reviewReason);
    const existing = await prisma.task.findUnique({ where: { id: params.id } });
    if (!existing) return reply.code(404).send({ error: 'TASK_NOT_FOUND', message: '任务不存在' });
    const now = new Date();
    let task;
    try {
      task = await prisma.$transaction(async (tx) => {
        const current = await tx.task.findUnique({ where: { id: params.id } });
        if (!current) throw new Error('TASK_NOT_FOUND');
        const firstApproval = input.status === 'approved' && current.status !== 'approved';
        const awardingExperience = firstApproval && current.publishExpReward > 0;
        if (input.status === 'approved' && current.userId !== currentUserId(request) && current.reward > 0 && (current.taskType === 'help' || current.taskType === 'team' || current.taskType === 'reward')) {
          const units = current.taskType === 'team' ? current.maxClaimers : 1;
          await applyBuddyPointDelta(tx, current.userId, -(current.reward * units), `task-review-freeze:${current.id.toString()}`, 'task_reward_frozen', `任务审核冻结蛋蛋币:${current.id.toString()}`);
        }
        if (awardingExperience) await tx.userStats.update({ where: { userId: current.userId }, data: { experience: { increment: current.publishExpReward } } });
        const updated = await tx.task.update({ where: { id: params.id }, data: { status: input.status, reviewReason: input.reviewReason ?? null, reviewedAt: input.status === 'approved' || input.status === 'needs_revision' ? now : current.reviewedAt, completedAt: input.status === 'completed' ? now : current.completedAt } });
        const invitationReward = firstApproval
          ? await rewardInvitationForApprovedTask(tx, current.userId, current.id, now)
          : { rewarded: false as const };
        await tx.notification.create({ data: { userId: current.userId, type: input.status === 'approved' ? 'task_review_approved' : 'task_review_needs_revision', refId: current.id.toString(), payload: { taskId: current.id.toString(), status: input.status, reviewReason: input.reviewReason ?? null, experienceReward: awardingExperience ? current.publishExpReward : 0 } } });
        if (invitationReward.rewarded && invitationReward.inviterId) {
          await tx.notification.create({ data: { userId: invitationReward.inviterId, type: 'invitation_reward', refId: current.id.toString(), payload: { taskId: current.id.toString(), invitedUserId: current.userId.toString(), reward: 20 } } });
        }
        return updated;
      });
    } catch (error) {
      if (error instanceof BuddyPrestigeError) return reply.code(409).send({ error: error.message, message: error.message === 'INSUFFICIENT_PRESTIGE' ? '蛋蛋币不足，无法冻结任务奖励' : '蛋蛋币账户不存在' });
      throw error;
    }
    publishRealtime(() => realtime.publishPrivate([task.userId], realtimeEvent('task.reviewed', task.id, 'private')));
    if (input.status === 'approved') publishRealtime(() => realtime.publishPublic(realtimeEvent('task.approved', task.id, 'public')));
    publishRealtime(() => realtime.publishPublic(realtimeEvent('ranking.updated', task.userId, 'public')));
    return { task: serializeTask(task) };
  });

  app.post('/api/tasks/:id/claim', { preHandler: app.authenticate }, async (request, reply) => {
    const params = notificationParamsSchema.parse(request.params);
    const input = taskClaimSchema.parse(request.body);
    assertSafeText(input.contact);
    const userId = currentUserId(request);
    const task = await prisma.task.findUnique({ where: { id: params.id } });
    if (!task) return reply.code(404).send({ error: 'TASK_NOT_FOUND', message: '任务不存在' });
    if (task.userId === userId) return reply.code(409).send({ error: 'TASK_OWNER_CANNOT_CLAIM', message: '不能认领自己发布的任务' });
    if (task.status !== 'approved') return reply.code(409).send({ error: 'TASK_NOT_AVAILABLE', message: '任务当前不可认领' });
    const existing = await prisma.taskClaim.findUnique({ where: { taskId_claimerId: { taskId: params.id, claimerId: userId } } });
    if (existing) return reply.code(409).send({ error: 'TASK_ALREADY_CLAIMED', message: '你已经认领过该任务' });
    const activeCount = await prisma.taskClaim.count({ where: { taskId: params.id, status: { in: ['pending', 'assigned', 'submitted'] } } });
    if (activeCount >= task.maxClaimers) return reply.code(409).send({ error: 'TASK_FULL', message: '任务名额已满' });
    let frozenAmount = 0;
    try {
      if (task.taskType === 'teach' && task.reward > 0) {
        frozenAmount = task.reward;
        await prisma.$transaction((tx) => applyBuddyPointDelta(tx, userId, -frozenAmount, `task-claim-freeze:${task.id.toString()}:${userId.toString()}`, 'task_tuition_frozen', `认领教学任务冻结蛋蛋币:${task.id.toString()}`));
      }
      const claim = await prisma.taskClaim.create({ data: { taskId: task.id, claimerId: userId, contact: input.contact ?? null, frozenAmount, status: 'pending' } });
      await prisma.notification.create({ data: { userId: task.userId, type: 'task_claimed', refId: task.id.toString(), payload: { taskId: task.id.toString(), claimerId: userId.toString() } } });
      publishRealtime(() => realtime.publishPublic(realtimeEvent('task.claimed', task.id, 'public')));
      if (frozenAmount > 0) publishRealtime(() => realtime.publishPublic(realtimeEvent('ranking.updated', userId, 'public')));
      return reply.code(201).send({ claim: { ...claim, id: claim.id.toString(), taskId: claim.taskId.toString(), claimerId: claim.claimerId.toString() } });
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') return reply.code(409).send({ error: 'TASK_ALREADY_CLAIMED', message: '你已经认领过该任务' });
      if (error instanceof BuddyPrestigeError) return reply.code(409).send({ error: error.message, message: error.message === 'INSUFFICIENT_PRESTIGE' ? '蛋蛋币不足，无法认领' : '蛋蛋币账户不存在' });
      throw error;
    }
  });

  app.post('/api/tasks/:id/abandon', { preHandler: app.authenticate }, async (request, reply) => {
    const params = notificationParamsSchema.parse(request.params);
    const userId = currentUserId(request);
    const result = await prisma.$transaction(async (tx) => {
      const claim = await tx.taskClaim.findUnique({ where: { taskId_claimerId: { taskId: params.id, claimerId: userId } } });
      if (!claim) return { error: 'TASK_CLAIM_NOT_FOUND' as const };
      if (!['pending', 'assigned'].includes(claim.status)) return { error: 'TASK_CLAIM_STATE_INVALID' as const };
      if (claim.frozenAmount > 0) {
        await applyBuddyPointDelta(tx, userId, claim.frozenAmount, `task-claim-abandon-refund:${claim.id.toString()}`, 'task_tuition_refund', `放弃任务返还蛋蛋币:${params.id.toString()}`);
      }
      const updated = await tx.taskClaim.update({ where: { id: claim.id }, data: { status: 'abandoned' } });
      return { claim: updated };
    });
    if ('error' in result) {
      if (result.error === 'TASK_CLAIM_NOT_FOUND') return reply.code(404).send({ error: result.error, message: '未找到任务接取记录' });
      return reply.code(409).send({ error: result.error, message: '当前接取状态不能放弃' });
    }
    const activeClaimCount = await prisma.taskClaim.count({ where: { taskId: params.id, status: { in: [...activeTaskClaimStatuses] } } });
    publishRealtime(() => realtime.publishPublic(realtimeEvent('task.abandoned', params.id, 'public')));
    if (result.claim.frozenAmount > 0) publishRealtime(() => realtime.publishPublic(realtimeEvent('ranking.updated', userId, 'public')));
    return {
      claim: { ...result.claim, id: result.claim.id.toString(), taskId: result.claim.taskId.toString(), claimerId: result.claim.claimerId.toString() },
      activeClaimCount,
    };
  });

  app.post('/api/tasks/:id/submit', { preHandler: app.authenticate }, async (request, reply) => {
    const params = notificationParamsSchema.parse(request.params);
    const userId = currentUserId(request);
    const claim = await prisma.taskClaim.findFirst({ where: { taskId: params.id, claimerId: userId, status: { in: ['pending', 'assigned'] } } });
    if (!claim) return reply.code(404).send({ error: 'TASK_CLAIM_NOT_FOUND', message: '没有可提交的任务认领' });
    const updated = await prisma.taskClaim.update({ where: { id: claim.id }, data: { status: 'submitted', submittedAt: new Date() } });
    const task = await prisma.task.findUnique({ where: { id: params.id }, select: { userId: true } });
    if (task) await prisma.notification.create({ data: { userId: task.userId, type: 'task_submitted', refId: params.id.toString(), payload: { taskId: params.id.toString(), claimId: claim.id.toString() } } });
    publishRealtime(() => realtime.publishPrivate(task ? [task.userId, userId] : [userId], realtimeEvent('task.submitted', params.id, 'private')));
    return { claim: { ...updated, id: updated.id.toString(), taskId: updated.taskId.toString(), claimerId: updated.claimerId.toString() } };
  });

  app.get('/api/tasks/:id/claims', { preHandler: app.authenticate }, async (request, reply) => {
    const params = notificationParamsSchema.parse(request.params);
    const userId = currentUserId(request);
    const task = await prisma.task.findUnique({ where: { id: params.id }, select: { userId: true } });
    if (!task) return reply.code(404).send({ error: 'TASK_NOT_FOUND', message: '任务不存在' });
    const canManageClaims = task.userId === userId || await hasRequestPermission(request, PERMISSION_KEYS.taskClaimManage);
    const claims = await prisma.taskClaim.findMany({ where: { taskId: params.id, ...(canManageClaims ? {} : { claimerId: userId }) }, orderBy: { createdAt: 'asc' }, include: { claimer: { select: { id: true, nickname: true, mbtiType: true, reputation: true, bio: true, eggCategory: true, eggRarity: true } } } });
    return { claims: claims.map((claim) => ({ ...claim, id: claim.id.toString(), taskId: claim.taskId.toString(), claimerId: claim.claimerId.toString(), claimer: claim.claimer ? { ...claim.claimer, id: claim.claimer.id.toString(), reputation: Number(claim.claimer.reputation) } : null })) };
  });

  app.patch('/api/tasks/:id/claims/assign', { preHandler: app.authenticate }, async (request, reply) => {
    const params = notificationParamsSchema.parse(request.params);
    const input = taskAssignSchema.parse(request.body);
    const userId = currentUserId(request);
    const task = await prisma.task.findUnique({ where: { id: params.id } });
    if (!task) return reply.code(404).send({ error: 'TASK_NOT_FOUND', message: '任务不存在' });
    if (task.userId !== userId && !await hasRequestPermission(request, PERMISSION_KEYS.taskClaimManage)) return reply.code(403).send({ error: 'FORBIDDEN', message: '只有发布者或获授权管理员可以确认配对' });
    const claims = await prisma.taskClaim.findMany({ where: { taskId: task.id, status: { in: ['pending', 'submitted', 'assigned'] } } });
    const selected = claims.filter((claim) => input.claimIds.some((id) => id === claim.id));
    if (selected.length === 0) return reply.code(409).send({ error: 'TASK_CLAIM_NOT_FOUND', message: '没有可确认的认领者' });
    if (selected.length > task.maxClaimers) return reply.code(409).send({ error: 'TASK_FULL', message: '选择人数超过任务上限' });
    const result = await prisma.$transaction(async (tx) => {
      await tx.taskClaim.updateMany({ where: { taskId: task.id, status: { in: ['pending', 'submitted', 'assigned'] }, id: { notIn: selected.map((claim) => claim.id) } }, data: { status: 'rejected' } });
      const assigned = await tx.taskClaim.updateMany({ where: { id: { in: selected.map((claim) => claim.id) } }, data: { status: 'assigned' } });
      for (const claim of selected) await tx.notification.create({ data: { userId: claim.claimerId, type: 'task_assigned', refId: task.id.toString(), payload: { taskId: task.id.toString() } } });
      return assigned.count;
    });
    publishRealtime(() => realtime.publishPrivate([task.userId, ...selected.map((claim) => claim.claimerId)], realtimeEvent('task.assigned', task.id, 'private')));
    return { assigned: result };
  });

  app.post('/api/tasks/:id/complete', { preHandler: app.authenticate }, async (request, reply) => {
    const params = notificationParamsSchema.parse(request.params);
    const input = taskCompleteSchema.parse(request.body);
    const userId = currentUserId(request);
    const task = await prisma.task.findUnique({ where: { id: params.id } });
    if (!task) return reply.code(404).send({ error: 'TASK_NOT_FOUND', message: '任务不存在' });
    if (task.userId !== userId && !await hasRequestPermission(request, PERMISSION_KEYS.taskClaimManage)) return reply.code(403).send({ error: 'FORBIDDEN', message: '只有发布者或获授权管理员可以确认完成' });
    const claim = await prisma.taskClaim.findFirst({ where: { taskId: task.id, ...(input.claimId ? { id: input.claimId } : {}), status: 'submitted' } });
    if (!claim) return reply.code(409).send({ error: 'TASK_SUBMISSION_NOT_FOUND', message: '没有待确认的提交' });
    try {
      const result = await prisma.$transaction(async (tx) => {
        const completed = await tx.taskClaim.update({ where: { id: claim.id }, data: { status: 'completed', completedAt: new Date() } });
        if (task.reward > 0) {
          if (task.taskType === 'teach') await applyBuddyPointDelta(tx, task.userId, task.reward, `task-complete-pay:${task.id.toString()}:${claim.claimerId.toString()}`, 'task_tuition_paid', `教学任务完成结算:${task.id.toString()}`);
          else await applyBuddyPointDelta(tx, claim.claimerId, task.reward, `task-complete-reward:${task.id.toString()}:${claim.claimerId.toString()}`, 'task_reward_paid', `任务完成奖励:${task.id.toString()}`);
        }
        const updatedTask = await tx.task.update({ where: { id: task.id }, data: { status: 'completed', completedAt: new Date() } });
        await tx.notification.create({ data: { userId: claim.claimerId, type: 'task_completed', refId: task.id.toString(), payload: { taskId: task.id.toString(), claimId: claim.id.toString() } } });
        return { claim: completed, task: updatedTask };
      });
      publishRealtime(() => realtime.publishPublic(realtimeEvent('task.completed', task.id, 'public')));
      publishRealtime(() => realtime.publishPrivate([task.userId, claim.claimerId], realtimeEvent('task.completed', task.id, 'private')));
      if (task.reward > 0) publishRealtime(() => realtime.publishPublic(realtimeEvent('ranking.updated', task.taskType === 'teach' ? task.userId : claim.claimerId, 'public')));
      return { claim: { ...result.claim, id: result.claim.id.toString(), taskId: result.claim.taskId.toString(), claimerId: result.claim.claimerId.toString() }, task: serializeTask(result.task) };
    } catch (error) {
      if (error instanceof BuddyPrestigeError) return reply.code(409).send({ error: error.message, message: '结算蛋蛋币失败' });
      throw error;
    }
  });

  app.post('/api/tasks/:id/cancel', { preHandler: app.authenticate }, async (request, reply) => {
    const params = notificationParamsSchema.parse(request.params);
    const userId = currentUserId(request);
    const task = await prisma.task.findUnique({ where: { id: params.id } });
    if (!task) return reply.code(404).send({ error: 'TASK_NOT_FOUND', message: '任务不存在' });
    if (task.userId !== userId && !await hasRequestPermission(request, PERMISSION_KEYS.taskUnpublish)) return reply.code(403).send({ error: 'FORBIDDEN', message: '只有发布者或获授权管理员可以取消任务' });
    if (['completed', 'cancelled'].includes(task.status)) return reply.code(409).send({ error: 'TASK_ALREADY_CLOSED', message: '任务已经结束' });
    const claims = await prisma.taskClaim.findMany({ where: { taskId: task.id, status: { in: ['pending', 'assigned', 'submitted'] } } });
    try {
      const result = await prisma.$transaction((tx) => cancelTaskAndRefund(tx, task, claims));
      publishRealtime(() => realtime.publishPublic(realtimeEvent('task.cancelled', task.id, 'public')));
      publishRealtime(() => realtime.publishPrivate([task.userId, ...claims.map((claim) => claim.claimerId)], realtimeEvent('task.cancelled', task.id, 'private')));
      if (task.reward > 0) publishRealtime(() => realtime.publishPublic(realtimeEvent('ranking.updated', task.userId, 'public')));
      return { task: serializeTask(result), cancelledClaims: claims.length };
    } catch (error) {
      if (error instanceof BuddyPrestigeError) return reply.code(409).send({ error: error.message, message: '退回蛋蛋币失败' });
      throw error;
    }
  });

  app.get('/api/tasks/cancellation-requests/mine', { preHandler: app.authenticate }, async (request) => {
    const userId = currentUserId(request);
    const requests = await prisma.taskCancellationRequest.findMany({
      where: { OR: [{ requesterId: userId }, { recipientId: userId }] },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { requests: requests.map(serializeTaskCancellationRequest) };
  });

  app.post('/api/tasks/:id/cancellation-requests', { preHandler: app.authenticate }, async (request, reply) => {
    const params = notificationParamsSchema.parse(request.params);
    const input = taskCancellationRequestSchema.parse(request.body);
    assertSafeText(input.reason);
    const userId = currentUserId(request);
    const task = await prisma.task.findUnique({ where: { id: params.id } });
    if (!task) return reply.code(404).send({ error: 'TASK_NOT_FOUND', message: '任务不存在' });
    if (task.taskType !== 'teach') return reply.code(409).send({ error: 'TASK_CANCELLATION_UNAVAILABLE', message: '仅教学任务支持协商取消' });
    if (task.status !== 'approved') return reply.code(409).send({ error: 'TASK_STATE_INVALID', message: '当前任务不能申请协商取消' });
    if (Date.now() - task.createdAt.getTime() > 48 * 60 * 60 * 1000) return reply.code(409).send({ error: 'TASK_CANCELLATION_WINDOW_EXPIRED', message: '已超过 48 小时协商取消时限' });
    const activeClaims = await prisma.taskClaim.findMany({ where: { taskId: task.id, status: { in: ['assigned', 'submitted'] } } });
    const requesterClaim = activeClaims.find((claim) => claim.claimerId === userId);
    const recipientId = task.userId === userId ? activeClaims[0]?.claimerId : requesterClaim ? task.userId : null;
    if (!recipientId) return reply.code(403).send({ error: 'FORBIDDEN', message: '只有已配对的任务双方可以申请协商取消' });
    if (activeClaims.length !== 1) return reply.code(409).send({ error: 'TASK_CANCELLATION_PARTNER_AMBIGUOUS', message: '当前任务无法确定协商对象' });
    const pending = await prisma.taskCancellationRequest.findFirst({ where: { taskId: task.id, status: 'pending' }, select: { id: true } });
    if (pending) return reply.code(409).send({ error: 'TASK_CANCELLATION_PENDING', message: '已有待处理的取消申请' });
    const created = await prisma.$transaction(async (tx) => {
      const record = await tx.taskCancellationRequest.create({ data: { taskId: task.id, requesterId: userId, recipientId, reason: input.reason } });
      await tx.notification.create({ data: { userId: recipientId, type: 'task_cancellation_requested', refId: task.id.toString(), payload: { taskId: task.id.toString(), cancellationRequestId: record.id.toString() } } });
      return record;
    });
    publishRealtime(() => realtime.publishPrivate([userId, recipientId], realtimeEvent('task.cancellation_requested', task.id, 'private')));
    return reply.code(201).send({ request: serializeTaskCancellationRequest(created) });
  });

  app.post('/api/tasks/:id/cancellation-requests/:requestId/respond', { preHandler: app.authenticate }, async (request, reply) => {
    const params = taskCancellationRequestParamsSchema.parse(request.params);
    const input = taskCancellationResponseSchema.parse(request.body);
    const userId = currentUserId(request);
    const record = await prisma.taskCancellationRequest.findUnique({ where: { id: params.requestId } });
    if (!record || record.taskId !== params.id) return reply.code(404).send({ error: 'TASK_CANCELLATION_NOT_FOUND', message: '取消申请不存在' });
    if (record.recipientId !== userId) return reply.code(403).send({ error: 'FORBIDDEN', message: '只有申请接收方可以处理取消申请' });
    if (record.status !== 'pending') return reply.code(409).send({ error: 'TASK_CANCELLATION_ALREADY_RESPONDED', message: '该取消申请已经处理' });
    const task = await prisma.task.findUnique({ where: { id: params.id } });
    if (!task || task.status !== 'approved') return reply.code(409).send({ error: 'TASK_STATE_INVALID', message: '当前任务不能处理协商取消' });
    const claims = await prisma.taskClaim.findMany({ where: { taskId: task.id, status: { in: ['assigned', 'submitted'] } } });
    try {
      const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.taskCancellationRequest.update({ where: { id: record.id }, data: { status: input.status, respondedAt: new Date() } });
        if (input.status === 'accepted') await cancelTaskAndRefund(tx, task, claims);
        await tx.notification.create({ data: { userId: record.requesterId, type: input.status === 'accepted' ? 'task_cancellation_accepted' : 'task_cancellation_rejected', refId: task.id.toString(), payload: { taskId: task.id.toString(), cancellationRequestId: record.id.toString() } } });
        return updated;
      });
      const recipients = [record.requesterId, record.recipientId, task.userId, ...claims.map((claim) => claim.claimerId)];
      publishRealtime(() => realtime.publishPrivate(recipients, realtimeEvent(input.status === 'accepted' ? 'task.cancelled' : 'task.cancellation_rejected', task.id, 'private')));
      if (input.status === 'accepted' && task.reward > 0) publishRealtime(() => realtime.publishPublic(realtimeEvent('ranking.updated', task.id, 'public')));
      return { request: serializeTaskCancellationRequest(result) };
    } catch (error) {
      if (error instanceof BuddyPrestigeError) return reply.code(409).send({ error: error.message, message: '退回蛋蛋币失败' });
      throw error;
    }
  });

  app.post('/api/tasks/:id/rating', { preHandler: app.authenticate }, async (request, reply) => {
    const params = notificationParamsSchema.parse(request.params);
    const input = taskRatingSchema.parse(request.body);
    assertSafeText(input.comment);
    const userId = currentUserId(request);
    const task = await prisma.task.findUnique({ where: { id: params.id }, select: { id: true, userId: true } });
    if (!task) return reply.code(404).send({ error: 'TASK_NOT_FOUND', message: '任务不存在' });
    const claim = await prisma.taskClaim.findFirst({ where: { taskId: task.id, status: 'completed', OR: [{ claimerId: userId }, { task: { userId } }] }, select: { claimerId: true } });
    if (!claim) return reply.code(403).send({ error: 'RATING_FORBIDDEN', message: '只有已完成任务的参与者可以评价' });
    const partnerId = task.userId === userId ? claim.claimerId : task.userId;
    if (input.toUserId !== partnerId || input.toUserId === userId) return reply.code(403).send({ error: 'RATING_TARGET_INVALID', message: '评价对象不属于该任务' });
    const existing = await prisma.rating.findUnique({ where: { taskId_fromUserId_toUserId: { taskId: task.id, fromUserId: userId, toUserId: input.toUserId } } });
    if (existing) return reply.code(409).send({ error: 'RATING_ALREADY_EXISTS', message: '你已经评价过该任务' });
    try {
      const rating = await prisma.rating.create({ data: { taskId: task.id, fromUserId: userId, toUserId: input.toUserId, score: input.score, comment: input.comment ?? null } });
      publishRealtime(() => realtime.publishPrivate([userId, input.toUserId], realtimeEvent('task.rated', task.id, 'private')));
      publishRealtime(() => realtime.publishPublic(realtimeEvent('ranking.updated', input.toUserId, 'public')));
      return reply.code(201).send({ rating: { ...rating, id: rating.id.toString(), taskId: rating.taskId.toString(), fromUserId: rating.fromUserId.toString(), toUserId: rating.toUserId.toString() } });
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') return reply.code(409).send({ error: 'RATING_ALREADY_EXISTS', message: '你已经评价过该任务' });
      throw error;
    }
  });

  app.post('/api/task-invites', { preHandler: app.authenticate }, async (request, reply) => {
    const input = z.object({
      targetUserId: z.coerce.bigint(),
      skills: z.array(z.string().trim().min(1).max(40)).min(1).max(7),
    }).parse(request.body);
    const skills = [...new Set(input.skills.map((skill) => skill.trim()).filter(Boolean))];
    if (skills.length === 0) return reply.code(400).send({ error: 'INVITE_SKILLS_REQUIRED', message: '请至少选择一个技能' });
    assertSafeSkillTags(...skills);
    const userId = currentUserId(request);
    if (input.targetUserId === userId) return reply.code(400).send({ error: 'INVITE_SELF', message: '不能邀请自己发布任务' });
    const [sender, target] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { nickname: true } }),
      prisma.user.findUnique({ where: { id: input.targetUserId }, select: { id: true } }),
    ]);
    if (!sender) return reply.code(401).send({ error: 'UNAUTHORIZED', message: '登录状态无效' });
    if (!target) return reply.code(404).send({ error: 'TARGET_NOT_FOUND', message: '邀请对象不存在' });
    const notification = await prisma.notification.create({
      data: {
        userId: input.targetUserId,
        type: 'invite',
        payload: { from: sender.nickname, fromId: userId.toString(), skills },
      },
    });
    publishRealtime(() => realtime.publishPrivate([input.targetUserId], realtimeEvent('task.invited', input.targetUserId, 'private')));
    return reply.code(201).send({ invited: true, notificationId: notification.id.toString() });
  });

  app.post('/api/feedback', { preHandler: app.authenticate }, async (request, reply) => {
    const input = feedbackSchema.parse(request.body);
    assertSafeText(input.type, input.content, input.contact, input.source);
    const feedback = await prisma.feedback.create({ data: { userId: currentUserId(request), type: input.type, content: input.content, contact: input.contact ?? null, source: input.source ?? null, status: 'pending' } });
    const admins = await prisma.user.findMany({ where: { role: 'admin', status: 'active' }, select: { id: true } });
    if (admins.length) await prisma.notification.createMany({ data: admins.map((admin) => ({ userId: admin.id, type: 'feedback_submit', refId: feedback.id.toString(), payload: { feedbackId: feedback.id.toString(), type: input.type } })) });
    return reply.code(201).send({ feedback: serializeFeedback(feedback) });
  });

  app.get('/api/feedback/mine', { preHandler: app.authenticate }, async (request) => {
    const feedback = await prisma.feedback.findMany({ where: { userId: currentUserId(request) }, orderBy: { createdAt: 'desc' }, take: 100, include: { messages: { orderBy: { createdAt: 'asc' } }, attachments: { orderBy: { createdAt: 'asc' } } } });
    return { feedback: feedback.map(serializeFeedback) };
  });

  app.post('/api/feedback/:id/attachments', { preHandler: app.authenticate }, async (request, reply) => {
    const params = notificationParamsSchema.parse(request.params);
    const userId = currentUserId(request);
    const feedback = await prisma.feedback.findUnique({ where: { id: params.id }, select: { id: true, userId: true, status: true } });
    if (!feedback) return reply.code(404).send({ error: 'FEEDBACK_NOT_FOUND', message: '反馈不存在' });
    if (feedback.userId !== userId) return reply.code(403).send({ error: 'FORBIDDEN', message: '只能给自己的反馈上传附件' });

    const validated: ValidatedFeedbackAttachment[] = [];
    try {
      for await (const part of request.files()) {
        const buffer = await part.toBuffer();
        if (validated.length >= MAX_FEEDBACK_ATTACHMENTS_PER_UPLOAD) {
          return reply.code(400).send({ error: 'TOO_MANY_ATTACHMENTS', message: '每次最多上传 3 张图片' });
        }
        if (part.file.truncated || buffer.length > MAX_FEEDBACK_ATTACHMENT_BYTES) throw new ProtectedFileError('FILE_TOO_LARGE');
        validated.push(await validateFeedbackAttachment({ buffer, originalName: part.filename, declaredMime: part.mimetype }));
      }
    } catch (error) {
      const code = error instanceof ProtectedFileError ? error.code : (error as { code?: string }).code;
      if (code === 'FILE_TOO_LARGE' || code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ error: 'FILE_TOO_LARGE', message: '单张图片不能超过 5 MiB' });
      if (error instanceof ProtectedFileError) return reply.code(400).send({ error: error.code, message: '附件必须是内容真实匹配的 JPG、PNG 或 WebP 图片' });
      throw error;
    }
    if (!validated.length) return reply.code(400).send({ error: 'ATTACHMENT_REQUIRED', message: '请选择需要上传的图片' });

    const persisted: string[] = [];
    try {
      for (const attachment of validated) {
        await persistProtectedFile(config.FEEDBACK_ATTACHMENT_ROOT, attachment);
        persisted.push(attachment.storageKey);
      }
      const attachments = await prisma.$transaction((tx) => Promise.all(validated.map((attachment) => tx.feedbackAttachment.create({
        data: {
          feedbackId: feedback.id,
          uploaderId: userId,
          storageKey: attachment.storageKey,
          originalName: attachment.originalName,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
        },
      }))));
      return reply.code(201).send({ attachments: attachments.map((attachment) => ({
        id: attachment.id.toString(),
        feedbackId: attachment.feedbackId.toString(),
        messageId: attachment.messageId?.toString() ?? null,
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        hidden: attachment.hiddenAt !== null,
        createdAt: attachment.createdAt,
      })) });
    } catch (error) {
      await Promise.all(persisted.map((storageKey) => removeProtectedFile(config.FEEDBACK_ATTACHMENT_ROOT, storageKey)));
      throw error;
    }
  });

  app.get('/api/feedback/:id/attachments/:attachmentId', { preHandler: app.authenticate }, async (request, reply) => {
    const params = feedbackAttachmentParamsSchema.parse(request.params);
    const attachment = await prisma.feedbackAttachment.findUnique({
      where: { id: params.attachmentId },
      include: { feedback: { select: { userId: true } } },
    });
    if (!attachment || attachment.feedbackId !== params.id) return reply.code(404).send({ error: 'ATTACHMENT_NOT_FOUND', message: '附件不存在' });
    const owner = attachment.feedback.userId === currentUserId(request);
    if (!owner && !await hasRequestPermission(request, PERMISSION_KEYS.feedbackAttachmentView)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: '没有查看该附件的权限' });
    }
    if (attachment.hiddenAt) return reply.code(410).send({ error: 'ATTACHMENT_HIDDEN', message: '该附件已被管理员隐藏' });
    const content = await readProtectedFile(config.FEEDBACK_ATTACHMENT_ROOT, attachment.storageKey);
    return reply
      .header('content-type', attachment.mimeType)
      .header('x-content-type-options', 'nosniff')
      .header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`)
      .send(content);
  });

  app.post('/api/admin/feedback/:id/attachments/:attachmentId/hide', { preHandler: app.authenticate }, async (request, reply) => {
    if (!await requireRequestPermission(request, reply, PERMISSION_KEYS.feedbackAttachmentHide)) return;
    const params = feedbackAttachmentParamsSchema.parse(request.params);
    const input = z.object({ reason: z.string().trim().min(1).max(500) }).parse(request.body);
    assertSafeText(input.reason);
    const current = await prisma.feedbackAttachment.findUnique({ where: { id: params.attachmentId } });
    if (!current || current.feedbackId !== params.id) return reply.code(404).send({ error: 'ATTACHMENT_NOT_FOUND', message: '附件不存在' });
    const attachment = await prisma.feedbackAttachment.update({
      where: { id: current.id },
      data: { hiddenAt: new Date(), hiddenBy: currentUserId(request), hiddenReason: input.reason },
    });
    await recordAudit({ actorId: currentUserId(request), action: 'feedback.attachment.hide', targetType: 'feedback_attachment', targetId: attachment.id.toString(), ip: request.ip });
    return { attachment: { id: attachment.id.toString(), hidden: true } };
  });

  app.post('/api/feedback/:id/messages', { preHandler: app.authenticate }, async (request, reply) => {
    const params = notificationParamsSchema.parse(request.params);
    const input = feedbackMessageSchema.parse(request.body);
    assertSafeText(input.content);
    const userId = currentUserId(request);
    const feedback = await prisma.feedback.findUnique({ where: { id: params.id }, select: { id: true, userId: true, status: true } });
    if (!feedback) return reply.code(404).send({ error: 'FEEDBACK_NOT_FOUND', message: '反馈不存在' });
    if (feedback.userId !== userId) return reply.code(403).send({ error: 'FORBIDDEN', message: '只能补充自己的反馈' });
    assertUserCanAppendFeedback(mapLegacyFeedbackStatus(feedback.status));
    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.feedbackMessage.create({ data: { feedbackId: feedback.id, authorId: userId, authorType: 'user', content: input.content } });
      await tx.notification.createMany({
        data: (await tx.user.findMany({ where: { role: 'admin', status: 'active' }, select: { id: true } })).map((admin) => ({
          userId: admin.id, type: 'feedback_update', refId: feedback.id.toString(), payload: { feedbackId: feedback.id.toString() },
        })),
      });
      return created;
    });
    return reply.code(201).send({ message: { ...message, id: message.id.toString(), feedbackId: message.feedbackId.toString(), authorId: message.authorId?.toString() ?? null } });
  });

  app.post('/api/feedback/:id/reopen', { preHandler: app.authenticate }, async (request, reply) => {
    const params = notificationParamsSchema.parse(request.params);
    const input = feedbackReopenSchema.parse(request.body);
    assertSafeText(input.reason);
    const userId = currentUserId(request);
    const feedback = await prisma.feedback.findUnique({ where: { id: params.id } });
    if (!feedback) return reply.code(404).send({ error: 'FEEDBACK_NOT_FOUND', message: '反馈不存在' });
    if (feedback.userId !== userId) return reply.code(403).send({ error: 'FORBIDDEN', message: '只能重新处理自己的反馈' });
    assertFeedbackCanReopen(feedback);
    const updated = await prisma.$transaction(async (tx) => {
      await tx.feedbackMessage.create({ data: { feedbackId: feedback.id, authorId: userId, authorType: 'user', content: input.reason } });
      return tx.feedback.update({ where: { id: feedback.id }, data: { status: 'pending', reopenedAt: new Date(), reopenCount: { increment: 1 }, closedAt: null } });
    });
    return { feedback: serializeFeedback(updated) };
  });

  app.get('/api/admin/feedback', { preHandler: app.authenticate }, async (request, reply) => {
    if (!await requireRequestPermission(request, reply, PERMISSION_KEYS.feedbackView)) return;
    const feedback = await prisma.feedback.findMany({ orderBy: { createdAt: 'desc' }, take: 200, include: { user: { select: { id: true, nickname: true } }, messages: { orderBy: { createdAt: 'asc' } }, attachments: { orderBy: { createdAt: 'asc' } } } });
    return { feedback: feedback.map((item) => ({ ...serializeFeedback(item), user: item.user ? { ...item.user, id: item.user.id.toString() } : null })) };
  });

  app.patch('/api/admin/feedback/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const params = notificationParamsSchema.parse(request.params);
    const input = feedbackAdminSchema.parse(request.body);
    if (input.adminRemark && !await requireRequestPermission(request, reply, PERMISSION_KEYS.feedbackReply)) return;
    if (input.status && !await requireRequestPermission(request, reply, PERMISSION_KEYS.feedbackStatusUpdate)) return;
    if (input.status === 'needs_changes' && !await requireRequestPermission(request, reply, PERMISSION_KEYS.feedbackNeedsChanges)) return;
    assertSafeText(input.adminRemark);
    const current = await prisma.feedback.findUnique({ where: { id: params.id } });
    if (!current) return reply.code(404).send({ error: 'FEEDBACK_NOT_FOUND', message: '反馈不存在' });
    const currentStatus = mapLegacyFeedbackStatus(current.status);
    if (input.status) assertFeedbackTransition(currentStatus, input.status);
    const feedback = await prisma.$transaction(async (tx) => {
      if (input.adminRemark) await tx.feedbackMessage.create({ data: { feedbackId: current.id, authorId: currentUserId(request), authorType: 'admin', content: input.adminRemark } });
      const nextStatus = input.status ?? currentStatus;
      const terminal = nextStatus === 'resolved' || nextStatus === 'rejected';
      const updated = await tx.feedback.update({ where: { id: current.id }, data: { status: nextStatus, closedAt: terminal ? new Date() : null } });
      if (input.adminRemark || input.status) await tx.notification.create({ data: { userId: current.userId, type: 'feedback_reply', refId: current.id.toString(), payload: { feedbackId: current.id.toString(), status: nextStatus } } });
      return updated;
    });
    return { feedback: serializeFeedback(feedback) };
  });

  app.get('/api/inquiries', { preHandler: app.authenticate }, async (request) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(request.query);
    const userId = currentUserId(request);
    const inquiries = await prisma.inquiry.findMany({ orderBy: { createdAt: 'desc' }, take: query.limit, include: { user: { select: { id: true, nickname: true } } } });
    const likes = inquiries.length
      ? await prisma.inquiryLike.findMany({ where: { userId, inquiryId: { in: inquiries.map((inquiry) => inquiry.id) } }, select: { inquiryId: true } })
      : [];
    const likedIds = new Set(likes.map((item) => item.inquiryId.toString()));
    return { inquiries: inquiries.map((item) => ({ ...serializeInquiry(item), likedByMe: likedIds.has(item.id.toString()), user: { ...item.user, id: item.user.id.toString() } })) };
  });

  app.get('/api/inquiries/mine', { preHandler: app.authenticate }, async (request) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(100) }).parse(request.query);
    const userId = currentUserId(request);
    const inquiries = await prisma.inquiry.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      include: {
        user: { select: { id: true, nickname: true } },
        _count: { select: { replies: true } },
        replies: {
          where: { userId: { not: userId } },
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { user: { select: { id: true, nickname: true } } },
        },
      },
    });
    return {
      inquiries: inquiries.map((item) => {
        const { replies, _count, ...inquiry } = item;
        return {
          ...serializeInquiry(inquiry),
          user: { ...item.user, id: item.user.id.toString() },
          replyCount: _count.replies,
          recentReplies: replies.map((reply) => ({
            ...reply,
            id: reply.id.toString(),
            inquiryId: reply.inquiryId.toString(),
            userId: reply.userId.toString(),
            parentId: reply.parentId?.toString() ?? null,
            user: { ...reply.user, id: reply.user.id.toString() },
          })),
        };
      }),
    };
  });

  app.post('/api/inquiries', { preHandler: app.authenticate }, async (request, reply) => {
    const input = inquiryCreateSchema.parse(request.body);
      assertSafeText(input.title, input.content, ...input.tags);
    const userId = currentUserId(request);
    let inquiry;
    try {
      inquiry = await prisma.$transaction(async (tx) => {
        if (input.bounty > 0) await applyBuddyPointDelta(tx, userId, -input.bounty, `inquiry-bounty:${userId.toString()}:${hashToken(input.title + input.content + String(Date.now()))}`, 'inquiry_bounty', '打听悬赏冻结');
        return tx.inquiry.create({ data: { userId, title: input.title, content: input.content, tags: input.tags, bounty: input.bounty, coinStatus: input.bounty > 0 ? 'frozen' : 'open', deadline: input.deadline ?? null } });
      });
    } catch(error) {
      if(error instanceof BuddyPrestigeError) return reply.code(409).send({error:error.message, message:error.message === 'INSUFFICIENT_PRESTIGE' ? '蛋蛋币不足' : '蛋蛋币账户不存在'});
      throw error;
    }
    publishRealtime(() => realtime.publishPublic(realtimeEvent('inquiry.created', inquiry.id, 'public')));
    return reply.code(201).send({ inquiry: serializeInquiry(inquiry) });
  });

  app.get('/api/inquiries/:id/replies', { preHandler: app.authenticate }, async (request, reply) => {
    const params = notificationParamsSchema.parse(request.params);
    const inquiry = await prisma.inquiry.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!inquiry) return reply.code(404).send({ error: 'INQUIRY_NOT_FOUND', message: '打听不存在' });
    const userId = currentUserId(request);
    const [replies, likes] = await Promise.all([
      prisma.inquiryReply.findMany({ where: { inquiryId: params.id }, orderBy: { createdAt: 'asc' }, include: { user: { select: { id: true, nickname: true } }, _count: { select: { likes: true } } } }),
      prisma.inquiryReplyLike.findMany({ where: { userId, reply: { inquiryId: params.id } }, select: { replyId: true } }),
    ]);
    const likedIds = new Set(likes.map((item) => item.replyId.toString()));
    return { replies: replies.map((item) => ({ ...item, likes: item._count.likes, _count: undefined, id: item.id.toString(), inquiryId: item.inquiryId.toString(), userId: item.userId.toString(), parentId: item.parentId?.toString() ?? null, likedByMe: likedIds.has(item.id.toString()), user: { ...item.user, id: item.user.id.toString() } })) };
  });

  app.post('/api/inquiries/:id/replies', { preHandler: app.authenticate }, async (request, reply) => {
    const params = notificationParamsSchema.parse(request.params);
    const input = inquiryReplySchema.parse(request.body);
    assertSafeText(input.content);
    const userId = currentUserId(request);
    const inquiry = await prisma.inquiry.findUnique({ where: { id: params.id }, select: { id: true, userId: true, title: true } });
    if (!inquiry) return reply.code(404).send({ error: 'INQUIRY_NOT_FOUND', message: '打听不存在' });
    if (input.kind === 'comment') {
      if (!input.parentId) return reply.code(400).send({ error: 'PARENT_REPLY_REQUIRED', message: '评论缺少所属回答' });
      const parent = await prisma.inquiryReply.findUnique({ where: { id: input.parentId }, select: { id: true, inquiryId: true, kind: true } });
      if (!parent || parent.inquiryId !== params.id || parent.kind !== 'answer') {
        return reply.code(400).send({ error: 'INVALID_PARENT_REPLY', message: '评论对象不存在' });
      }
    }
    const author = inquiry.userId !== userId
      ? await prisma.user.findUnique({ where: { id: userId }, select: { nickname: true } })
      : null;
    const result = await prisma.$transaction(async (tx) => {
      const replyRow = await tx.inquiryReply.create({ data: { inquiryId: params.id, userId, content: input.content, kind: input.kind, parentId: input.parentId ?? null } });
      if (inquiry.userId !== userId) await tx.notification.create({ data: { userId: inquiry.userId, type: 'inquiry_reply', refId: params.id.toString(), payload: { replyId: replyRow.id.toString(), inquiryId: inquiry.id.toString(), inquiryTitle: inquiry.title, replyAuthorNickname: author?.nickname || '同学' } } });
      return replyRow;
    });
    publishRealtime(() => realtime.publishPublic(realtimeEvent('inquiry.replied', params.id, 'public')));
    if (inquiry.userId !== userId) publishRealtime(() => realtime.publishPrivate([inquiry.userId, userId], realtimeEvent('inquiry.replied', params.id, 'private')));
    return reply.code(201).send({ reply: { ...result, id: result.id.toString(), inquiryId: result.inquiryId.toString(), userId: result.userId.toString(), parentId: result.parentId?.toString() ?? null } });
  });

  app.post('/api/inquiries/:id/adopt/:replyId', { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ id: z.coerce.bigint(), replyId: z.coerce.bigint() }).parse(request.params);
    const userId = currentUserId(request);
    try {
      const result = await prisma.$transaction(async (tx) => {
        const inquiry = await tx.inquiry.findUnique({ where: { id: params.id } });
        if (!inquiry) throw new Error('INQUIRY_NOT_FOUND');
        if (inquiry.userId !== userId) throw new Error('INQUIRY_FORBIDDEN');
        if (inquiry.adopted || inquiry.coinStatus === 'transferred') throw new Error('INQUIRY_ALREADY_ADOPTED');
        const answer = await tx.inquiryReply.findFirst({ where: { id: params.replyId, inquiryId: params.id, kind: 'answer' }, include: { user: { select: { nickname: true } } } });
        if (!answer) throw new Error('INQUIRY_REPLY_NOT_FOUND');
        const point = inquiry.bounty > 0
          ? await applyBuddyPointDelta(tx, answer.userId, inquiry.bounty, `inquiry-adopted:${inquiry.id.toString()}`, 'inquiry_adopted', `采纳打听回答:${inquiry.id.toString()}`)
          : null;
        const updated = await tx.inquiry.update({ where: { id: inquiry.id }, data: { adopted: true, adoptedReplyId: answer.id, coinStatus: 'transferred' } });
        if (answer.userId !== userId) await tx.notification.create({ data: { userId: answer.userId, type: 'inquiry_adopted', refId: inquiry.id.toString(), payload: { bounty: inquiry.bounty, replyId: answer.id.toString(), inquiryId: inquiry.id.toString(), inquiryTitle: inquiry.title, replyAuthorNickname: answer.user.nickname } } });
        return { inquiry: updated, point };
      });
      publishRealtime(() => realtime.publishPublic(realtimeEvent('inquiry.adopted', params.id, 'public')));
      if (result.point) publishRealtime(() => realtime.publishPublic(realtimeEvent('ranking.updated', result.inquiry.adoptedReplyId ?? params.replyId, 'public')));
      return { inquiry: serializeInquiry(result.inquiry), point: result.point };
    } catch (error) {
      const code = error instanceof Error ? error.message : 'INQUIRY_ADOPT_FAILED';
      const status = code === 'INQUIRY_NOT_FOUND' || code === 'INQUIRY_REPLY_NOT_FOUND' ? 404 : code === 'INQUIRY_FORBIDDEN' ? 403 : 409;
      const messages: Record<string, string> = { INQUIRY_NOT_FOUND: '打听不存在', INQUIRY_REPLY_NOT_FOUND: '回答不存在', INQUIRY_FORBIDDEN: '只有发布者可以采纳回答', INQUIRY_ALREADY_ADOPTED: '该打听已经采纳过回答' };
      return reply.code(status).send({ error: code, message: messages[code] || '采纳失败，请稍后重试' });
    }
  });

  app.post('/api/inquiries/:id/like', { preHandler: app.authenticate }, async (request, reply) => {
    const params = notificationParamsSchema.parse(request.params);
    const userId = currentUserId(request);
    try {
      const result = await prisma.$transaction(async (tx) => {
        const inquiry = await tx.inquiry.findUnique({ where: { id: params.id }, select: { id: true, likes: true } });
        if (!inquiry) throw new Error('INQUIRY_NOT_FOUND');
        const existing = await tx.inquiryLike.findUnique({ where: { inquiryId_userId: { inquiryId: params.id, userId } } });
        if (existing) {
          await tx.inquiryLike.delete({ where: { id: existing.id } });
          const updated = await tx.inquiry.update({ where: { id: params.id }, data: { likes: { decrement: 1 } }, select: { likes: true } });
          return { liked: false, likes: Math.max(0, updated.likes) };
        }
        await tx.inquiryLike.create({ data: { inquiryId: params.id, userId } });
        const updated = await tx.inquiry.update({ where: { id: params.id }, data: { likes: { increment: 1 } }, select: { likes: true } });
        return { liked: true, likes: updated.likes };
      });
      publishRealtime(() => realtime.publishPublic(realtimeEvent('inquiry.liked', params.id, 'public')));
      return result;
    } catch (error) {
      const code = error instanceof Error ? error.message : 'INQUIRY_LIKE_FAILED';
      return reply.code(code === 'INQUIRY_NOT_FOUND' ? 404 : 409).send({ error: code, message: code === 'INQUIRY_NOT_FOUND' ? '打听不存在' : '点赞失败，请稍后重试' });
    }
  });

  app.post('/api/inquiries/:id/replies/:replyId/like', { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ id: z.coerce.bigint(), replyId: z.coerce.bigint() }).parse(request.params);
    const userId = currentUserId(request);
    try {
      const result = await prisma.$transaction(async (tx) => {
        const answer = await tx.inquiryReply.findFirst({ where: { id: params.replyId, inquiryId: params.id }, select: { id: true } });
        if (!answer) throw new Error('INQUIRY_REPLY_NOT_FOUND');
        const existing = await tx.inquiryReplyLike.findUnique({ where: { replyId_userId: { replyId: params.replyId, userId } } });
        if (existing) {
          await tx.inquiryReplyLike.delete({ where: { id: existing.id } });
          const count = await tx.inquiryReplyLike.count({ where: { replyId: params.replyId } });
          return { liked: false, likes: count };
        }
        await tx.inquiryReplyLike.create({ data: { replyId: params.replyId, userId } });
        const count = await tx.inquiryReplyLike.count({ where: { replyId: params.replyId } });
        return { liked: true, likes: count };
      });
      publishRealtime(() => realtime.publishPublic(realtimeEvent('inquiry.liked', params.id, 'public')));
      publishRealtime(() => realtime.publishPublic(realtimeEvent('ranking.updated', params.replyId, 'public')));
      return result;
    } catch (error) {
      const code = error instanceof Error ? error.message : 'INQUIRY_REPLY_LIKE_FAILED';
      return reply.code(code === 'INQUIRY_REPLY_NOT_FOUND' ? 404 : 409).send({ error: code, message: code === 'INQUIRY_REPLY_NOT_FOUND' ? '回答不存在' : '点赞失败，请稍后重试' });
    }
  });

  app.post('/api/admin/inquiries/refund-expired', { preHandler: app.authenticate }, async (request, reply) => {
    if (!await requireRequestPermission(request, reply, PERMISSION_KEYS.inquiryRefund)) return;
    return refundExpiredInquiries();
  });

  app.get('/api/notifications/unread', { preHandler: app.authenticate }, async (request) => {
    const notifications = await prisma.notification.findMany({ where: { userId: currentUserId(request), readAt: null }, orderBy: { createdAt: 'desc' }, take: 100 });
    return { notifications: notifications.map(serializeNotification) };
  });

  app.post('/api/notifications/:id/read', { preHandler: app.authenticate }, async (request, reply) => {
    const params = notificationParamsSchema.parse(request.params);
    const updated = await prisma.notification.updateMany({ where: { id: params.id, userId: currentUserId(request) }, data: { readAt: new Date() } });
    if (updated.count !== 1) return reply.code(404).send({ error: 'NOTIFICATION_NOT_FOUND', message: '通知不存在' });
    return { ok: true };
  });

  app.post('/api/notifications/read-all', { preHandler: app.authenticate }, async (request) => {
    await prisma.notification.updateMany({ where: { userId: currentUserId(request), readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
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
      const topic = typeof payload.topic === 'string' && payload.topic.trim() ? payload.topic.trim() : null;
      return { topic, action };
    }
    if (feature === 'safety' && action === 'settings') {
      return {
        cooldownUntil: typeof payload.cooldownUntil === 'string' ? payload.cooldownUntil : null,
        stealth: Boolean(payload.enabled),
        blocked: Array.isArray(payload.blocked) ? payload.blocked.filter((item): item is string => typeof item === 'string') : [],
        echoReject: Boolean(payload.echoReject),
      };
    }
    if (feature === 'event') {
      return {
        event: typeof payload.event === 'string' ? payload.event : null,
        status: typeof payload.status === 'string' ? payload.status : 'pending',
        multiplier: typeof payload.multiplier === 'number' ? payload.multiplier : null,
        endsAt: typeof payload.endsAt === 'string' ? payload.endsAt : null,
      };
    }
    return { accepted: true, feature, action };
  }

  app.post('/api/buddy-box/features', { preHandler: app.authenticate }, async (request, reply) => {
    const input = parseBody(buddyFeatureSchema, request.body);
    const userId = currentUserId(request);
    const payload = input.payload ?? {};
    assertSafeJsonText(payload);
    const idempotencyKey = input.idempotencyKey ?? `buddy:${userId.toString()}:${input.feature}:${input.action}:${hashToken(JSON.stringify(input.payload))}`;
    const existing = await prisma.buddyFeatureRecord.findUnique({ where: { idempotencyKey } });
    if (existing) return reply.code(200).send({ accepted: true, duplicate: true, record: serializeBuddyFeature(existing) });
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
      publishRealtime(() => realtime.publishPrivate([userId], realtimeEvent('buddy.feature.updated', record.id, 'private')));
      publishRealtime(() => realtime.publishPublic(realtimeEvent('buddy.feature.updated', record.id, 'public')));
      if (pointDelta !== 0) publishRealtime(() => realtime.publishPublic(realtimeEvent('ranking.updated', userId, 'public')));
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
    const userId = currentUserId(request);
    const [preference, user] = await Promise.all([
      prisma.buddyPreference.findUnique({ where: { userId } }),
      prisma.user.findUnique({ where: { id: userId }, select: { mbtiType: true, interests: true } }),
    ]);
    if (!preference) return { preference: null };
    return {
      preference: {
        ...preference,
        userId: preference.userId.toString(),
        mbtiType: user?.mbtiType ?? preference.mbtiType,
        hobbies: Array.isArray(user?.interests) ? user.interests : preference.hobbies,
      },
    };
  });

  app.put('/api/buddy-box/preferences', { preHandler: app.authenticate }, async (request) => {
    const input = buddyPreferenceSchema.parse(request.body);
    assertSafeText(input.mbtiType, ...input.hobbies, ...input.todayActions, input.province, input.city, input.district);
    const userId = currentUserId(request);
    const preference = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          mbtiType: input.mbtiType ?? null,
          mbtiGroup: input.mbtiType ? mbtiGroupFor(input.mbtiType) : null,
          interests: input.hobbies,
        },
      });
      return tx.buddyPreference.upsert({
        where: { userId },
        create: { userId, mbtiType: input.mbtiType ?? null, hobbies: input.hobbies, todayActions: input.todayActions, province: input.province ?? null, city: input.city ?? null, district: input.district ?? null, stealth: input.stealth ?? false },
        update: { mbtiType: input.mbtiType ?? null, hobbies: input.hobbies, todayActions: input.todayActions, province: input.province ?? null, city: input.city ?? null, district: input.district ?? null, ...(input.stealth === undefined ? {} : { stealth: input.stealth }) },
      });
    });
    return { preference: { ...preference, userId: preference.userId.toString() } };
  });

  app.get('/api/buddy-box/recommendations', { preHandler: app.authenticate }, async (request) => {
    const userId = currentUserId(request);
    const { action: requestedAction } = buddyRecommendationQuerySchema.parse(request.query);
    const mine = await prisma.buddyPreference.findUnique({ where: { userId } });
    const users = await prisma.user.findMany({
      where: { id: { not: userId }, status: 'active', OR: [{ buddyPreference: null }, { buddyPreference: { stealth: false } }] },
      select: { id: true, nickname: true, school: true, major: true, city: true, bio: true, mbtiType: true, eggRarity: true, buddyPreference: true },
      orderBy: { createdAt: 'desc' }, take: 50,
    });
    const profileIds = users.map((user) => user.id);
    const relationships = profileIds.length
      ? await prisma.buddyFriendRequest.findMany({
          where: {
            OR: [
              { requesterId: userId, recipientId: { in: profileIds } },
              { recipientId: userId, requesterId: { in: profileIds } },
            ],
          },
          select: { id: true, requesterId: true, recipientId: true, status: true, updatedAt: true },
        })
      : [];
    const relationshipByUser = new Map<string, { id: bigint; status: string; updatedAt: Date; incoming: boolean }>();
    relationships.forEach((relationship) => {
      const otherId = relationship.requesterId === userId ? relationship.recipientId : relationship.requesterId;
      const key = otherId.toString();
      const incoming = relationship.recipientId === userId;
      const previous = relationshipByUser.get(key);
      const rank = (status: string) => status === 'accepted' ? 4 : status === 'pending' ? 3 : status === 'rejected' ? 2 : 1;
      const previousRank = previous ? rank(previous.status) : 0;
      const currentRank = rank(relationship.status);
      if (!previous || currentRank > previousRank || (currentRank === previousRank && relationship.updatedAt.getTime() > previous.updatedAt.getTime())) {
        relationshipByUser.set(key, { id: relationship.id, status: relationship.status, updatedAt: relationship.updatedAt, incoming });
      }
    });
    const mineHobbies = new Set(Array.isArray(mine?.hobbies) ? mine.hobbies.filter((item): item is string => typeof item === 'string') : []);
    const normalizedRequestedAction = requestedAction?.trim().toLocaleLowerCase() || '';
    const profiles = users.map((user) => {
      const hobbies = Array.isArray(user.buddyPreference?.hobbies) ? user.buddyPreference.hobbies.filter((item): item is string => typeof item === 'string') : [];
      const todayActions = Array.isArray(user.buddyPreference?.todayActions) ? user.buddyPreference.todayActions.filter((item): item is string => typeof item === 'string') : [];
      const sameMbti = Boolean(mine?.mbtiType && (user.buddyPreference?.mbtiType ?? user.mbtiType) === mine.mbtiType);
      const overlap = hobbies.filter((hobby) => mineHobbies.has(hobby)).length;
      const actionMatch = Boolean(normalizedRequestedAction && todayActions.some((candidate) => {
        const normalizedCandidate = candidate.trim().toLocaleLowerCase();
        return normalizedCandidate === normalizedRequestedAction
          || normalizedCandidate.includes(normalizedRequestedAction)
          || normalizedRequestedAction.includes(normalizedCandidate);
      }));
      const relationship = relationshipByUser.get(user.id.toString());
      const friendStatus = relationship?.status === 'accepted'
        ? 'accepted'
        : relationship?.status === 'pending'
          ? 'pending'
          : relationship?.status === 'rejected' && relationship.updatedAt.getTime() > Date.now() - 30 * 60 * 1000
            ? 'rejected_cooldown'
            : 'none';
      return { id: user.id.toString(), name: user.nickname, meta: [user.school, user.major].filter(Boolean).join(' · ') || '蛋蛋校园用户', city: user.city, bio: user.bio || '', mbtiType: user.buddyPreference?.mbtiType ?? user.mbtiType, hobbies, todayActions, rarity: user.eggRarity, friendStatus, friendRequestId: relationship?.id.toString() ?? null, score: (sameMbti ? 3 : 0) + overlap + (actionMatch ? 4 : 0) };
    }).sort((a, b) => b.score - a.score).map(({ score: _score, ...profile }) => profile);
    return { profiles };
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
    const senderId = currentUserId(request);
    assertSafeText(input.text, input.source);
    if (input.recipientId === senderId) return reply.code(400).send({ error: 'INVALID_RECIPIENT', message: '不能给自己发送留言' });
    const recipient = await prisma.user.findFirst({ where: { id: input.recipientId, status: 'active' }, select: { id: true } });
    if (!recipient) return reply.code(404).send({ error: 'USER_NOT_FOUND', message: '用户不存在' });
    const friendship = await prisma.buddyFriendRequest.findFirst({ where: { status: 'accepted', OR: [{ requesterId: senderId, recipientId: input.recipientId }, { requesterId: input.recipientId, recipientId: senderId }] } });
    if (!friendship) return reply.code(403).send({ error: 'FRIEND_REQUIRED', message: '接受好友后才能聊天' });
    const message = await prisma.buddyMessage.create({ data: { senderId, recipientId: input.recipientId, text: input.text, source: input.source } });
    publishRealtime(() => realtime.publishPrivate([senderId, input.recipientId], realtimeEvent('buddy.message.created', message.id, 'private')));
    return { message: { ...message, id: message.id.toString(), senderId: message.senderId.toString(), recipientId: message.recipientId.toString() } };
  });

  app.get('/api/buddy-box/conversations/:userId/messages', { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ userId: z.coerce.bigint() }).parse(request.params);
    const userId = currentUserId(request);
    const friendship = await prisma.buddyFriendRequest.findFirst({ where: { status: 'accepted', OR: [{ requesterId: userId, recipientId: params.userId }, { requesterId: params.userId, recipientId: userId }] } });
    if (!friendship) return reply.code(403).send({ error: 'FRIEND_REQUIRED', message: '接受好友后才能聊天' });
    const messages = await prisma.buddyMessage.findMany({ where: { OR: [{ senderId: userId, recipientId: params.userId }, { senderId: params.userId, recipientId: userId }] }, orderBy: { createdAt: 'desc' }, take: 100 });
    return { messages: messages.reverse().map((message) => ({ ...message, id: message.id.toString(), senderId: message.senderId.toString(), recipientId: message.recipientId.toString() })) };
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
    const requesterId = currentUserId(request);
    if (input.recipientId === requesterId) return reply.code(400).send({ error: 'INVALID_RECIPIENT', message: '不能申请自己为好友' });
    const recipient = await prisma.user.findFirst({ where: { id: input.recipientId, status: 'active' }, select: { id: true } });
    if (!recipient) return reply.code(404).send({ error: 'USER_NOT_FOUND', message: '用户不存在' });
    try {
      const requestRow = await prisma.$transaction(async (tx) => {
        // Lock both user rows so concurrent A->B and B->A requests share one decision point.
        await tx.$queryRaw`SELECT id FROM users WHERE id IN (${requesterId}, ${input.recipientId}) FOR UPDATE`;
        const [outgoing, incoming] = await Promise.all([
          tx.buddyFriendRequest.findUnique({ where: { requesterId_recipientId: { requesterId, recipientId: input.recipientId } } }),
          tx.buddyFriendRequest.findUnique({ where: { requesterId_recipientId: { requesterId: input.recipientId, recipientId: requesterId } } }),
        ]);
        const existingRows = [outgoing, incoming].filter((row): row is NonNullable<typeof row> => Boolean(row));
        if (existingRows.some((row) => row.status === 'accepted')) throw new Error('FRIEND_EXISTS');
        if (existingRows.some((row) => row.status === 'pending')) throw new Error('REQUEST_PENDING');
        const rejectedRecently = existingRows.some((row) => row.status === 'rejected' && row.updatedAt.getTime() > Date.now() - 30 * 60 * 1000);
        if (rejectedRecently) throw new Error('REJECT_COOLDOWN');
        const reusable = outgoing ?? incoming;
        return reusable
          ? tx.buddyFriendRequest.update({ where: { id: reusable.id }, data: { requesterId, recipientId: input.recipientId, status: 'pending' } })
          : tx.buddyFriendRequest.create({ data: { requesterId, recipientId: input.recipientId } });
      });
      publishRealtime(() => realtime.publishPrivate([requestRow.requesterId, requestRow.recipientId], realtimeEvent('buddy.friend.updated', requestRow.id, 'private')));
      return { request: { ...requestRow, id: requestRow.id.toString(), requesterId: requestRow.requesterId.toString(), recipientId: requestRow.recipientId.toString() } };
    } catch (error) {
      const code = error instanceof Error ? error.message : 'FRIEND_REQUEST_FAILED';
      if (code === 'FRIEND_EXISTS') return reply.code(409).send({ error: code, message: '双方已经是好友' });
      if (code === 'REQUEST_PENDING') return reply.code(409).send({ error: code, message: '已有待处理请求' });
      if (code === 'REJECT_COOLDOWN') return reply.code(409).send({ error: code, message: '对方已拒绝，30分钟内不能再次添加' });
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') return reply.code(409).send({ error: 'REQUEST_PENDING', message: '已有待处理请求' });
      throw error;
    }
  });

  app.post('/api/buddy-box/friend-requests/:id/accept', { preHandler: app.authenticate }, async (request, reply) => {
    const params = buddyIdParamsSchema.parse(request.params);
    const requestRow = await prisma.buddyFriendRequest.findFirst({
      where: { id: params.id, recipientId: currentUserId(request), status: 'pending' },
      select: { requesterId: true, recipientId: true },
    });
    if (!requestRow) return reply.code(404).send({ error: 'FRIEND_REQUEST_NOT_FOUND', message: '好友申请不存在或已处理' });
    const updated = await prisma.buddyFriendRequest.updateMany({
      where: { id: params.id, recipientId: currentUserId(request), status: 'pending' },
      data: { status: 'accepted' },
    });
    if (updated.count !== 1) return reply.code(404).send({ error: 'FRIEND_REQUEST_NOT_FOUND', message: '好友申请不存在或已处理' });
    publishRealtime(() => realtime.publishPrivate([requestRow.requesterId, requestRow.recipientId], realtimeEvent('buddy.friend.updated', params.id, 'private')));
    return { ok: true };
  });

  app.post('/api/buddy-box/friend-requests/:id/reject', { preHandler: app.authenticate }, async (request, reply) => {
    const params = buddyIdParamsSchema.parse(request.params);
    const requestRow = await prisma.buddyFriendRequest.findFirst({
      where: { id: params.id, recipientId: currentUserId(request), status: 'pending' },
      select: { requesterId: true, recipientId: true },
    });
    if (!requestRow) return reply.code(404).send({ error: 'FRIEND_REQUEST_NOT_FOUND', message: '好友申请不存在或已处理' });
    const updated = await prisma.buddyFriendRequest.updateMany({
      where: { id: params.id, recipientId: currentUserId(request), status: 'pending' },
      data: { status: 'rejected' },
    });
    if (updated.count !== 1) return reply.code(404).send({ error: 'FRIEND_REQUEST_NOT_FOUND', message: '好友申请不存在或已处理' });
    publishRealtime(() => realtime.publishPrivate([requestRow.requesterId, requestRow.recipientId], realtimeEvent('buddy.friend.updated', params.id, 'private')));
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
        where: { email: target, status: 'active' },
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
      where: { email: target, status: 'active' },
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
    assertSafeText(input.nickname, input.school, input.major, input.city, input.grade, input.email, input.inviteCode);
    const passwordHash = await hashPassword(input.password);
    const eggCategory = input.eggCategory ?? 'study';

    try {
      const user = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const created = await tx.user.create({
          data: {
            nickname: input.nickname,
            email: input.email,
            passwordHash,
            school: input.school,
            major: input.major,
            city: input.city,
            grade: input.grade,
            age: input.age,
            mbtiType: input.mbtiType,
            mbtiGroup: input.mbtiGroup,
            eggCategory,
            verifiedPhoneAt: null,
            verifiedEmailAt: null,
            inviteCode: newInviteCode(),
            stats: { create: {} },
            account: { create: { availableBalance: 100 } },
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
            deltaAvailable: 100,
            deltaFrozen: 0,
            balanceAvailable: 100,
            balanceFrozen: 0,
            idempotencyKey: `register:${created.id.toString()}`,
            remark: '初次上线 +100蛋蛋币',
          },
        });
        if (input.inviteCode) await bindInvitation(tx, created.id, input.inviteCode);
        return created;
      });

      const tokens = await issueSession(app, user, request);
      await recordAudit({ actorId: user.id, action: 'auth.register', targetType: 'user', targetId: user.id.toString(), ip: request.ip });
      setRefreshCookie(reply, tokens.refreshToken, config);
      return reply.code(201).send({ user: privateUserShape(user), ...sessionResponse(tokens, config) });
    } catch (error) {
      const code = prismaErrorCode(error);
      if (code === 'P2002') {
        return reply.code(409).send({ error: 'DUPLICATE_USER', message: '昵称或邮箱已被使用' });
      }
      if (error instanceof InvitationError) {
        const status = error.code === 'INVITE_ALREADY_BOUND' ? 409 : 400;
        return reply.code(status).send({ error: error.code, message: error.message });
      }
      if (isPrismaDatabaseError(error)) {
        request.log.error({ errorName: error instanceof Error ? error.name : 'PrismaClientError', prismaCode: code }, 'registration database unavailable');
        return reply.code(503).send({ error: 'DATABASE_UNAVAILABLE', message: '注册服务暂时不可用，请稍后重试' });
      }
      throw error;
    }
  });

  app.post('/api/auth/login', async (request, reply) => {
    const input = parseBody(loginSchema, request.body);
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: input.identifier.toLowerCase() }, { nickname: input.identifier }] },
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

  app.post('/api/auth/change-required-password', { preHandler: app.authenticate }, async (request, reply) => {
    const input = requiredPasswordChangeSchema.parse(request.body);
    const userId = currentUserId(request);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true, mustChangePassword: true, role: true } });
    if (!user) return reply.code(404).send({ error: 'USER_NOT_FOUND', message: '用户不存在' });
    if (!user.mustChangePassword) return reply.code(409).send({ error: 'PASSWORD_CHANGE_NOT_REQUIRED', message: '当前账号不需要执行首次改密' });
    if (!await verifyPassword(input.currentPassword, user.passwordHash)) return reply.code(401).send({ error: 'INVALID_CREDENTIALS', message: '当前密码错误' });
    if (await verifyPassword(input.newPassword, user.passwordHash)) return reply.code(400).send({ error: 'PASSWORD_UNCHANGED', message: '新密码不能与临时密码相同' });
    const passwordHash = await hashPassword(input.newPassword);
    const now = new Date();
    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: false } }),
      prisma.authSession.updateMany({ where: { userId, id: { not: request.user.sessionId }, revokedAt: null }, data: { revokedAt: now } }),
    ]);
    const accessToken = await app.jwt.sign({ sub: userId.toString(), sessionId: request.user.sessionId, role: user.role, mustChangePassword: false }, { expiresIn: '15m' });
    await recordAudit({ actorId: userId, action: 'auth.required_password_changed', targetType: 'user', targetId: userId.toString(), ip: request.ip });
    return { ok: true, accessToken };
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
      { sub: user.id.toString(), sessionId: session.id, role: user.role, mustChangePassword: user.mustChangePassword },
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

    const user = await prisma.user.findFirst({ where: { email: target } });
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
    const authorization = await authorizationFor(request);
    return {
      user: {
        ...privateUserShape(user),
        permissionKeys: authorization.permissionKeys,
        isAdministrator: authorization.isProtectedAdmin || hasAdministrativePermission(authorization.permissionKeys),
        isProtectedAdmin: authorization.isProtectedAdmin,
      },
    };
  });

  app.put('/api/users/me', { preHandler: app.authenticate }, async (request, reply) => {
    const input = profileUpdateSchema.parse(request.body);
    assertSafeText(input.nickname, input.bio, input.school, input.major, input.city, input.grade, input.email, ...(input.interests ?? []));
    assertSafeSkillTags(...(input.skills ?? []));
    const userId = currentUserId(request);
    try {
      const { user, changedFields } = await prisma.$transaction(async (tx) => {
        const current = await tx.user.findUnique({
          where: { id: userId },
          select: { nickname: true, email: true, nicknameChangedAt: true, protectedAdminKey: true },
        });
        if (!current) throw new Error('USER_NOT_FOUND');
        const prepared = prepareProfileUpdate(current, input);
        const updated = await tx.user.update({
          where: { id: userId },
          data: prepared.userData as Prisma.UserUpdateInput,
        });
        if (Object.keys(prepared.buddyData).length > 0) {
          await tx.buddyPreference.upsert({
            where: { userId },
            create: {
              userId,
              mbtiType: (prepared.buddyData.mbtiType as string | null | undefined) ?? null,
              hobbies: (prepared.buddyData.hobbies as string[] | undefined) ?? [],
              todayActions: [],
            },
            update: prepared.buddyData as Prisma.BuddyPreferenceUpdateInput,
          });
        }
        return { user: updated, changedFields: Object.keys(prepared.userData) };
      });
      await recordAudit({ actorId: userId, action: 'user.profile.update', targetType: 'user', targetId: userId.toString(), ip: request.ip, afterData: { changedFields } });
      return { user: privateUserShape(user) };
    } catch (error) {
      if (error instanceof Error && error.message === 'USER_NOT_FOUND') {
        return reply.code(404).send({ error: 'USER_NOT_FOUND', message: '用户不存在' });
      }
      if (error instanceof ProfileRuleError) {
        if (error.code === 'NICKNAME_CHANGE_COOLDOWN') {
          return reply.code(409).send({ error: error.code, message: '昵称每 30 天只能修改一次', availableAt: error.availableAt });
        }
        return reply.code(403).send({ error: error.code, message: '固定管理员昵称不能修改' });
      }
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
        return reply.code(409).send({ error: 'DUPLICATE_USER', message: '昵称或邮箱已被使用' });
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

  app.get('/api/users/me/ratings', { preHandler: app.authenticate }, async (request) => {
    const userId = currentUserId(request);
    const [ratings, aggregate] = await Promise.all([
      prisma.rating.findMany({
        where: { toUserId: userId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: {
          fromUser: { select: { id: true, nickname: true } },
          task: { select: { id: true, title: true } },
        },
      }),
      prisma.rating.aggregate({ where: { toUserId: userId }, _avg: { score: true }, _count: { _all: true } }),
    ]);
    return {
      average: aggregate._avg.score === null ? null : Number(aggregate._avg.score),
      count: aggregate._count._all,
      ratings: ratings.map((rating) => ({
        id: rating.id.toString(),
        taskId: rating.taskId.toString(),
        score: rating.score,
        comment: rating.comment,
        createdAt: rating.createdAt,
        from: rating.fromUser ? { id: rating.fromUser.id.toString(), nickname: rating.fromUser.nickname } : null,
        task: rating.task ? { id: rating.task.id.toString(), title: rating.task.title } : null,
      })),
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

  app.get('/api/users/me/invitations', { preHandler: app.authenticate }, async (request, reply) => {
    const userId = currentUserId(request);
    const [user, invitations] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { inviteCode: true } }),
      prisma.invitation.findMany({
        where: { inviterId: userId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { invitedUser: { select: { id: true, nickname: true, status: true, createdAt: true } } },
      }),
    ]);
    if (!user) return reply.code(404).send({ error: 'USER_NOT_FOUND', message: '用户不存在' });
    const rewardedCount = invitations.filter((invitation) => invitation.rewardedAt !== null).length;
    return {
      inviteCode: user.inviteCode,
      invitedCount: invitations.length,
      rewardedCount,
      totalReward: rewardedCount * 20,
      invitations: invitations.map((invitation) => ({
        id: invitation.id.toString(),
        invitedUser: {
          id: invitation.invitedUser.id.toString(),
          nickname: invitation.invitedUser.nickname,
          status: invitation.invitedUser.status,
          createdAt: invitation.invitedUser.createdAt,
        },
        createdAt: invitation.createdAt,
        rewardedAt: invitation.rewardedAt,
        rewardedTaskId: invitation.rewardedTaskId?.toString() ?? null,
        status: invitation.rewardedAt ? 'rewarded' : 'pending_first_approved_task',
        reward: invitation.rewardedAt ? 20 : 0,
      })),
    };
  });

  app.get('/api/users/leaderboard', async (request) => {
    const query = z.object({ category: z.string().default('all'), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) }).parse(request.query);
    const skip = (query.page - 1) * query.pageSize;
    if (query.category === 'gossip') {
      type GossipRow = { id: bigint; nickname: string; mbtiType: string | null; eggCategory: string | null; eggRarity: string; likes: number; reputation: number | string; createdAt: Date; gossipLikes: bigint | number; answerCount: bigint | number; adoptedCount: bigint | number };
      const rows = await prisma.$queryRaw<GossipRow[]>(Prisma.sql`
        SELECT u.id, u.nickname, u.mbti_type AS mbtiType, u.egg_category AS eggCategory,
               u.egg_rarity AS eggRarity, u.likes, u.reputation, u.created_at AS createdAt,
               COUNT(DISTINCT l.id) AS gossipLikes,
               COUNT(DISTINCT r.id) AS answerCount,
               COUNT(DISTINCT CASE WHEN i.adopted_reply_id = r.id THEN r.id END) AS adoptedCount
        FROM users u
        INNER JOIN inquiry_replies r ON r.user_id = u.id AND r.kind = 'answer'
        INNER JOIN inquiries i ON i.id = r.inquiry_id
        LEFT JOIN inquiry_reply_likes l ON l.reply_id = r.id
        WHERE u.status = 'active' AND u.role = 'student'
        GROUP BY u.id, u.nickname, u.mbti_type, u.egg_category, u.egg_rarity, u.likes, u.reputation, u.created_at
        ORDER BY gossipLikes DESC, adoptedCount DESC, u.nickname ASC
        LIMIT ${query.pageSize} OFFSET ${skip}
      `);
      return {
        users: rows.map((item, index) => ({
          id: item.id.toString(), nickname: item.nickname, mbtiType: item.mbtiType, eggCategory: item.eggCategory, eggRarity: item.eggRarity,
          likes: item.likes, reputation: Number(item.reputation), experience: 0, gossipLikes: Number(item.gossipLikes), answerCount: Number(item.answerCount), adoptedCount: Number(item.adoptedCount),
          rank: skip + index + 1, stats: { knowledge: 0, skills: 0, charm: 0, money: 0, reputation: Number(item.reputation) }, coins: 0, createdAt: item.createdAt,
        })),
        page: query.page, pageSize: query.pageSize,
      };
    }
    const categoryMap: Record<string, string | undefined> = {
      study: 'study', '学业技术': 'study',
      job: 'job', '就业技能': 'job',
      side: 'side', '副业技能': 'side',
      hobby: 'hobby', '兴趣爱好': 'hobby',
      game: 'game', '游戏搭子': 'game',
      life: 'life', '生活互助': 'life',
    };
    const where = {
      status: 'active' as const,
      role: 'student' as const,
      ...(categoryMap[query.category] ? { eggCategory: categoryMap[query.category] } : {}),
    };
    const leaderboardCategory = categoryMap[query.category] ?? query.category;
    const orderBy = leaderboardCategory === 'rich'
      ? [{ account: { availableBalance: 'desc' as const } }, { stats: { experience: 'desc' as const } }, { likes: 'desc' as const }]
      : leaderboardCategory === 'study'
        ? [{ stats: { knowledge: 'desc' as const } }, { stats: { experience: 'desc' as const } }]
        : leaderboardCategory === 'job'
          ? [{ stats: { skills: 'desc' as const } }, { stats: { experience: 'desc' as const } }]
          : leaderboardCategory === 'side'
            ? [{ stats: { money: 'desc' as const } }, { stats: { experience: 'desc' as const } }]
            : (leaderboardCategory === 'hobby' || leaderboardCategory === 'game' || leaderboardCategory === 'life')
              ? [{ stats: { charm: 'desc' as const } }, { stats: { experience: 'desc' as const } }]
              : [{ stats: { experience: 'desc' as const } }, { likes: 'desc' as const }];
    const users = await prisma.user.findMany({
      where,
      orderBy,
      skip,
      take: query.pageSize,
      select: {
        id: true, nickname: true, mbtiType: true, eggCategory: true, eggRarity: true, likes: true, reputation: true, createdAt: true,
        stats: { select: { experience: true, knowledge: true, skills: true, charm: true, money: true, reputation: true } },
        account: { select: { availableBalance: true } },
      },
    });
    const result = users.map((user, index) => ({
      id: user.id.toString(),
      nickname: user.nickname,
      mbtiType: user.mbtiType,
      eggCategory: user.eggCategory,
      eggRarity: user.eggRarity,
      likes: user.likes,
      reputation: Number(user.reputation),
      experience: user.stats?.experience ?? 0,
      stats: user.stats ? {
        knowledge: Number(user.stats.knowledge), skills: Number(user.stats.skills), charm: Number(user.stats.charm), money: Number(user.stats.money), reputation: Number(user.stats.reputation),
      } : { knowledge: 0, skills: 0, charm: 0, money: 0, reputation: 0 },
      coins: user.account?.availableBalance ?? 0,
      createdAt: user.createdAt,
      rank: skip + index + 1,
    })).sort((a, b) => {
      if (query.category === 'rich') return b.coins - a.coins || b.experience - a.experience;
      if (query.category === 'gossip') return 0;
      if (query.category === 'study') return b.stats.knowledge - a.stats.knowledge || b.experience - a.experience;
      if (query.category === 'job') return b.stats.skills - a.stats.skills || b.experience - a.experience;
      if (query.category === 'side') return b.stats.money - a.stats.money || b.experience - a.experience;
      if (query.category === 'hobby' || query.category === 'game' || query.category === 'life') return b.stats.charm - a.stats.charm || b.experience - a.experience;
      return b.experience - a.experience || b.likes - a.likes;
    });
    return { users: result, page: query.page, pageSize: query.pageSize };
  });

  app.get('/api/users/:id/public-profile', async (request, reply) => {
    const params = z.object({ id: z.coerce.bigint() }).parse(request.params);
    const user = await prisma.user.findUnique({ where: { id: params.id } });
    if (!user || user.status !== 'active') return reply.code(404).send({ error: 'USER_NOT_FOUND' });
    return { user: publicUserShape(user) };
  });

  app.setErrorHandler((error, _request, reply) => {
    if (
      error
      && typeof error === 'object'
      && 'code' in error
      && ['FST_ERR_CTP_INVALID_JSON_BODY', 'FST_ERR_CTP_EMPTY_JSON_BODY'].includes(String(error.code))
    ) {
      return reply.code(400).send({ error: 'INVALID_JSON', message: '请求格式不正确，请检查后重试' });
    }
    if (error instanceof Error && error.name === 'ContentBlockedError') {
      return reply.code(400).send({ error: 'CONTENT_BLOCKED', message: CONTENT_BLOCKED_MESSAGE });
    }
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: '请求参数不符合要求', details: error.flatten() });
    }
    if (error instanceof FeedbackRuleError) {
      const messages: Record<string, string> = {
        FEEDBACK_TRANSITION_INVALID: '当前反馈状态不能执行此操作',
        FEEDBACK_APPEND_NOT_ALLOWED: '只有待修改状态可以补充反馈',
        FEEDBACK_REOPEN_NOT_ALLOWED: '该反馈已超过重新处理期限或已申请过一次',
      };
      return reply.code(409).send({ error: error.code, message: messages[error.code] });
    }
    if (error instanceof AuthorizationError) {
      return reply.code(403).send({ error: error.code, message: error.message });
    }
    if (error instanceof Error && error.message === 'INVALID_GRANT_DURATION') {
      return reply.code(400).send({ error: 'INVALID_GRANT_DURATION', message: '自定义授权期限必须在 1 小时到 1 年之间' });
    }
    app.log.error(error);
    return reply.code(500).send({ error: 'INTERNAL_ERROR', message: '服务器内部错误' });
  });

  return app;
}
