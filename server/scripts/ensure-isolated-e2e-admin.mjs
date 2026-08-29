import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../dist/src/auth/password.js';
import { seedAuthorizationCatalog } from '../dist/src/rbac-seed.js';
import { validateIsolatedE2EBootstrapInput } from '../dist/src/isolated-e2e-guard.js';

const ADMIN_KEY = 'isolated-e2e-admin';
const categories = ['study', 'job', 'side', 'hobby', 'game', 'life'];
let stdinPayload = '';
for await (const chunk of process.stdin) stdinPayload += chunk;
const input = JSON.parse(stdinPayload);
validateIsolatedE2EBootstrapInput({
  databaseUrl: process.env.DATABASE_URL ?? '',
  identifier: input.identifier,
  password: input.password,
});

const prisma = new PrismaClient();
try {
  const passwordHash = await hashPassword(input.password);
  const existingByName = await prisma.user.findUnique({ where: { nickname: input.identifier }, select: { id: true, protectedAdminKey: true } });
  const existingByKey = await prisma.user.findUnique({ where: { protectedAdminKey: ADMIN_KEY }, select: { id: true, nickname: true } });
  if (existingByName && existingByKey && existingByName.id !== existingByKey.id) throw new Error('ISOLATED_ADMIN_IDENTITY_CONFLICT');
  const existing = existingByKey ?? existingByName;
  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: { nickname: input.identifier, passwordHash, protectedAdminKey: ADMIN_KEY, role: 'admin', status: 'active', mustChangePassword: false },
        select: { id: true },
      })
    : await prisma.user.create({
        data: {
          nickname: input.identifier,
          passwordHash,
          protectedAdminKey: ADMIN_KEY,
          role: 'admin',
          status: 'active',
          inviteCode: `E2E${randomBytes(7).toString('hex').toUpperCase()}`.slice(0, 20),
          stats: { create: {} },
          account: { create: {} },
          characters: { create: categories.map((category) => ({ category, unlocked: category === 'study', isCurrent: category === 'study', unlockedAt: category === 'study' ? new Date() : null })) },
        },
        select: { id: true },
      });
  await prisma.authSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await seedAuthorizationCatalog(prisma);
  process.stdout.write('ISOLATED_ADMIN_READY\n');
} finally {
  await prisma.$disconnect();
}
