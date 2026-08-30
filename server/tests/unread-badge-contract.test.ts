import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

type BadgeElement = { hidden: boolean; textContent: string };
type IdentityView = {
  renderUnreadBadge(element: BadgeElement | null, value: unknown, options?: { showZero?: boolean } | boolean): number;
};

function loadIdentityView(): IdentityView {
  const scriptPath = resolve(process.cwd(), '..', 'backend-handoff-package', 'identity-view.js');
  if (!existsSync(scriptPath)) throw new Error('identity-view.js is missing');
  const windowObject: { DandanIdentityView?: IdentityView } = {};
  runInContext(readFileSync(scriptPath, 'utf8'), createContext({ window: windowObject }), { filename: scriptPath });
  if (!windowObject.DandanIdentityView) throw new Error('DandanIdentityView was not exported');
  return windowObject.DandanIdentityView;
}

describe('unread badge contract', () => {
  it.each([
    ['zero', 0, true, ''],
    ['empty', null, true, ''],
    ['negative', -2, true, ''],
    ['invalid', 'oops', true, ''],
    ['positive', 7, false, '7'],
    ['decimal string', '3.9', false, '3'],
  ])('renders %s count without removing its entry container', (_label, value, hidden, text) => {
    const view = loadIdentityView();
    const badge = { hidden: false, textContent: 'stale' };

    const count = view.renderUnreadBadge(badge, value);

    expect(count).toBe(text ? Number(text) : 0);
    expect(badge).toEqual({ hidden, textContent: text });
  });

  it('keeps configured persistent badges visible at zero', () => {
    const view = loadIdentityView();
    const badge = { hidden: true, textContent: 'stale' };

    const count = view.renderUnreadBadge(badge, 0, { showZero: true });

    expect(count).toBe(0);
    expect(badge).toEqual({ hidden: false, textContent: '0' });
  });

  it('ships all static unread badges as empty hidden badges', () => {
    const html = readFileSync(resolve(process.cwd(), '..', 'backend-handoff-package', 'growth-school.html'), 'utf8');
    for (const id of ['notifBadge', 'notifBadgeStudent', 'submissionsBadge', 'pendingBadge', 'usersCount', 'feedbackBadge']) {
      expect(html).toMatch(new RegExp(`<span[^>]*id="${id}"[^>]*hidden[^>]*><\\/span>`));
    }
    expect(html).toContain('.tag[hidden],.bell-badge[hidden]{display:none!important}');
    expect(html).not.toMatch(/id="(?:pendingBadge|usersCount|feedbackBadge)"[^>]*>0<\/span>/);
    expect(html).toContain('renderUnreadBadge(revBadge, pending.length)');
    expect(html).toContain('renderUnreadBadge(usersBadge, adminWorkspace.users.length)');
    expect(html).toContain('renderUnreadBadge(badge, pending)');
    expect(html).toContain('class="bell-btn"');
    expect(html).toContain('data-page="reviewcenter"');
    expect(html).toContain('data-page="submissions"');
    expect(html).toContain('data-page="feedback"');
  });
});
