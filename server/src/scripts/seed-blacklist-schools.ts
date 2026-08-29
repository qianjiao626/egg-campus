import { readFile } from 'node:fs/promises';
import { prisma } from '../prisma.js';
import { normalizeBlacklistSchoolName } from '../blacklist.js';

const source = new URL('../../prisma/seed/blacklist-schools.json', import.meta.url);
const schools = JSON.parse(await readFile(source, 'utf8')) as unknown;
if (!Array.isArray(schools) || schools.some((name) => typeof name !== 'string')) throw new Error('Invalid blacklist school seed');

const names = [...new Set(schools.map((name) => normalizeBlacklistSchoolName(name as string)).filter(Boolean))];
for (const name of names) await prisma.blacklistSchool.upsert({ where: { name }, create: { name, status: 'approved', isUserAdded: false }, update: {} });
console.log(`Seeded ${names.length} blacklist schools`);
await prisma.$disconnect();
