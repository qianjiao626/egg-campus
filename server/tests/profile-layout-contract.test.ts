import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const html = readFileSync(resolve(process.cwd(), '..', 'backend-handoff-package', 'growth-school.html'), 'utf8');

describe('profile layout contract', () => {
  it('moves the profile identity into the profile topbar', () => {
    const profilePage = html.slice(html.indexOf('id="page-profile"'), html.indexOf('</section>', html.indexOf('id="page-profile"')));
    expect(profilePage).toMatch(/class="topbar"[\s\S]*id="profileIdentitySummary"[\s\S]*id="profileNickname"[\s\S]*id="profileSchool"/);
    expect(profilePage.indexOf('profileIdentitySummary')).toBeLessThan(profilePage.indexOf('charSection'));
  });

  it('removes the conflicting middle profile header without hiding it', () => {
    expect(html).not.toContain('class="profile-head"');
    expect(html).not.toMatch(/\.profile-head(?:\s|\{|\.)/);
    expect(html).not.toContain('id="profileMeta"');
    expect(html).not.toContain('id="profileRankMeta"');
  });

  it('keeps the MPI egg character component intact', () => {
    expect(html).toContain('id="charSection"');
    expect(html).toContain('id="charDisplay"');
    expect(html).toContain('id="charImg"');
    expect(html).toContain('id="charUnlockedRow"');
  });

  it('renders a real-data character passport without fictional character levels', () => {
    expect(html).toContain('id="characterPassport"');
    expect(html).toContain('id="characterPassportName"');
    expect(html).toContain('id="characterPassportStatus"');
    expect(html).toContain('id="characterPassportCount"');
    expect(html).toContain('用户成长等级');
    expect(html).toContain('尚未选择角色');
    expect(html).not.toContain('LV.6');
    expect(html).not.toContain('角色成长进度');
    expect(html).not.toContain('默认满属性');
  });

  it('does not ship sample profile values in initial markup', () => {
    expect(html).not.toContain('zhaoming@example.com');
    expect(html).not.toContain('杭州电子科技大学');
    expect(html).not.toContain('共 3,486 人');
    expect(html).not.toContain('热爱折腾的大三软件工程学生');
  });

  it('does not update a profile node that the current profile layout no longer renders', () => {
    expect(html).not.toContain("document.getElementById('profileLevel').textContent");
    expect(html).toContain('id="profileExp2"');
  });
});
