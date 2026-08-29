import { describe, expect, it, vi } from 'vitest';
import { createRealtimeHub, type RealtimeEvent, type RealtimeSocket } from '../src/realtime.js';
import { PERMISSION_KEYS } from '../src/permissions.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function socket() {
  const messages: string[] = [];
  const client: RealtimeSocket = {
    readyState: 1,
    send(payload) { messages.push(payload); },
    close: vi.fn(),
  };
  return { client, messages };
}

const event = (type: string): RealtimeEvent => ({
  type,
  resourceId: '42',
  scope: 'public',
  occurredAt: '2026-08-27T00:00:00.000Z',
});

describe('realtime event hub', () => {
  it('publishes public events to every authenticated connection', () => {
    const hub = createRealtimeHub();
    const first = socket();
    const second = socket();
    hub.connect({ userId: 1n, socket: first.client });
    hub.connect({ userId: 2n, socket: second.client });

    hub.publishPublic(event('task.approved'));

    expect(first.messages).toHaveLength(1);
    expect(second.messages).toHaveLength(1);
    expect(JSON.parse(first.messages[0])).toMatchObject({ type: 'task.approved', scope: 'public' });
  });

  it('publishes private events only to target users', () => {
    const hub = createRealtimeHub();
    const target = socket();
    const unrelated = socket();
    hub.connect({ userId: 1n, socket: target.client });
    hub.connect({ userId: 2n, socket: unrelated.client });

    hub.publishPrivate([1n], { ...event('task.reviewed'), scope: 'private' });

    expect(target.messages).toHaveLength(1);
    expect(unrelated.messages).toHaveLength(0);
  });

  it('loads permissions once per user and sends to all of that users connections', async () => {
    const loadPermissions = vi.fn(async (_userId: bigint) => [PERMISSION_KEYS.taskReview]);
    const hub = createRealtimeHub({ loadPermissions });
    const first = socket();
    const second = socket();
    hub.connect({ userId: 1n, socket: first.client });
    hub.connect({ userId: 1n, socket: second.client });

    await hub.publishAdmin({ ...event('task.pending'), scope: 'admin' }, PERMISSION_KEYS.taskReview);

    expect(loadPermissions).toHaveBeenCalledOnce();
    expect(first.messages).toHaveLength(1);
    expect(second.messages).toHaveLength(1);
  });

  it('caches permissions for one second by default', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-29T00:00:00.000Z'));
      const loadPermissions = vi.fn(async () => [PERMISSION_KEYS.taskReview]);
      const hub = createRealtimeHub({ loadPermissions });
      hub.connect({ userId: 1n, socket: socket().client });

      await hub.publishAdmin(event('first'), PERMISSION_KEYS.taskReview);
      await hub.publishAdmin(event('second'), PERMISSION_KEYS.taskReview);
      expect(loadPermissions).toHaveBeenCalledOnce();

      vi.advanceTimersByTime(1_001);
      await hub.publishAdmin(event('third'), PERMISSION_KEYS.taskReview);
      expect(loadPermissions).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('coalesces concurrent permission loads for one user', async () => {
    const pending = deferred<readonly string[]>();
    const loadPermissions = vi.fn(() => pending.promise);
    const hub = createRealtimeHub({ loadPermissions });
    hub.connect({ userId: 1n, socket: socket().client });

    const first = hub.publishAdmin(event('first'), PERMISSION_KEYS.taskReview);
    const second = hub.publishAdmin(event('second'), PERMISSION_KEYS.taskReview);
    expect(loadPermissions).toHaveBeenCalledOnce();
    pending.resolve([PERMISSION_KEYS.taskReview]);
    await Promise.all([first, second]);
  });

  it('invalidates one users permissions without evicting another user', async () => {
    const loadPermissions = vi.fn(async (_userId: bigint) => [PERMISSION_KEYS.taskReview]);
    const hub = createRealtimeHub({ loadPermissions });
    hub.connect({ userId: 1n, socket: socket().client });
    hub.connect({ userId: 2n, socket: socket().client });
    await hub.publishAdmin(event('first'), PERMISSION_KEYS.taskReview);

    hub.invalidatePermissions([1n]);
    await hub.publishAdmin(event('second'), PERMISSION_KEYS.taskReview);

    expect(loadPermissions.mock.calls.map(([userId]) => userId)).toEqual([1n, 2n, 1n]);
  });

  it('invalidates all cached permissions', async () => {
    const loadPermissions = vi.fn(async () => [PERMISSION_KEYS.taskReview]);
    const hub = createRealtimeHub({ loadPermissions });
    hub.connect({ userId: 1n, socket: socket().client });
    hub.connect({ userId: 2n, socket: socket().client });
    await hub.publishAdmin(event('first'), PERMISSION_KEYS.taskReview);

    hub.invalidatePermissions();
    await hub.publishAdmin(event('second'), PERMISSION_KEYS.taskReview);

    expect(loadPermissions).toHaveBeenCalledTimes(4);
  });

  it('does not cache failures and retries the next administrator event', async () => {
    const loadPermissions = vi.fn()
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValue([PERMISSION_KEYS.taskReview]);
    const hub = createRealtimeHub({ loadPermissions });
    const reviewer = socket();
    hub.connect({ userId: 1n, socket: reviewer.client });

    await hub.publishAdmin(event('first'), PERMISSION_KEYS.taskReview);
    await hub.publishAdmin(event('second'), PERMISSION_KEYS.taskReview);

    expect(loadPermissions).toHaveBeenCalledTimes(2);
    expect(reviewer.messages).toHaveLength(1);
  });

  it('does not let an invalidated in-flight load send or refill stale permissions', async () => {
    const stale = deferred<readonly string[]>();
    const loadPermissions = vi.fn()
      .mockImplementationOnce(() => stale.promise)
      .mockResolvedValueOnce([]);
    const hub = createRealtimeHub({ loadPermissions });
    const reviewer = socket();
    hub.connect({ userId: 1n, socket: reviewer.client });

    const publishing = hub.publishAdmin(event('first'), PERMISSION_KEYS.taskReview);
    hub.invalidatePermissions([1n]);
    stale.resolve([PERMISSION_KEYS.taskReview]);
    await publishing;
    await hub.publishAdmin(event('second'), PERMISSION_KEYS.taskReview);

    expect(loadPermissions).toHaveBeenCalledTimes(2);
    expect(reviewer.messages).toHaveLength(0);
  });

  it('cleans cached permissions after the users final disconnect', async () => {
    const loadPermissions = vi.fn(async () => [PERMISSION_KEYS.taskReview]);
    const hub = createRealtimeHub({ loadPermissions });
    const disconnectFirst = hub.connect({ userId: 1n, socket: socket().client });
    const disconnectSecond = hub.connect({ userId: 1n, socket: socket().client });
    await hub.publishAdmin(event('first'), PERMISSION_KEYS.taskReview);
    disconnectFirst();
    await hub.publishAdmin(event('second'), PERMISSION_KEYS.taskReview);
    expect(loadPermissions).toHaveBeenCalledOnce();

    disconnectSecond();
    hub.connect({ userId: 1n, socket: socket().client });
    await hub.publishAdmin(event('third'), PERMISSION_KEYS.taskReview);
    expect(loadPermissions).toHaveBeenCalledTimes(2);
  });

  it('clears connections and permission caches when the hub closes', async () => {
    const loadPermissions = vi.fn(async () => [PERMISSION_KEYS.taskReview]);
    const first = socket();
    const hub = createRealtimeHub({ loadPermissions });
    hub.connect({ userId: 1n, socket: first.client });
    await hub.publishAdmin(event('first'), PERMISSION_KEYS.taskReview);

    hub.closeAll();
    expect(hub.connectionCount()).toBe(0);
    expect(first.client.close).toHaveBeenCalledWith(1001, 'server shutdown');

    hub.connect({ userId: 1n, socket: socket().client });
    await hub.publishAdmin(event('second'), PERMISSION_KEYS.taskReview);
    expect(loadPermissions).toHaveBeenCalledTimes(2);
  });

  it('removes closed connections and never throws on a failed send', () => {
    const hub = createRealtimeHub();
    const broken: RealtimeSocket = { readyState: 1, send() { throw new Error('closed'); } };
    const disconnect = hub.connect({ userId: 1n, socket: broken });

    expect(() => hub.publishPublic(event('ranking.updated'))).not.toThrow();
    disconnect();
    expect(hub.connectionCount()).toBe(0);
  });
});
