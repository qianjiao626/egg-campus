import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/prisma.js', () => ({ prisma: {} }));
import { trySettleTeamTask } from '../src/app.js';

const DAY = 24 * 60 * 60 * 1000;

type RatingRow = {
  fromUserId: bigint;
  toUserId: bigint;
  score: number;
  isDropoutVote: boolean;
};

function rating(fromUserId: bigint, toUserId: bigint, score: number, isDropoutVote = false): RatingRow {
  return { fromUserId, toUserId, score, isDropoutVote };
}

function completeTeamRatings(overrides: Partial<Record<'to2' | 'to3', RatingRow[]>> = {}): RatingRow[] {
  return [
    ...(overrides.to2 ?? [rating(1n, 2n, 5), rating(3n, 2n, 5)]),
    ...(overrides.to3 ?? [rating(1n, 3n, 5), rating(2n, 3n, 5)]),
    rating(2n, 1n, 5),
    rating(3n, 1n, 5),
  ];
}

function makeTx(options: {
  task?: Record<string, unknown>;
  claims?: Array<Record<string, unknown>>;
  ratings?: RatingRow[];
  lockCounts?: number[];
} = {}) {
  const task = {
    id: 1n,
    userId: 1n,
    taskType: 'team',
    teamSettledAt: null,
    completedAt: new Date(),
    ...options.task,
  };
  const updateMany = vi.fn();
  (options.lockCounts ?? [1]).forEach((count) => updateMany.mockResolvedValueOnce({ count }));
  const pointTransactionCreate = vi.fn().mockResolvedValue({});
  const tx = {
    task: {
      findUnique: vi.fn().mockResolvedValue(task),
      updateMany,
    },
    taskClaim: {
      findMany: vi.fn().mockResolvedValue(options.claims ?? [
        { claimerId: 2n, frozenAmount: 10 },
        { claimerId: 3n, frozenAmount: 15 },
      ]),
    },
    rating: {
      findMany: vi.fn().mockResolvedValue(options.ratings ?? completeTeamRatings()),
    },
    pointTransaction: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: pointTransactionCreate,
    },
    pointAccount: {
      findUnique: vi.fn().mockResolvedValue({ availableBalance: 100, frozenBalance: 0 }),
      update: vi.fn().mockImplementation(({ data }: { data: { availableBalance: number } }) => ({ availableBalance: data.availableBalance, frozenBalance: 0 })),
    },
  };
  return { tx, updateMany, pointTransactionCreate };
}

describe('team rating settlement', () => {
  it('refunds 80% to every paid teammate when all ratings pass', async () => {
    const { tx, pointTransactionCreate } = makeTx();

    await expect(trySettleTeamTask(tx as never, 1n)).resolves.toBe(true);

    expect(pointTransactionCreate).toHaveBeenCalledTimes(2);
    expect(pointTransactionCreate.mock.calls.map(([arg]) => arg.data.idempotencyKey)).toEqual([
      'team-rating-refund:1:2',
      'team-rating-refund:1:3',
    ]);
    expect(pointTransactionCreate.mock.calls.map(([arg]) => arg.data.deltaAvailable)).toEqual([8, 12]);
  });

  it('denies only the teammate marked dropout by a strict majority', async () => {
    const { tx, pointTransactionCreate } = makeTx({
      ratings: completeTeamRatings({
        to2: [rating(1n, 2n, 5, true), rating(3n, 2n, 5, true)],
      }),
    });

    await trySettleTeamTask(tx as never, 1n);

    expect(pointTransactionCreate.mock.calls.map(([arg]) => arg.data.idempotencyKey)).toEqual(['team-rating-refund:1:3']);
  });

  it('treats an exact half dropout vote as not a majority', async () => {
    const { tx, pointTransactionCreate } = makeTx({
      ratings: completeTeamRatings({
        to2: [rating(1n, 2n, 5, true), rating(3n, 2n, 5, false)],
      }),
    });

    await trySettleTeamTask(tx as never, 1n);

    expect(pointTransactionCreate.mock.calls.map(([arg]) => arg.data.idempotencyKey)).toContain('team-rating-refund:1:2');
  });

  it('refunds an average of exactly 4 and rejects an average below 4', async () => {
    const { tx, pointTransactionCreate } = makeTx({
      ratings: completeTeamRatings({
        to2: [rating(1n, 2n, 4), rating(3n, 2n, 4)],
        to3: [rating(1n, 3n, 4), rating(2n, 3n, 3)],
      }),
    });

    await trySettleTeamTask(tx as never, 1n);

    expect(pointTransactionCreate.mock.calls.map(([arg]) => arg.data.idempotencyKey)).toContain('team-rating-refund:1:2');
    expect(pointTransactionCreate.mock.calls.map(([arg]) => arg.data.idempotencyKey)).not.toContain('team-rating-refund:1:3');
  });

  it('force-settles with partial ratings after the seven-day window', async () => {
    const { tx, pointTransactionCreate } = makeTx({
      task: { completedAt: new Date(Date.now() - 8 * DAY) },
      ratings: [rating(1n, 2n, 5), rating(3n, 2n, 5)],
    });

    await expect(trySettleTeamTask(tx as never, 1n)).resolves.toBe(true);

    expect(pointTransactionCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ idempotencyKey: 'team-rating-refund:1:2', deltaAvailable: 8 }) }));
  });

  it('settles only once when duplicate calls race for the idempotency gate', async () => {
    const { tx, updateMany, pointTransactionCreate } = makeTx({ lockCounts: [1, 0] });

    await expect(trySettleTeamTask(tx as never, 1n)).resolves.toBe(true);
    await expect(trySettleTeamTask(tx as never, 1n)).resolves.toBe(false);

    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(pointTransactionCreate).toHaveBeenCalledTimes(2);
  });

  it('does nothing for non-team tasks so the existing one-to-one path remains unchanged', async () => {
    const { tx, updateMany, pointTransactionCreate } = makeTx({ task: { taskType: 'help' } });

    await expect(trySettleTeamTask(tx as never, 1n)).resolves.toBe(false);

    expect(updateMany).not.toHaveBeenCalled();
    expect(pointTransactionCreate).not.toHaveBeenCalled();
  });
});
