import type { Prisma, PrismaClient } from '@prisma/client';

export const BLACKLIST_METRICS = [
  { key: 'canteen', name: '学校食堂', description: '食堂菜品质量、价格、卫生' },
  { key: 'manage', name: '高中化管理', description: '门禁、考勤、请假制度严苛程度' },
  { key: 'internship', name: '不放实习', description: '院系是否阻碍学生外出实习' },
  { key: 'employ', name: '就业质量差', description: '就业率低、对口率低、薪资低' },
  { key: 'watercourse', name: '水课多', description: '课程内容空洞、无实质收获' },
  { key: 'failrate', name: '容易挂科', description: '挂科率偏高、补考重修难' },
  { key: 'outdated', name: '课程落后', description: '教材陈旧、与行业脱节' },
  { key: 'teacher', name: '老师水平低', description: '教学能力差、照本宣科' },
  { key: 'counselor', name: '辅导员鸡毛令箭', description: '辅导员官僚作风、滥用权力' },
  { key: 'life', name: '生活不方便', description: '周边配套差、交通不便' },
  { key: 'baoyan', name: '保研难', description: '保研名额少、竞争激烈' },
  { key: 'fees', name: '机构营销付费多', description: '各类机构收费、强制付费项目' },
  { key: 'dorm', name: '宿舍环境差', description: '老旧、拥挤、无空调/独卫' },
  { key: 'mornings', name: '强制早晚自习', description: '强制早操/晚自习制度' },
  { key: 'forcelabor', name: '强制实习卖苦力', description: '被安排进厂做廉价劳动力' },
  { key: 'headcount', name: '拉人头活动多', description: '各种强制参与讲座/活动凑人数' },
] as const;

export const BLACKLIST_METRIC_KEYS = BLACKLIST_METRICS.map((metric) => metric.key) as [string, ...string[]];
export type BlacklistMetricKey = typeof BLACKLIST_METRICS[number]['key'];

export function normalizeBlacklistSchoolName(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function maskBlacklistNickname(value: string | null | undefined): string {
  const nickname = String(value ?? '').trim();
  const chars = [...nickname];
  if (chars.length <= 1) return chars.length ? '*' : '匿名用户';
  if (chars.length === 2) return `${chars[0]}*`;
  return `${chars[0]}${'*'.repeat(chars.length - 1)}${chars.at(-1)}`;
}

const DISPLAY_PREFIX = '蛋蛋世界的';
export function displayBlacklistSchoolName(value: string): string {
  const name = normalizeBlacklistSchoolName(value);
  return name.startsWith(DISPLAY_PREFIX) ? name : `${DISPLAY_PREFIX}${name}`;
}

export function serializeBlacklistSchool(school: { id: bigint; name: string; createdAt?: Date; updatedAt?: Date }) {
  return { schoolId: school.id.toString(), schoolName: school.name, displayName: displayBlacklistSchoolName(school.name), createdAt: school.createdAt ?? null, updatedAt: school.updatedAt ?? null };
}

export function serializeBlacklistComment(comment: any) {
  return {
    id: comment.id.toString(),
    schoolId: comment.schoolId.toString(),
    nickname: maskBlacklistNickname(comment.user?.nickname),
    content: comment.content,
    averageScore: Number(comment.averageScore ?? 0),
    createdAt: comment.createdAt,
  };
}

export function metricKey(value: string): value is BlacklistMetricKey {
  return (BLACKLIST_METRIC_KEYS as readonly string[]).includes(value);
}

export function averageScores(scores: Record<string, number>): number {
  return Number((BLACKLIST_METRIC_KEYS.reduce((sum, key) => sum + Number(scores[key] ?? 0), 0) / BLACKLIST_METRIC_KEYS.length).toFixed(1));
}

export type BlacklistReadClient = Pick<PrismaClient, 'blacklistSchool' | 'blacklistComment' | 'blacklistScore'>;

export async function rankBlacklistSchools(
  client: BlacklistReadClient,
  metric: BlacklistMetricKey | 'all' = 'all',
  page = 1,
  pageSize = 20,
) {
  const safePage = Math.max(1, Math.floor(page));
  const safeSize = Math.min(50, Math.max(1, Math.floor(pageSize)));
  const schools = await client.blacklistSchool.findMany({ orderBy: { name: 'asc' } });
  const comments = await client.blacklistComment.findMany({ where: { status: 'approved' }, include: { user: { select: { nickname: true } }, scores: true } });
  const bySchool = new Map<string, any[]>();
  for (const comment of comments) bySchool.set(comment.schoolId.toString(), [...(bySchool.get(comment.schoolId.toString()) ?? []), comment]);
  const rows = schools.flatMap((school) => {
    const items = bySchool.get(school.id.toString()) ?? [];
    if (!items.length) return [];
    const values = items.map((comment) => {
      const scores = Object.fromEntries(comment.scores.map((score: any) => [score.metricKey, score.score]));
      return metric === 'all' ? averageScores(scores) : Number(scores[metric] ?? 0);
    });
    const score = Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1));
    return [{ ...serializeBlacklistSchool(school), score, avgScore: score, commentCount: items.length, count: items.length }];
  }).sort((a, b) => b.score - a.score || b.commentCount - a.commentCount || a.schoolName.localeCompare(b.schoolName, 'zh-CN'));
  const start = (safePage - 1) * safeSize;
  const pageRows = rows.slice(start, start + safeSize).map((row, index) => ({ ...row, rank: start + index + 1 }));
  return { rows: pageRows, list: pageRows, total: rows.length, page: safePage, pageSize: safeSize };
}

export type BlacklistWriteClient = Prisma.TransactionClient;
