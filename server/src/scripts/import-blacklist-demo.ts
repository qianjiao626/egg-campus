import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { BLACKLIST_METRIC_KEYS, normalizeBlacklistSchoolName } from '../blacklist.js';

type DemoRow = { school: string; scores: number[]; comment: string; user: string; time: string };

const prisma = new PrismaClient();
const sourceCandidates = [
  new URL('../../prisma/seed/blacklist-demo.json', import.meta.url),
  new URL('../../../prisma/seed/blacklist-demo.json', import.meta.url),
];
let rows: DemoRow[] | undefined;
for (const source of sourceCandidates) {
  try {
    rows = JSON.parse(await readFile(source, 'utf8')) as DemoRow[];
    break;
  } catch {
    // The compiled script and source script resolve the seed from different roots.
  }
}
if (!rows) throw new Error('Missing blacklist demo seed');
if (!Array.isArray(rows) || rows.length !== 16) throw new Error('Invalid blacklist demo seed');

const seededUsers = new Map<string, bigint>();
let inserted = 0;
let skipped = 0;

try {
  for (const [index, row] of rows.entries()) {
    if (row.scores.length !== BLACKLIST_METRIC_KEYS.length || row.scores.some((score) => !Number.isInteger(score) || score < 0 || score > 10)) {
      throw new Error(`Invalid scores at demo row ${index + 1}`);
    }
    const schoolName = normalizeBlacklistSchoolName(row.school);
    const school = await prisma.blacklistSchool.findUnique({ where: { name: schoolName } });
    if (!school) throw new Error(`Missing seeded school: ${row.school}`);

    let userId = seededUsers.get(row.user);
    if (!userId) {
      const email = `blacklist-demo-${index + 1}@demo.invalid`;
      const existing = await prisma.user.findUnique({ where: { nickname: row.user } });
      if (existing && existing.email !== email) throw new Error(`Nickname already belongs to another user: ${row.user}`);
      const user = existing ?? await prisma.user.create({ data: {
        nickname: row.user,
        email,
        passwordHash: '!demo-disabled!',
        role: 'student',
        status: 'suspended',
      } });
      userId = user.id;
      seededUsers.set(row.user, userId);
    }

    const existingComment = await prisma.blacklistComment.findUnique({ where: { userId_schoolId: { userId, schoolId: school.id } }, include: { scores: true } });
    if (existingComment) {
      skipped++;
      continue;
    }
    const averageScore = Number((row.scores.reduce((sum, score) => sum + score, 0) / row.scores.length).toFixed(1));
    const created = await prisma.blacklistComment.create({
      data: {
        userId,
        schoolId: school.id,
        content: row.comment,
        averageScore,
        status: 'approved',
        createdAt: new Date(row.time),
        scores: { create: BLACKLIST_METRIC_KEYS.map((metricKey, scoreIndex) => ({ metricKey, score: row.scores[scoreIndex] })) },
      },
    });
    await prisma.auditLog.create({
      data: {
        action: 'blacklist.demo_import',
        targetType: 'school_comment',
        targetId: created.id.toString(),
        afterData: { source: 'attachment-demo', school: row.school, nickname: row.user },
      },
    });
    inserted++;
  }
  console.log(`Imported ${inserted} blacklist demo comments; skipped ${skipped} existing comments; ensured ${seededUsers.size} suspended demo users`);
} finally {
  await prisma.$disconnect();
}
