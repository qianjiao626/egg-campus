import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BLACKLIST_METRIC_KEYS, displayBlacklistSchoolName, maskBlacklistNickname } from '../src/blacklist.js';

const schools = JSON.parse(readFileSync(new URL('../prisma/seed/blacklist-schools.json', import.meta.url), 'utf8')) as string[];

describe('blacklist seed and pure rules', () => {
  it('contains all attachment schools without duplicates', () => {
    expect(schools).toHaveLength(2361);
    expect(new Set(schools).size).toBe(2361);
    expect(schools).toContain('清华大学');
    expect(schools).toContain('深圳职业技术大学');
  });

  it('keeps the sixteen metric keys stable', () => {
    expect(BLACKLIST_METRIC_KEYS).toHaveLength(16);
    expect(BLACKLIST_METRIC_KEYS).toContain('headcount');
  });

  it('masks public nicknames and prefixes schools once', () => {
    expect(maskBlacklistNickname('海景蛋')).toBe('海**蛋');
    expect(maskBlacklistNickname('川蛋')).toBe('川*');
    expect(displayBlacklistSchoolName('清华大学')).toBe('蛋蛋世界的清华大学');
    expect(displayBlacklistSchoolName('蛋蛋世界的清华大学')).toBe('蛋蛋世界的清华大学');
  });
});
