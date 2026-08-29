import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('blacklist schema contract', () => {
  it('declares models and uniqueness constraints', () => {
    const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
    expect(schema).toContain('model BlacklistSchool');
    expect(schema).toContain('model BlacklistComment');
    expect(schema).toContain('model BlacklistScore');
    expect(schema).toContain('isUserAdded');
    expect(schema).toContain('addedBy');
    expect(schema).toContain('enum BlacklistSchoolStatus');
    expect(schema).toContain('@@unique([userId, schoolId])');
    expect(schema).toContain('@@unique([commentId, metricKey])');
  });
});
