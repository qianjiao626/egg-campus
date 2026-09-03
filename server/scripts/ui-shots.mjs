import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const htmlUrl = pathToFileURL(path.join(repoRoot, 'backend-handoff-package', 'growth-school.html')).href;
const outDir = path.resolve(repoRoot, process.argv[2] || path.join('output', 'ui-v2', new Date().toISOString().replace(/[:.]/g, '-')));
const errors = [];

const publisher = { id: '101', nickname: '示例发布者', eggCategory: '学业技术', eggRarity: 'R', isAdministrator: false };
const baseTask = (overrides = {}) => ({
  id: 'task-1', userId: '101', title: 'Python 基础练习', description: '完成 Python 入门练习并提交学习成果。', taskType: 'teach', status: 'approved',
  skillCategory: '学业技术', skillSubcategory: '软件技术', reward: 120, publishExpReward: 60, claimMode: 'single', maxClaimers: 1,
  activeClaimCount: 0, createdAt: '2026-09-03T08:00:00.000Z', deadline: '2026-10-03T08:00:00.000Z', publisher, ...overrides,
});

const plazaFixtures = [
  ['plazaUserList', baseTask({ id: 'plaza-teach', title: 'Python 基础练习', taskType: 'teach', claimStatus: '' })],
  ['rewardUserList', baseTask({ id: 'plaza-reward', title: '需求文档撰写', taskType: 'reward', reward: 180, claimMode: 'multiple', maxClaimers: 3, activeClaimCount: 1, claimStatus: 'active' })],
];
const fixtures = {
  plaza: plazaFixtures,
  helpplaza: [['helpUserList', baseTask({ id: 'help-single', title: '求助：简历优化', taskType: 'help', claimMode: 'single' })], ['helpUserList', baseTask({ id: 'help-multiple', title: '求助：四六级备考', taskType: 'help', claimMode: 'multiple', maxClaimers: 3 })]],
  teamplaza: [['teamUserList', baseTask({ id: 'team-1', title: '组队备考小队', taskType: 'team', claimMode: 'multiple', maxClaimers: 4, activeClaimCount: 1 })], ['teamUserList', baseTask({ id: 'team-2', title: '健身打卡搭子', taskType: 'team', claimMode: 'multiple', maxClaimers: 3, activeClaimCount: 2 })]],
  mytasks: {
    published: [baseTask({ id: 'mine-published-1', title: '教你做高数期中复习笔记', reviewReason: '', status: 'approved' }), baseTask({ id: 'mine-published-2', title: 'PS 海报设计', reviewReason: '请补充任务要求', status: 'pending_review' })],
    claimed: [{ id: 'claim-1', status: 'assigned', task: baseTask({ id: 'mine-claimed-1', title: '英语四六级备考', taskType: 'teach' }) }, { id: 'claim-2', status: 'submitted', task: baseTask({ id: 'mine-claimed-2', title: '组队健身打卡', taskType: 'team', claimMode: 'multiple', maxClaimers: 4, status: 'approved' }) }],
  },
};

async function injectPage(pageId, page) {
  await page.evaluate(({ pageId, fixtures }) => {
    const nav = document.getElementById('studentNav');
    if (nav) nav.style.display = '';
    if (pageId === 'plaza' || pageId === 'helpplaza' || pageId === 'teamplaza') {
      const entries = fixtures[pageId];
      const cleared = new Set();
      entries.forEach(([id, task]) => {
        const list = document.getElementById(id);
        if (!list || typeof window.renderServerPlazaTask !== 'function') return;
        if (!cleared.has(id)) { list.innerHTML = ''; cleared.add(id); }
        list.appendChild(window.renderServerPlazaTask(task));
      });
    }
    if (pageId === 'mytasks') {
      const data = fixtures.mytasks;
      const published = document.getElementById('myPublishedListTeach');
      const claimed = document.getElementById('myClaimedListTeach');
      if (published && typeof window.renderSyncedPublishedTask === 'function') {
        published.innerHTML = '';
        data.published.forEach((task) => window.renderSyncedPublishedTask(task));
      }
      if (claimed && typeof window.renderSyncedClaimedTask === 'function') {
        claimed.innerHTML = '';
        data.claimed.forEach((claim) => window.renderSyncedClaimedTask(claim));
      }
    }
    if (typeof window.showPage === 'function') window.showPage(pageId);
  }, { pageId, fixtures });
}

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
for (const pageId of ['plaza', 'helpplaza', 'teamplaza', 'gossip', 'mytasks', 'dashboard']) {
  for (const [suffix, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport });
    page.on('pageerror', (error) => errors.push(`${pageId}-${suffix}: ${error.message}`));
    await page.goto(htmlUrl, { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    await injectPage(pageId, page);
    await page.screenshot({ path: path.join(outDir, `${pageId}-${suffix}.png`), fullPage: true });
    await page.close();
  }
}
await browser.close();
console.log(`screenshots=${6 * 2} outDir=${outDir} errors=${errors.length}`);
if (errors.length) {
  errors.forEach((error) => console.error(error));
  process.exitCode = 1;
}
