import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const html = readFileSync(resolve(process.cwd(), '..', 'backend-handoff-package', 'growth-school.html'), 'utf8');
const start = html.indexOf('function renderServerPlazaTask');
const end = html.indexOf('async function syncPublicTaskPlazas', start);
const renderer = html.slice(start, end);
const syncStart = html.indexOf('async function syncPublicTaskPlazas');
const syncEnd = html.indexOf('var currentTaskHub', syncStart);
const publicTaskSync = html.slice(syncStart, syncEnd);
const claimedTaskStart = html.indexOf('function renderSyncedClaimedTask');
const claimedTaskEnd = html.indexOf('async function submitClaimedTask', claimedTaskStart);
const claimedTaskRenderer = html.slice(claimedTaskStart, claimedTaskEnd);
const claimerRatingStart = html.indexOf('function openClaimerRating');
const claimerRatingEnd = html.indexOf('async function submitClaimedTask', claimerRatingStart);
const claimerRating = html.slice(claimerRatingStart, claimerRatingEnd);

describe('task plaza card contract', () => {
  it('renders the approved real-data information hierarchy', () => {
    expect(renderer).toContain("taskTags.slice(0, 4)");
    expect(renderer).toContain('publisher.eggCategory');
    expect(renderer).toContain('publisher.eggRarity');
    expect(renderer).toContain('task.publishExpReward');
    expect(renderer).toContain('task.reward');
    expect(renderer).toContain('task.activeClaimCount');
    expect(renderer).toContain('task.maxClaimers');
    expect(renderer).toContain('task-card-title-row');
    expect(renderer).toContain('task-card-tags');
    expect(renderer).toContain('task-card-publisher');
    expect(renderer).toContain('task-card-rewards');
    expect(renderer).toContain('task-card-progress');
  });

  it('preserves every filtering and action hook', () => {
    for (const hook of [
      'data-task-id', 'data-publisher-id', 'data-task-type', 'data-skill-cat', 'data-skill-sub',
      'data-claim-mode', 'data-max-claimers', 'data-claimed', 'data-reward', 'data-requirements',
    ]) expect(renderer).toContain(hook);
    expect(renderer).toContain('claim-btn');
    expect(renderer).toContain('查看详情');
  });

  it('binds the details action for each dynamically loaded public task card', () => {
    expect(publicTaskSync).toContain('var card = renderServerPlazaTask(task);');
    expect(publicTaskSync).toContain("bindDetailBtn(card.querySelector('.claim-btn'));");
  });

  it('lets a completed claimer rate the real task publisher', () => {
    expect(claimedTaskRenderer).toContain("claim.status === 'completed'");
    expect(claimedTaskRenderer).toContain('!claim.ratedByCurrentUser');
    expect(claimedTaskRenderer).toContain('评价发布者');
    expect(claimedTaskRenderer).toContain('onclick=\"openClaimerRating(this)\"');
    expect(claimerRating).toContain('data-publisher-id');
    expect(claimerRating).toContain("openRating(card.getAttribute('data-task-title') || '任务'");
    expect(claimerRating).toContain('true, taskId, publisherId');
  });

  it('uses a responsive colorful card without an internal scrollbar', () => {
    expect(html).toContain('--plaza-berry:#F2387A');
    expect(html).toMatch(/\.plaza-card\{[^}]*border-radius:8px/);
    expect(html).toMatch(/\.plaza-card \.desc\{[^}]*-webkit-line-clamp:3/);
    expect(html).not.toMatch(/\.plaza-card\{[^}]*overflow-(?:x|y):(?:auto|scroll)/);
    expect(html).toContain('@media(max-width:620px)');
  });

  it('keeps the feedback entry visible without covering mobile task cards', () => {
    expect(html).toMatch(/@media\s*\(max-width:\s*620px\)[\s\S]*?\.contact-fab\{[^}]*width:44px[^}]*left:14px[^}]*right:auto/);
    expect(html).toMatch(/@media\s*\(max-width:\s*620px\)[\s\S]*?\.contact-fab \.fab-tip\{display:none\}/);
  });
});
