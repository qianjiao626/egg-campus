import { PrismaClient } from '@prisma/client';

const expectedDatabase = 'dandan_campus_test';
const expectedAdmin = 'isolated-e2e-admin';
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('MISSING_DATABASE_URL');
let databaseName;
try { databaseName = new URL(databaseUrl).pathname.replace(/^\//, ''); }
catch { throw new Error('INVALID_DATABASE_URL'); }
if (databaseName !== expectedDatabase) throw new Error('ISOLATED_TEST_DATABASE_REQUIRED');

const prisma = new PrismaClient();
try {
  const users = await prisma.user.findMany({
    select: { id: true, nickname: true, protectedAdminKey: true },
  });
  const admins = users.filter((user) => user.nickname === expectedAdmin && user.protectedAdminKey === expectedAdmin);
  if (admins.length !== 1 || users.filter((user) => user.nickname === expectedAdmin).length !== 1) {
    throw new Error('ISOLATED_E2E_ADMIN_REQUIRED');
  }
  const removableIds = users
    .filter((user) => user.nickname !== expectedAdmin && user.protectedAdminKey === null)
    .map((user) => user.id);
  if (removableIds.length === 0) {
    console.log('ISOLATED_E2E_CLEANUP=0');
  } else {
    const result = await prisma.$transaction(async (tx) => {
      const attachments = await tx.feedbackAttachment.deleteMany({ where: { uploaderId: { in: removableIds } } });
      const transactions = await tx.pointTransaction.deleteMany({ where: { userId: { in: removableIds } } });
      const deleted = await tx.user.deleteMany({ where: { id: { in: removableIds } } });
      return { attachments: attachments.count, transactions: transactions.count, users: deleted.count };
    });
    console.log(`ISOLATED_E2E_CLEANUP=${result.users} users, ${result.transactions} point transactions, ${result.attachments} attachments`);
  }
} finally {
  await prisma.$disconnect();
}
