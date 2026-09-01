import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const categories = ['study', 'job', 'side', 'hobby', 'game', 'life'];
const categoryByTask = { teach: 'study', help: 'job', team: 'side', reward: 'hobby' };
const claimerStatByTask = { teach: 'knowledge', help: 'skills', team: 'charm', reward: 'money' };
const publisherStatByTask = { teach: 'knowledge', help: 'money', team: 'charm', reward: 'money' };

const emptyGrowth = () => ({ knowledge: 0, skills: 0, charm: 0, money: 0, completedTasks: 0, publishedTasks: 0, reputation: 0, characters: Object.fromEntries(categories.map((category) => [category, 0])) });

async function main() {
  const [users, tasks, ratings] = await Promise.all([
    prisma.user.findMany({ select: { id: true, eggCategory: true } }),
    prisma.task.findMany({ select: { id: true, userId: true, taskType: true, claims: { where: { status: 'completed' }, select: { claimerId: true } } } }),
    prisma.rating.findMany({ select: { toUserId: true, score: true } }),
  ]);
  const growth = new Map(users.map((user) => [user.id.toString(), emptyGrowth()]));
  for (const task of tasks) {
    const publisher = growth.get(task.userId.toString());
    if (publisher) publisher.publishedTasks += 1;
    const category = categoryByTask[task.taskType];
    const publisherStat = publisherStatByTask[task.taskType];
    for (const claim of task.claims) {
      const claimer = growth.get(claim.claimerId.toString());
      if (!claimer) continue;
      claimer.completedTasks += 1;
      if (claimerStatByTask[task.taskType]) claimer[claimerStatByTask[task.taskType]] += 1;
      if (category) claimer.characters[category] += 1;
      if (publisher) {
        if (publisherStat) publisher[publisherStat] += 1;
        if (category) publisher.characters[category] += 1;
      }
    }
  }
  for (const rating of ratings) {
    const target = growth.get(rating.toUserId.toString());
    if (target) {
      target.reputation += rating.score;
      target.__ratingCount = (target.__ratingCount || 0) + 1;
    }
  }
  for (const target of growth.values()) target.reputation = target.__ratingCount ? target.reputation / target.__ratingCount : 0;

  const characterCount = [...growth.values()].reduce((sum, item) => sum + Object.values(item.characters).filter((count) => count > 0).length, 0);
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', users: users.length, tasks: tasks.length, completedClaims: tasks.reduce((sum, task) => sum + task.claims.length, 0), ratings: ratings.length, characterRows: users.length * categories.length, unlockedCategories: characterCount }, null, 2));
  if (!apply) return;

  for (const user of users) {
    const item = growth.get(user.id.toString());
    if (!item) continue;
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { reputation: item.reputation } });
      await tx.userStats.upsert({
        where: { userId: user.id },
        create: { userId: user.id, knowledge: item.knowledge, skills: item.skills, charm: item.charm, money: item.money, reputation: item.reputation, completedTasks: item.completedTasks, publishedTasks: item.publishedTasks },
        update: { knowledge: item.knowledge, skills: item.skills, charm: item.charm, money: item.money, reputation: item.reputation, completedTasks: item.completedTasks, publishedTasks: item.publishedTasks },
      });
      const existing = await tx.userCharacter.findMany({ where: { userId: user.id } });
      const current = existing.find((character) => character.isCurrent);
      const preferred = current?.category || (user.eggCategory && categories.includes(user.eggCategory) ? user.eggCategory : 'study');
      for (const category of categories) {
        const prior = existing.find((character) => character.category === category);
        const count = item.characters[category] || 0;
        const unlocked = Boolean(prior?.unlocked || count > 0);
        const unlockedAt = prior?.unlockedAt || (unlocked ? new Date() : null);
        const isCurrent = current ? Boolean(prior?.isCurrent) : category === preferred;
        await tx.userCharacter.upsert({
          where: { userId_category: { userId: user.id, category } },
          create: { userId: user.id, category, count, unlocked, unlockedAt, isCurrent },
          update: { count, unlocked, unlockedAt, isCurrent },
        });
      }
    });
  }
  console.log(JSON.stringify({ appliedUsers: users.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
