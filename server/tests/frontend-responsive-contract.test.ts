import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(resolve(process.cwd(), '..', 'backend-handoff-package', 'growth-school.html'), 'utf8');

describe('frontend responsive shell contract', () => {
  it('keeps the main shell fluid below desktop while preventing horizontal overflow', () => {
    expect(html).toContain('@media (max-width:1100px)');
    expect(html).toContain('overflow-x:hidden');
    expect(html).toContain('.app,.main,.page,.app > *, .main > *, .page > *{min-width:0!important}');
    expect(html).toContain('.main{width:100%!important;height:100dvh!important;overflow-x:hidden!important;overflow-y:hidden!important');
    expect(html).toContain('.page{width:100%!important;height:calc(100dvh - 84px)!important;min-height:0!important;overflow-x:hidden!important;overflow-y:auto!important');
    expect(html).toContain('.topbar{min-width:0!important;display:flex!important;flex-wrap:wrap!important;align-items:center!important;gap:10px!important');
    expect(html).toContain('padding:calc(12px + env(safe-area-inset-top))');
    expect(html).toContain('min-height:100vh');
  });

  it('keeps narrow screens on a single vertical scroll owner with a phone nav fallback', () => {
    expect(html).toContain('@media (max-width:620px)');
    expect(html).toContain('overflow-y:auto');
    expect(html).toContain('.sidebar{width:72px');
    expect(html).toContain('.sidebar .nav-item span');
    expect(html).toContain('.sidebar .logout');
    expect(html).toContain('.sidebar .nav-item{justify-content:center');
  });
});
