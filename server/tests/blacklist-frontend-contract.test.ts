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
});
