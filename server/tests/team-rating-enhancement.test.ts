import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), '..');
const app = readFileSync(resolve(root, 'server/src/app.ts'), 'utf8');
const schema = readFileSync(resolve(root, 'server/prisma/schema.prisma'), 'utf8');
const html = readFileSync(resolve(root, 'backend-handoff-package/growth-school.html'), 'utf8');

describe('team rating and task hint contracts', () => {
  it('persists independent dropout and publisher runaway votes', () => {
    expect(schema).toContain('isDropoutVote Boolean');
    expect(schema).toContain('isPublisherRunawayVote Boolean');
    expect(app).toContain('isDropoutVote: rating.isDropoutVote');
    expect(app).toContain('isPublisherRunawayVote: rating.isPublisherRunawayVote');
  });

  it('guards settlement on a closed team task and uses an idempotent 80 percent refund', () => {
    expect(app).toContain("task.status !== 'completed'");
    expect(app).toContain('team-rating-refund:${taskId.toString()}:${claim.claimerId.toString()}');
    expect(app).toContain('Math.floor(claim.frozenAmount * 0.8)');
    expect(app).toContain('dropoutVotes * 2 > incoming.length');
  });

  it('ships team rating UI and role-specific task hints', () => {
    expect(html).toContain('teamRatingModal');
    expect(html).toContain('openTeamRatingFromCard');
    expect(html).toContain('renderTeamTaskHint');
    expect(html).toContain('暂时还没有人报名');
  });
});
