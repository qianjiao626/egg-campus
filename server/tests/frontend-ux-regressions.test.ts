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

  it('keeps gossip points and task type guidance readable in the light theme', () => {
    const lightTheme = html.slice(html.indexOf('Light neutral theme'));
    expect(lightTheme).toContain('.banner-text .tag,.banner-text .tag b{color:#212529!important');
    expect(lightTheme).toContain('.page [style*="color:var(--muted)"]{color:#6C757D!important');
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

  it('loads echarts on demand instead of blocking the document head', () => {
    const head = html.slice(0, html.indexOf('</head>'));
    expect(head).not.toContain('echarts.min.js');
    expect(html).toContain('function ensureEcharts()');
    expect(html).toContain("var ECHARTS_SRC = 'https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js'");
    expect(html).toContain('ensureEcharts().then(function(){ loadDashboardStats(force, customRange); }');
  });
});
