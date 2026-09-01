import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const client = readFileSync(new URL('../../backend-handoff-package/api-client.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../../backend-handoff-package/growth-school.html', import.meta.url), 'utf8');
const controller = readFileSync(new URL('../../backend-handoff-package/blacklist.js', import.meta.url), 'utf8');

describe('blacklist frontend contract', () => {
  it('exposes the shared client methods and page shell', () => {
    ['blacklistStats', 'blacklistExtremes', 'blacklistRank', 'blacklistMetricRank', 'blacklistSearch', 'blacklistWall', 'blacklistSchool', 'addBlacklistSchool', 'submitBlacklist', 'blacklistMyCount'].forEach((name) => expect(client).toContain(`${name}:`));
    expect(page).toContain('data-page="blacklist"');
    expect(page).toContain('id="page-blacklist"');
    expect(page).toContain('blacklist.js');
    expect(controller).toContain('blacklist.updated');
    expect(controller).toContain('data-blacklist-metric');
    expect(controller).not.toContain('BL_DEMO');
  });

  it('wires the live blacklist interactions to their rendered targets', () => {
    expect(controller).toContain("root('blSearchDropdown')");
    expect(controller).toContain('data-blacklist-school-id');
    expect(controller).toContain("root('blacklistSubmitBtn')");
    expect(page).toContain('id="blSearchDropdown"');
    expect(page).toContain('data-blacklist-submit');
  });

  it('does not treat click events as school-name prefill values', () => {
    expect(controller).toContain("if (typeof prefill !== 'string') prefill = '';");
  });

  it('normalizes blacklist counts and escapes inline values', () => {
    expect(controller).toContain('Number(result.count) || 0');
    expect(page).toContain("replace(/&/g,'&amp;')");
    expect(page).not.toContain("user.nickname.replace(/'/g, \"\\\\'\")");
  });

  it('keeps blind-box entry temporarily hidden without deleting its implementation', () => {
    expect(page).toContain('html:not([data-buddybox-enabled="true"]) [data-page="buddybox"]');
    expect(page).toContain("document.documentElement.dataset.buddyboxEnabled !== 'true' && id === 'buddybox'");
    expect(page).toContain('id="page-buddybox"');
  });

  it('uses a rainbow framed university ranking row instead of pill layout', () => {
    expect(page).toContain('.bl-rank-item{border:2px solid transparent!important;border-radius:10px!important;');
    expect(page).toContain('linear-gradient(90deg,#F2387A 0%,#F59E0B 20%,#16A34A 40%,#0891B2 60%,#165DFF 80%,#8B5CF6 100%) border-box');
    expect(page).toContain('.bl-rank-item::before{display:none!important}');
    expect(page).toContain('.bl-rank-detail-btn{border-radius:8px!important;');
  });
});
