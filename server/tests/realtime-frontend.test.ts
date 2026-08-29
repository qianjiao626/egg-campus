import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const clientPath = resolve(process.cwd(), '..', 'backend-handoff-package', 'realtime-client.js');
const source = existsSync(clientPath) ? readFileSync(clientPath, 'utf8') : '';

function loadClient() {
  const sockets: FakeSocket[] = [];
  const timers: Array<() => void> = [];
  const events: Array<{ type: string; detail?: unknown }> = [];
  class FakeSocket {
    static OPEN = 1;
    readyState = 0;
    onopen: null | (() => void) = null;
    onmessage: null | ((event: { data: string }) => void) = null;
    onclose: null | (() => void) = null;
    onerror: null | (() => void) = null;
    constructor(readonly url: string) { sockets.push(this); }
    close() { this.readyState = 3; }
  }
  const window: any = {
    location: { protocol: 'https:', host: 'dsxnb.com' },
    DANDAN_API_ORIGIN: '/dd',
    WebSocket: FakeSocket,
    CustomEvent: class { constructor(readonly type: string, readonly init: any) {} get detail() { return this.init?.detail; } },
    dispatchEvent(event: any) { events.push({ type: event.type, detail: event.detail }); },
    setTimeout(callback: () => void) { timers.push(callback); return timers.length; },
    clearTimeout() {},
    console: { warn: vi.fn() },
  };
  window.window = window;
  vm.runInNewContext(source, window);
  return { client: window.DandanRealtime, sockets, timers, events, console: window.console };
}

describe('frontend realtime client', () => {
  it('connects with the in-memory access token and dispatches subscribed event types', () => {
    const context = loadClient();
    const received: unknown[] = [];
    const unsubscribe = context.client.subscribe(['task.approved'], (event: unknown) => received.push(event));

    context.client.connect('token with spaces');
    expect(context.sockets[0].url).toBe('wss://dsxnb.com/dd/api/realtime?token=token%20with%20spaces');
    context.sockets[0].onmessage?.({ data: JSON.stringify({ type: 'task.approved', resourceId: '1' }) });
    expect(received).toEqual([{ type: 'task.approved', resourceId: '1' }]);

    unsubscribe();
    context.sockets[0].onmessage?.({ data: JSON.stringify({ type: 'task.approved', resourceId: '2' }) });
    expect(received).toHaveLength(1);
  });

  it('uses bounded reconnect attempts and emits one REST fallback event', () => {
    const context = loadClient();
    context.client.connect('token');

    for (let attempt = 0; attempt < 6; attempt += 1) {
      context.sockets[attempt].onclose?.();
      const timer = context.timers.shift();
      if (timer) timer();
    }

    expect(context.sockets).toHaveLength(6);
    expect(context.events.filter((event) => event.type === 'dandan:realtime-fallback')).toHaveLength(1);
    expect(context.console.warn).toHaveBeenCalledTimes(1);
  });

  it('does not reconnect after an explicit disconnect', () => {
    const context = loadClient();
    context.client.connect('token');
    const socket = context.sockets[0];
    context.client.disconnect();
    socket.onclose?.();
    expect(context.timers).toHaveLength(0);
  });
});
