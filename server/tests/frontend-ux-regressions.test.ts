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

  it('escapes leaderboard names and inline attribute values in both HTML variants', () => {
    for (const page of [html, rollbackHtml]) {
      expect(page).toContain('escapeHtml(u.name)');
      expect(page).toContain('escapeHtml(user.name)');
      expect(page).toContain("replace(/&/g,'&amp;')");
      expect(page).toContain("replace(/\"/g,'&quot;')");
      expect(page).not.toMatch(/\b(?:taskName|name|publisher|s\.name|c\.name)\.replace\(\/'\/g/);
    }
  });
});
