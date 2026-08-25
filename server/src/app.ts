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
import { assertSafeJsonText, assertSafeText, CONTENT_BLOCKED_MESSAGE } from './content-filter.js';

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

export async function refundExpiredInquiries(now = new Date()) {
  const expired = await prisma.inquiry.findMany({ where: { deadline: { lt: now }, adopted: false, coinStatus: 'frozen', bounty: { gt: 0 } }, select: { id: true, userId: true, bounty: true } });
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
  });
  const taskMineQuerySchema = z.object({ status: z.string().trim().max(30).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
  const taskReviewSchema = z.object({ status: z.enum(['approved', 'completed', 'needs_revision']), reviewReason: z.string().trim().max(500).nullable().optional() });
  const taskClaimSchema = z.object({ contact: z.string().trim().max(160).nullable().optional() });
  const taskCompleteSchema = z.object({ claimId: z.coerce.bigint().nullable().optional() });
  const taskAssignSchema = z.object({ claimIds: z.array(z.coerce.bigint()).min(1).max(100) });
  const taskRatingSchema = z.object({ toUserId: z.coerce.bigint(), score: z.coerce.number().int().min(1).max(5), comment: z.string().trim().max(2000).nullable().optional() });
  const feedbackSchema = z.object({ type: z.string().trim().min(1).max(50), content: z.string().trim().min(1).max(10000), contact: z.string().trim().max(160).nullable().optional(), source: z.string().trim().max(100).nullable().optional() });
  const feedbackAdminSchema = z.object({ status: z.enum(['open', 'processing', 'resolved', 'closed']).optional(), adminRemark: z.string().trim().max(10000).nullable().optional() });
  const inquiryCreateSchema = z.object({ title: z.string().trim().min(1).max(160), content: z.string().trim().min(1).max(10000), tags: z.array(z.string().trim().max(40)).max(8).default([]), bounty: z.coerce.number().int().min(0).max(10000).default(0), deadline: z.coerce.date().nullable().optional() });
  const inquiryReplySchema = z.object({ content: z.string().trim().min(1).max(10000), kind: z.enum(['answer', 'comment']).default('answer'), parentId: z.coerce.bigint().nullable().optional() });
  const notificationParamsSchema = z.object({ id: z.coerce.bigint() });

  function serializeTask(task: any) {
    return { ...task, id: task.id.toString(), userId: task.userId.toString() };
  }
  function serializeFeedback(feedback: any) {
    return { ...feedback, id: feedback.id.toString(), userId: feedback.userId.toString() };
  }
  function serializeInquiry(inquiry: any) {
    return { ...inquiry, id: inquiry.id.toString(), userId: inquiry.userId.toString(), bounty: Number(inquiry.bounty), tags: Array.isArray(inquiry.tags) ? inquiry.tags : [], adoptedReplyId: inquiry.adoptedReplyId == null ? null : inquiry.adoptedReplyId.toString(), deadline: inquiry.deadline ?? null };
  }
  function serializeNotification(notification: any) {
    return { ...notification, id: notification.id.toString(), userId: notification.userId.toString() };
  }
  function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
    if (request.user.role !== 'admin') {
      reply.code(403).send({ error: 'FORBIDDEN', message: '仅管理员可执行此操作' });
      return false;
    }
    return true;
  }

  app.post('/api/tasks', { preHandler: app.authenticate }, async (request, reply) => {
    const input = taskCreateSchema.parse(request.body);
    assertSafeText(input.title, input.description, input.remark, input.contact, input.requirements);
    const task = await prisma.task.create({ data: { userId: currentUserId(request), title: input.title, description: input.description, remark: input.remark ?? null, taskType: input.taskType, claimMode: input.claimMode, reward: input.reward, maxClaimers: input.maxClaimers, contact: input.contact ?? null, requirements: input.requirements ?? null } });
    return reply.code(201).send({ task: serializeTask(task) });
  });

  app.get('/api/tasks/mine', { preHandler: app.authenticate }, async (request) => {
    const query = taskMineQuerySchema.parse(request.query);
    const tasks = await prisma.task.findMany({ where: { userId: currentUserId(request), ...(query.status ? { status: query.status } : {}) }, orderBy: { createdAt: 'desc' }, take: query.limit });
    return { tasks: tasks.map(serializeTask) };
  });

  app.patch('/api/tasks/:id/review', { preHandler: app.authenticate }, async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const params = notificationParamsSchema.parse(request.params);
    const input = taskReviewSchema.parse(request.body);
    assertSafeText(input.reviewReason);
    const existing = await prisma.task.findUnique({ where: { id: params.id } });
    if (!existing) return reply.code(404).send({ error: 'TASK_NOT_FOUND', message: '任务不存在' });
    const now = new Date();
    let task;
    try {
      task = await prisma.$transaction(async (tx) => {
        if (input.status === 'approved' && existing.userId !== currentUserId(request) && existing.reward > 0 && (existing.taskType === 'help' || existing.taskType === 'team' || existing.taskType === 'reward')) {
          const units = existing.taskType === 'team' ? existing.maxClaimers : 1;
          await applyBuddyPointDelta(tx, existing.userId, -(existing.reward * units), `task-review-freeze:${existing.id.toString()}`, 'task_reward_frozen', `任务审核冻结蛋蛋币:${existing.id.toString()}`);
        }
        const updated = await tx.task.update({ where: { id: params.id }, data: { status: input.status, reviewReason: input.reviewReason ?? null, reviewedAt: input.status === 'approved' || input.status === 'needs_revision' ? now : existing.reviewedAt, completedAt: input.status === 'completed' ? now : existing.completedAt } });
        await tx.notification.create({ data: { userId: existing.userId, type: input.status === 'approved' ? 'task_review_approved' : 'task_review_needs_revision', refId: existing.id.toString(), payload: { taskId: existing.id.toString(), status: input.status, reviewReason: input.reviewReason ?? null } } });
        return updated;
      });
    } catch (error) {
      if (error instanceof BuddyPrestigeError) return reply.code(409).send({ error: error.message, message: error.message === 'INSUFFICIENT_PRESTIGE' ? '蛋蛋币不足，无法冻结任务奖励' : '蛋蛋币账户不存在' });
      throw error;
    }
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
      return reply.code(201).send({ claim: { ...claim, id: claim.id.toString(), taskId: claim.taskId.toString(), claimerId: claim.claimerId.toString() } });
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') return reply.code(409).send({ error: 'TASK_ALREADY_CLAIMED', message: '你已经认领过该任务' });
      if (error instanceof BuddyPrestigeError) return reply.code(409).send({ error: error.message, message: error.message === 'INSUFFICIENT_PRESTIGE' ? '蛋蛋币不足，无法认领' : '蛋蛋币账户不存在' });
      throw error;
    }
  });

  app.post('/api/tasks/:id/submit', { preHandler: app.authenticate }, async (request, reply) => {
    const params = notificationParamsSchema.parse(request.params);
    const userId = currentUserId(request);
    const claim = await prisma.taskClaim.findFirst({ where: { taskId: params.id, claimerId: userId, status: { in: ['pending', 'assigned'] } } });
    if (!claim) return reply.code(404).send({ error: 'TASK_CLAIM_NOT_FOUND', message: '没有可提交的任务认领' });
    const updated = await prisma.taskClaim.update({ where: { id: claim.id }, data: { status: 'submitted', submittedAt: new Date() } });
    const task = await prisma.task.findUnique({ where: { id: params.id }, select: { userId: true } });
    if (task) await prisma.notification.create({ data: { userId: task.userId, type: 'task_submitted', refId: params.id.toString(), payload: { taskId: params.id.toString(), claimId: claim.id.toString() } } });
    return { claim: { ...updated, id: updated.id.toString(), taskId: updated.taskId.toString(), claimerId: updated.claimerId.toString() } };
  });

  app.get('/api/tasks/:id/claims', { preHandler: app.authenticate }, async (request, reply) => {
    const params = notificationParamsSchema.parse(request.params);
    const userId = currentUserId(request);
    const task = await prisma.task.findUnique({ where: { id: params.id }, select: { userId: true } });
    if (!task) return reply.code(404).send({ error: 'TASK_NOT_FOUND', message: '任务不存在' });
    const claims = await prisma.taskClaim.findMany({ where: { taskId: params.id, ...(task.userId === userId || request.user.role === 'admin' ? {} : { claimerId: userId }) }, orderBy: { createdAt: 'asc' }, include: { claimer: { select: { id: true, nickname: true, mbtiType: true, reputation: true, bio: true } } } });
    return { claims: claims.map((claim) => ({ ...claim, id: claim.id.toString(), taskId: claim.taskId.toString(), claimerId: claim.claimerId.toString(), claimer: claim.claimer ? { ...claim.claimer, id: claim.claimer.id.toString(), reputation: Number(claim.claimer.reputation) } : null })) };
  });

  app.patch('/api/tasks/:id/claims/assign', { preHandler: app.authenticate }, async (request, reply) => {
    const params = notificationParamsSchema.parse(request.params);
    const input = taskAssignSchema.parse(request.body);
    const userId = currentUserId(request);
    const task = await prisma.task.findUnique({ where: { id: params.id } });
    if (!task) return reply.code(404).send({ error: 'TASK_NOT_FOUND', message: '任务不存在' });
    if (task.userId !== userId && request.user.role !== 'admin') return reply.code(403).send({ error: 'FORBIDDEN', message: '只有发布者可以确认配对' });
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
    return { assigned: result };
  });

  app.post('/api/tasks/:id/complete', { preHandler: app.authenticate }, async (request, reply) => {
    const params = notificationParamsSchema.parse(request.params);
    const input = taskCompleteSchema.parse(request.body);
    const userId = currentUserId(request);
    const task = await prisma.task.findUnique({ where: { id: params.id } });
    if (!task) return reply.code(404).send({ error: 'TASK_NOT_FOUND', message: '任务不存在' });
    if (task.userId !== userId && request.user.role !== 'admin') return reply.code(403).send({ error: 'FORBIDDEN', message: '只有发布者可以确认完成' });
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
    if (task.userId !== userId && request.user.role !== 'admin') return reply.code(403).send({ error: 'FORBIDDEN', message: '只有发布者可以取消任务' });
    if (['completed', 'cancelled'].includes(task.status)) return reply.code(409).send({ error: 'TASK_ALREADY_CLOSED', message: '任务已经结束' });
    const claims = await prisma.taskClaim.findMany({ where: { taskId: task.id, status: { in: ['pending', 'assigned', 'submitted'] } } });
    try {
      const result = await prisma.$transaction(async (tx) => {
        if (task.reward > 0 && (task.taskType === 'help' || task.taskType === 'team' || task.taskType === 'reward')) {
          const refund = task.taskType === 'team' ? task.reward * task.maxClaimers : task.reward;
          await applyBuddyPointDelta(tx, task.userId, refund, `task-cancel-refund:${task.id.toString()}`, 'task_reward_refund', `取消任务退回蛋蛋币:${task.id.toString()}`);
        }
        await tx.taskClaim.updateMany({ where: { taskId: task.id, status: { in: ['pending', 'assigned', 'submitted'] } }, data: { status: 'cancelled' } });
        return tx.task.update({ where: { id: task.id }, data: { status: 'cancelled' } });
      });
      return { task: serializeTask(result), cancelledClaims: claims.length };
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
      return reply.code(201).send({ rating: { ...rating, id: rating.id.toString(), taskId: rating.taskId.toString(), fromUserId: rating.fromUserId.toString(), toUserId: rating.toUserId.toString() } });
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') return reply.code(409).send({ error: 'RATING_ALREADY_EXISTS', message: '你已经评价过该任务' });
      throw error;
    }
  });

  app.post('/api/feedback', { preHandler: app.authenticate }, async (request, reply) => {
    const input = feedbackSchema.parse(request.body);
    assertSafeText(input.type, input.content, input.contact, input.source);
    const feedback = await prisma.feedback.create({ data: { userId: currentUserId(request), type: input.type, content: input.content, contact: input.contact ?? null, source: input.source ?? null } });
    const admins = await prisma.user.findMany({ where: { role: 'admin', status: 'active' }, select: { id: true } });
    if (admins.length) await prisma.notification.createMany({ data: admins.map((admin) => ({ userId: admin.id, type: 'feedback_submit', refId: feedback.id.toString(), payload: { feedbackId: feedback.id.toString(), type: input.type } })) });
    return reply.code(201).send({ feedback: serializeFeedback(feedback) });
  });

  app.get('/api/feedback/mine', { preHandler: app.authenticate }, async (request) => {
    const feedback = await prisma.feedback.findMany({ where: { userId: currentUserId(request) }, orderBy: { createdAt: 'desc' }, take: 100 });
    return { feedback: feedback.map(serializeFeedback) };
  });

  app.get('/api/admin/feedback', { preHandler: app.authenticate }, async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const feedback = await prisma.feedback.findMany({ orderBy: { createdAt: 'desc' }, take: 200, include: { user: { select: { id: true, nickname: true } } } });
    return { feedback: feedback.map((item) => ({ ...serializeFeedback(item), user: item.user ? { ...item.user, id: item.user.id.toString() } : null })) };
  });

  app.patch('/api/admin/feedback/:id', { preHandler: app.authenticate }, async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const params = notificationParamsSchema.parse(request.params);
    const input = feedbackAdminSchema.parse(request.body);
    assertSafeText(input.adminRemark);
    const feedback = await prisma.feedback.update({ where: { id: params.id }, data: { ...(input.status ? { status: input.status } : {}), ...(input.adminRemark !== undefined ? { adminRemark: input.adminRemark } : {}) } });
    if (input.adminRemark !== undefined && input.adminRemark !== null) await prisma.notification.create({ data: { userId: feedback.userId, type: 'feedback_reply', refId: feedback.id.toString(), payload: { feedbackId: feedback.id.toString() } } });
    return { feedback: serializeFeedback(feedback) };
  });

  app.get('/api/inquiries', { preHandler: app.authenticate }, async (request) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(request.query);
    const userId = currentUserId(request);
    const [inquiries, likes] = await Promise.all([
      prisma.inquiry.findMany({ orderBy: { createdAt: 'desc' }, take: query.limit, include: { user: { select: { id: true, nickname: true } } } }),
      prisma.inquiryLike.findMany({ where: { userId }, select: { inquiryId: true } }),
    ]);
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
    const inquiry = await prisma.inquiry.findUnique({ where: { id: params.id }, select: { id: true, userId: true } });
    if (!inquiry) return reply.code(404).send({ error: 'INQUIRY_NOT_FOUND', message: '打听不存在' });
    const result = await prisma.$transaction(async (tx) => {
      const replyRow = await tx.inquiryReply.create({ data: { inquiryId: params.id, userId: currentUserId(request), content: input.content, kind: input.kind, parentId: input.parentId ?? null } });
      if (inquiry.userId !== currentUserId(request)) await tx.notification.create({ data: { userId: inquiry.userId, type: 'inquiry_reply', refId: params.id.toString(), payload: { replyId: replyRow.id.toString() } } });
      return replyRow;
    });
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
        const answer = await tx.inquiryReply.findFirst({ where: { id: params.replyId, inquiryId: params.id, kind: 'answer' } });
        if (!answer) throw new Error('INQUIRY_REPLY_NOT_FOUND');
        const point = inquiry.bounty > 0
          ? await applyBuddyPointDelta(tx, answer.userId, inquiry.bounty, `inquiry-adopted:${inquiry.id.toString()}`, 'inquiry_adopted', `采纳打听回答:${inquiry.id.toString()}`)
          : null;
        const updated = await tx.inquiry.update({ where: { id: inquiry.id }, data: { adopted: true, adoptedReplyId: answer.id, coinStatus: 'transferred' } });
        if (answer.userId !== userId) await tx.notification.create({ data: { userId: answer.userId, type: 'inquiry_adopted', refId: inquiry.id.toString(), payload: { bounty: inquiry.bounty, replyId: answer.id.toString() } } });
        return { inquiry: updated, point };
      });
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
      return result;
    } catch (error) {
      const code = error instanceof Error ? error.message : 'INQUIRY_REPLY_LIKE_FAILED';
      return reply.code(code === 'INQUIRY_REPLY_NOT_FOUND' ? 404 : 409).send({ error: code, message: code === 'INQUIRY_REPLY_NOT_FOUND' ? '回答不存在' : '点赞失败，请稍后重试' });
    }
  });

  app.post('/api/admin/inquiries/refund-expired', { preHandler: app.authenticate }, async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
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
    assertSafeText(input.mbtiType, ...input.hobbies, ...input.todayActions, input.province, input.city, input.district);
    const preference = await prisma.buddyPreference.upsert({
      where: { userId: currentUserId(request) },
      create: { userId: currentUserId(request), mbtiType: input.mbtiType ?? null, hobbies: input.hobbies, todayActions: input.todayActions, province: input.province ?? null, city: input.city ?? null, district: input.district ?? null, stealth: input.stealth ?? false },
      update: { mbtiType: input.mbtiType ?? null, hobbies: input.hobbies, todayActions: input.todayActions, province: input.province ?? null, city: input.city ?? null, district: input.district ?? null, ...(input.stealth === undefined ? {} : { stealth: input.stealth }) },
    });
    return { preference: { ...preference, userId: preference.userId.toString() } };
  });

  app.get('/api/buddy-box/recommendations', { preHandler: app.authenticate }, async (request) => {
    const userId = currentUserId(request);
    const { action: requestedAction } = buddyRecommendationQuerySchema.parse(request.query);
    const mine = await prisma.buddyPreference.findUnique({ where: { userId } });
    const users = await prisma.user.findMany({
      where: { id: { not: userId }, status: 'active', OR: [{ buddyPreference: null }, { buddyPreference: { stealth: false } }] },
      select: { id: true, nickname: true, school: true, major: true, city: true, mbtiType: true, eggRarity: true, buddyPreference: true },
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
      if (!previous || rank(relationship.status) > rank(previous.status)) {
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
      return { id: user.id.toString(), name: user.nickname, meta: [user.school, user.major].filter(Boolean).join(' · ') || '蛋蛋校园用户', city: user.city, mbtiType: user.buddyPreference?.mbtiType ?? user.mbtiType, hobbies, todayActions, rarity: user.eggRarity, friendStatus, friendRequestId: relationship?.id.toString() ?? null, score: (sameMbti ? 3 : 0) + overlap + (actionMatch ? 4 : 0) };
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
    assertSafeText(input.text);
    if (input.recipientId === senderId) return reply.code(400).send({ error: 'INVALID_RECIPIENT', message: '不能给自己发送留言' });
    const recipient = await prisma.user.findFirst({ where: { id: input.recipientId, status: 'active' }, select: { id: true } });
    if (!recipient) return reply.code(404).send({ error: 'USER_NOT_FOUND', message: '用户不存在' });
    const friendship = await prisma.buddyFriendRequest.findFirst({ where: { status: 'accepted', OR: [{ requesterId: senderId, recipientId: input.recipientId }, { requesterId: input.recipientId, recipientId: senderId }] } });
    if (!friendship) return reply.code(403).send({ error: 'FRIEND_REQUIRED', message: '接受好友后才能聊天' });
    const message = await prisma.buddyMessage.create({ data: { senderId, recipientId: input.recipientId, text: input.text, source: input.source } });
    return { message: { ...message, id: message.id.toString(), senderId: message.senderId.toString(), recipientId: message.recipientId.toString() } };
  });

  app.get('/api/buddy-box/conversations/:userId/messages', { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ userId: z.coerce.bigint() }).parse(request.params);
    const userId = currentUserId(request);
    const friendship = await prisma.buddyFriendRequest.findFirst({ where: { status: 'accepted', OR: [{ requesterId: userId, recipientId: params.userId }, { requesterId: params.userId, recipientId: userId }] } });
    if (!friendship) return reply.code(403).send({ error: 'FRIEND_REQUIRED', message: '接受好友后才能聊天' });
    const messages = await prisma.buddyMessage.findMany({ where: { OR: [{ senderId: userId, recipientId: params.userId }, { senderId: params.userId, recipientId: userId }] }, orderBy: { createdAt: 'asc' }, take: 100 });
    return { messages: messages.map((message) => ({ ...message, id: message.id.toString(), senderId: message.senderId.toString(), recipientId: message.recipientId.toString() })) };
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
    const updated = await prisma.buddyFriendRequest.updateMany({
      where: { id: params.id, recipientId: currentUserId(request), status: 'pending' },
      data: { status: 'accepted' },
    });
    if (updated.count !== 1) return reply.code(404).send({ error: 'FRIEND_REQUEST_NOT_FOUND', message: '好友申请不存在或已处理' });
    return { ok: true };
  });

  app.post('/api/buddy-box/friend-requests/:id/reject', { preHandler: app.authenticate }, async (request, reply) => {
    const params = buddyIdParamsSchema.parse(request.params);
    const updated = await prisma.buddyFriendRequest.updateMany({
      where: { id: params.id, recipientId: currentUserId(request), status: 'pending' },
      data: { status: 'rejected' },
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
    assertSafeText(input.nickname, input.school, input.major, input.city, input.grade, input.email, input.phone);
    const passwordHash = await hashPassword(input.password);
    const eggCategory = input.eggCategory ?? 'study';
    const registrationChannel = input.phone ? 'sms' : input.email ? 'email' : null;
    const registrationTarget = registrationChannel
      ? normalizeVerificationTarget(registrationChannel, input.phone ?? input.email!)
      : null;

    try {
      const registration = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        let contactVerified = false;
        if (registrationChannel && registrationTarget) {
          if (input.verificationToken) {
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
            contactVerified = true;
          }
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
            verifiedPhoneAt: contactVerified && input.phone ? new Date() : null,
            verifiedEmailAt: contactVerified && input.email ? new Date() : null,
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
            remark: '登录获赠蛋蛋币 +100',
          },
        });
        return { user: created, contactVerified };
      });

      const user = registration.user;
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
    assertSafeText(input.nickname, input.bio, input.school, input.major, input.city, input.grade, input.email, input.phone);
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
    if (error instanceof Error && error.name === 'ContentBlockedError') {
      return reply.code(400).send({ error: 'CONTENT_BLOCKED', message: CONTENT_BLOCKED_MESSAGE });
    }
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: '请求参数不符合要求', details: error.flatten() });
    }
    app.log.error(error);
    return reply.code(500).send({ error: 'INTERNAL_ERROR', message: '服务器内部错误' });
  });

  return app;
}
