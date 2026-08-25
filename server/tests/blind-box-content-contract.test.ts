import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const packageRoot = resolve(process.cwd(), '..', 'backend-handoff-package');
const component = readFileSync(resolve(packageRoot, 'blind-box', 'index.html'), 'utf8');
const componentCss = readFileSync(resolve(packageRoot, 'blind-box', 'styles.css'), 'utf8');
const componentApp = readFileSync(resolve(packageRoot, 'blind-box', 'app.js'), 'utf8');
const componentApi = readFileSync(resolve(packageRoot, 'blind-box', 'buddy-box-api.js'), 'utf8');
const hostApi = readFileSync(resolve(packageRoot, 'api-client.js'), 'utf8');
const host = readFileSync(resolve(packageRoot, 'growth-school.html'), 'utf8');

describe('blind-box content-only contract', () => {
  it('contains only the business component and no plugin shell markup', () => {
    expect(component).toContain('data-buddy-component="content-only"');
    expect(component).not.toMatch(/<aside[^>]+class="[^\"]*sidebar/i);
    expect(component).not.toMatch(/class="[^\"]*(?:topbar|page-title|app-shell)/i);
    expect(component).not.toMatch(/<footer\b/i);
    expect(component).not.toMatch(/(?:embed|standalone)/i);
  });

  it('keeps the core blind-box interaction anchors and adapters', () => {
    for (const id of ['openBox', 'matchGrid', 'featureGroups', 'messageForm', 'drawOverlay', 'messageDrawer']) {
      expect(component).toContain(`id="${id}"`);
    }
    expect(component).toContain('buddy-box-api.js');
    expect(component).toContain('app.js');
  });

  it('uses the complete sensitive filter and keeps friend actions server-backed', () => {
    expect(component).toContain('sensitive-filter.js');
    expect(componentApp).toContain('DandanSensitiveFilter.containsBlockedTerm');
    expect(componentApp).toContain('data-inbox-action="reject"');
    expect(componentApi).toContain("/friend-requests/' + encodeURIComponent(id) + '/reject");
  });

  it('keeps my inquiries private and reachable as a student page', () => {
    expect(host).toContain('data-page="myinquiries"');
    expect(host).toContain('id="page-myinquiries"');
    expect(host).toContain("'myinquiries'");
    expect(hostApi).toContain("'/api/inquiries/mine'");
  });

  it('escapes notification text and waits for inquiry hydration before opening', () => {
    expect(host).toContain("escapeHtml(n.text || '')");
    expect(host).toContain("item.type === 'inquiry_adopted'");
    expect(host).toContain('Promise.resolve(go(\'gossip\')).then');
    expect(host).not.toContain('setTimeout(function(){ openNotificationDetail(item); }, 120)');
  });

  it('preserves DEMO published task records during real task sync', () => {
    expect(host).toContain('data-demo="true"');
    expect(host).toContain("getAttribute('data-demo') !== 'true'");
  });

  it('persists blind-box school and waits for region data before restoring', () => {
    expect(componentApp).toContain("api.updateProfile({school:");
    expect(componentApi).toContain("request('/api/users/me'");
    expect(readFileSync(resolve(packageRoot, 'blind-box', 'city-data.js'), 'utf8')).toContain('window.regionReady');
  });

  it('leaves scrolling to the host container', () => {
    expect(componentCss).toContain('.buddy-content');
    expect(componentCss).toContain('overflow:visible');
    expect(componentCss).toContain('.interest-choices,.board-list{max-height:none;overflow:visible}');
    expect(host).toContain('class="buddybox-frame"');
    expect(host).toContain('src="blind-box/"');
    expect(host).toContain('scrolling="no"');
    expect(host).toContain('dandan-buddy-height');
  });

  it('keeps mobile overrides after desktop base styles', () => {
    const mobileIndex = host.lastIndexOf('@media (max-width:900px)');
    expect(mobileIndex).toBeGreaterThan(host.indexOf('.app{'));
    const mobileRules = host.slice(mobileIndex, host.indexOf('@media (max-width:620px)', mobileIndex));
    expect(mobileRules).toContain('.sidebar');
    expect(mobileRules).toContain('.main');
  });
});
