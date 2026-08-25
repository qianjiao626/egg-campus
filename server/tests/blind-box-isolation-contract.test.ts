import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const packageRoot = resolve(process.cwd(), '..', 'backend-handoff-package');
const html = readFileSync(resolve(packageRoot, 'blind-box', 'index.html'), 'utf8');
const client = readFileSync(resolve(packageRoot, 'blind-box', 'app.js'), 'utf8');
const api = readFileSync(resolve(packageRoot, 'blind-box', 'buddy-box-api.js'), 'utf8');
const host = readFileSync(resolve(packageRoot, 'growth-school.html'), 'utf8');

describe('blind-box page isolation contract', () => {
  it('contains no plugin navigation or hash routing', () => {
    expect(html).not.toContain('href="#"');
    expect(html).not.toContain('<a ');
  });

  it('does not install handlers for the host application navigation', () => {
    expect(client).not.toContain("querySelectorAll('.nav-item')");
    expect(client).not.toContain('window.location.hash');
    expect(api).toContain("credentials: 'include'");
  });

  it('is a content-only component for both host and direct requests', () => {
    expect(host).toContain('data-page="buddybox"');
    expect(host).toContain('id="page-buddybox"');
    expect(host).toContain('src="blind-box/"');
    expect(html).not.toContain('embed');
    expect(html).not.toContain('class="sidebar"');
    expect(html).not.toContain('class="topbar"');
    expect(html).not.toContain('<footer');
    expect(html).not.toContain('app-shell');
    expect(html).toContain('class="buddy-content"');
    expect(client).toContain("dandan-buddy-height");
  });

  it('passes the revealed today action into recommendation matching', () => {
    expect(api).toContain('getRecommendations: function (action)');
    expect(client).toContain('getRecommendations(action)');
    expect(client).toContain('syncBuddyProfiles(selectedTodayAction)');
  });

  it('keeps inbox and accepted conversations fresh with bounded HTTP polling', () => {
    expect(client).toContain('inboxPollTimer');
    expect(client).toContain('conversationPollTimer');
    expect(client).toContain('window.setInterval(syncBuddyInbox');
    expect(client).toContain('window.setInterval(refreshConversation');
  });

  it('refreshes recommendation relationship state after accepting a friend', () => {
    expect(client).toContain('item.accepted = true; item.unread = false; renderInbox(); await syncBuddyProfiles');
  });
});
