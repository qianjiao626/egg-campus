import { describe, expect, it, vi } from 'vitest';
import { createRealtimeHub, type RealtimeEvent, type RealtimeSocket } from '../src/realtime.js';
import { PERMISSION_KEYS } from '../src/permissions.js';

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

  it('rechecks current RBAC before every administrator event', async () => {
    const permissions = new Map<bigint, string[]>([
      [1n, [PERMISSION_KEYS.taskReview]],
      [2n, []],
    ]);
    const loadPermissions = vi.fn(async (userId: bigint) => permissions.get(userId) || []);
    const hub = createRealtimeHub({ loadPermissions });
    const reviewer = socket();
    const ordinary = socket();
    hub.connect({ userId: 1n, socket: reviewer.client });
    hub.connect({ userId: 2n, socket: ordinary.client });

    await hub.publishAdmin({ ...event('task.pending'), scope: 'admin' }, PERMISSION_KEYS.taskReview);
    permissions.set(1n, []);
    await hub.publishAdmin({ ...event('task.pending'), scope: 'admin' }, PERMISSION_KEYS.taskReview);

    expect(loadPermissions).toHaveBeenCalledTimes(4);
    expect(reviewer.messages).toHaveLength(1);
    expect(ordinary.messages).toHaveLength(0);
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
