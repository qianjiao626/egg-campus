import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), '..');
const html = readFileSync(resolve(root, 'backend-handoff-package', 'growth-school.html'), 'utf8');
const rollbackHtml = readFileSync(resolve(root, 'backend-handoff-package', 'growth-school.rollback-real-data.html'), 'utf8');
const blacklist = readFileSync(resolve(root, 'backend-handoff-package', 'blacklist.js'), 'utf8');
const buddy = readFileSync(resolve(root, 'backend-handoff-package', 'blind-box', 'styles.css'), 'utf8');
const buddyApp = readFileSync(resolve(root, 'backend-handoff-package', 'blind-box', 'app.js'), 'utf8');
const server = readFileSync(resolve(process.cwd(), 'src', 'app.ts'), 'utf8');

describe('frontend UX regressions', () => {
  it('limits university detail navigation to an explicit detail button', () => {
    expect(blacklist).toContain('data-blacklist-detail');
    expect(blacklist).toContain("event.target.closest('[data-blacklist-detail]')");
    expect(blacklist).not.toContain("root('blRankList').addEventListener('click'");
  });

  it('shows blacklist modals instead of leaving an invisible click-blocking overlay', () => {
    expect(blacklist).toContain('modal.classList.add(\'show\')');
    expect(blacklist).toContain('hideModal(root(\'blSchoolDetailModal\'))');
    expect(blacklist).toContain('hideModal(root(\'tousuFormModal\'))');
  });

  it('keeps selected school visible when choosing a search suggestion', () => {
    expect(blacklist).toContain("pageInput.value = name");
    expect(blacklist).toContain('openSchool(button.getAttribute(\'data-school-id\'))');
  });

  it('lets the buddy iframe report its full content height on mobile', () => {
    expect(html).toContain('class="buddybox-frame" id="buddyboxFrame"');
    expect(html).not.toContain('.buddybox-frame{height:auto!important');
    expect(buddyApp).toContain('dandan-buddy-height');
    expect(html).toContain('.buddybox-frame{display:block;flex:0 0 auto;');
  });

  it('renders colorful task cards with publisher avatar and motion', () => {
    expect(html).toContain('task-card-avatar');
    expect(html).toContain('data-task-type');
    expect(html).toContain('.plaza-card[data-task-type="help"]');
    expect(html).toContain('@keyframes plazaCardIn');
  });

  it('visually separates rewarded tasks from standard tasks', () => {
    expect(html).toContain("type === 'reward' ? 'task-card-rewarded' : 'task-card-standard'");
    expect(html).toContain('task-card-prize-ribbon');
    expect(html).toContain('.plaza-card.task-card-standard');
    expect(html).toContain('.plaza-card.task-card-rewarded');
  });

  it('uses focused extreme-school cards and removes the inquiry card outline', () => {
    expect(html).toContain('.bl-extreme-card{');
    expect(html).toContain('.bl-extreme-card{border:0!important');
    expect(html).toContain('.gossip-card{border:0!important');
  });

  it('describes cancellation refund as returning to the original payer', () => {
    expect(html).toContain('蛋蛋币将退回发布者账户余额');
    expect(server).toContain('applyBuddyPointDelta(tx, task.userId, refund');
    expect(server).toContain('applyBuddyPointDelta(tx, claim.claimerId, claim.frozenAmount');
    expect(server).not.toContain('applyBuddyPointDelta(tx, currentUserId(request), refund');
  });

  it('reveals the shell before slow profile hydration completes', () => {
    const restore = html.match(/window\.addEventListener\('dandan:session-restored',[\s\S]*?\n  \}\);/);
    expect(restore?.[0]).toContain('revealStage();');
    expect(restore?.[0]).not.toMatch(/await hydrateUserState\(\);[\s\S]*revealStage\(\);/);
  });

  it('keeps task hub tabs readable and refreshes stats after task completion', () => {
    const lightTheme = html.slice(html.indexOf('Light neutral theme'));
    expect(lightTheme).toContain('.task-hub-tab{background:#FFFFFF!important;color:#6C757D!important');
    expect(lightTheme).toContain('.task-hub-tab.active{background:#165DFF!important;background-clip:border-box!important');
    expect(lightTheme).toContain('background-clip:border-box!important');
    expect(lightTheme).toContain('-webkit-text-fill-color:#FFFFFF!important');
    expect(html).toContain("if(type === 'task.completed' && typeof hydrateUserState === 'function')");
    expect(html).toContain('await hydrateUserState();\n      refreshProfile();');
  });

  it('distinguishes my-task cards by lifecycle status with border colors', () => {
    const lightTheme = html.slice(html.indexOf('Light neutral theme'));
    expect(lightTheme).toContain('.card[data-paired="true"]');
    expect(lightTheme).toContain('border-left-color:#2563EB!important');
    expect(lightTheme).toContain('.card.is-completed');
    expect(lightTheme).toContain('border-left-color:#16A34A!important');
    expect(lightTheme).toContain('.card.is-cancelled');
    expect(lightTheme).toContain('border-left-color:#9CA3AF!important');
  });

  it('renders profile stats even when no current character is selected', () => {
    const renderChar = html.match(/function renderChar\(\)\{[\s\S]*?\n  \}\n\n  function renderCharUnlocked/);
    expect(renderChar?.[0]).toContain('renderStatChips(USER.stats || {});');
    expect(renderChar?.[0]).toContain('renderProfileRuleScores(USER.stats || {});');
    expect(renderChar?.[0]).toMatch(/renderProfileRuleScores\(USER\.stats \|\| \{\}\);[\s\S]*?if\(!char\)/);
  });

  it('cinematic theme keeps semantic status colors distinct', () => {
    const themeBlock = html.slice(html.indexOf('Cinematic glass theme'));
    expect(themeBlock).not.toMatch(/--red:\s*#fff/);
    expect(themeBlock).not.toMatch(/--green:\s*#fff/);
  });

  it('escapes leaderboard names and inline attribute values in both HTML variants', () => {
    for (const page of [html, rollbackHtml]) {
      expect(page).toContain('escapeHtml(u.name)');
      expect(page).toContain('escapeHtml(user.name)');
      expect(page).toContain("replace(/&/g,'&amp;')");
      expect(page).toContain("replace(/\"/g,'&quot;')");
      expect(page).not.toMatch(/\b(?:taskName|name|publisher|s\.name|c\.name)\.replace\(\/'\/g/);
    }
  });

  it('keeps the leaderboard visible while an empty category request is pending', () => {
    const sync = html.match(/function syncRanking\(cat\)\{[\s\S]*?\n  \}\n  function getMBTIColor/);
    expect(sync?.[0]).toContain("class=\"rank-empty rank-loading\"");
    expect(html).toContain('😣 这个方向还没有蛋蛋上榜，快来成为第一个！');
  });

  it('opens claim management from the redesigned task card title', () => {
    const manager = html.match(/async function openClaimerManager\(btn\)\{[\s\S]*?\n  \}\n\n  function renderClaimerList/);
    expect(manager?.[0]).toContain("card.querySelector('.mt-title')");
    expect(manager?.[0]).toContain("card.getAttribute('data-task-title')");
  });

  it('uses separate publisher and claimer task detail views', () => {
    const detail = html.match(/async function openSyncedTaskDetail\(button, role\)\{[\s\S]*?\n  \}\n  function ensureMyTaskEmptyState/);
    expect(detail?.[0]).toContain("if(role === 'publisher')");
    expect(detail?.[0]).toContain("if(role === 'claimer')");
    expect(detail?.[0]).toContain('认领者列表');
    expect(detail?.[0]).toContain("role === 'publisher' ? document.getElementById('publishedTaskDetailCard')");
  });
});
