import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const packageRoot = resolve(process.cwd(), '..', 'backend-handoff-package');
const html = readFileSync(resolve(packageRoot, 'growth-school.html'), 'utf8');
const apiClient = readFileSync(resolve(packageRoot, 'api-client.js'), 'utf8');
const blindBox = readFileSync(resolve(packageRoot, 'blind-box', 'app.js'), 'utf8');

describe('realtime page lifecycle contract', () => {
  it('connects only with the in-memory token and disconnects on logout', () => {
    expect(apiClient).toContain('getAccessToken: function');
    expect(apiClient).toContain("new CustomEvent('dandan:access-token'");
    expect(html).toContain('<script src="realtime-client.js');
    expect(html).toContain('DandanRealtime.connect(window.apiClient.getAccessToken())');
    expect(html).toContain('DandanRealtime.disconnect()');
    expect(apiClient).not.toMatch(/localStorage|sessionStorage/);
  });

  it('replaces page subscriptions and reloads data through existing REST loaders', () => {
    expect(html).toContain('function bindRealtimeForPage(pageId)');
    expect(html).toContain('activeRealtimeUnsubscribe()');
    expect(html).toContain('DandanRealtime.subscribe');
    expect(html).toContain('syncPublicTaskPlazas()');
    expect(html).toContain('syncGossipInquiries(true)');
    expect(html).toContain('syncRanking(');
    expect(html).toContain("'dandan:realtime-fallback'");
  });

  it('forwards buddy events to the content-only iframe for REST reloading', () => {
    expect(html).toContain("type: 'dandan-realtime'");
    expect(blindBox).toContain("event.data.type !== 'dandan-realtime'");
    expect(blindBox).toContain('syncBuddyInbox()');
    expect(blindBox).toContain('syncBuddyFeatureState()');
  });
});
