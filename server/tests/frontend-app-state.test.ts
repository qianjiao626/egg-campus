import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type AppStateSnapshot = {
  authStatus: 'restoring' | 'authenticated' | 'guest';
  currentUser: Record<string, unknown> | null;
  currentCharacter: Record<string, unknown> | null;
  unreadCounts: Record<string, number>;
};

type AppStateApi = {
  getState(): AppStateSnapshot;
  setState(patch: Partial<AppStateSnapshot> & Record<string, unknown>): AppStateSnapshot;
  subscribe(listener: (state: AppStateSnapshot) => void): () => void;
  setUnreadCount(key: string, value: unknown): number;
  reset(): AppStateSnapshot;
};

function loadAppState(): AppStateApi {
  const scriptPath = resolve(process.cwd(), '..', 'backend-handoff-package', 'app-state.js');
  if (!existsSync(scriptPath)) throw new Error('app-state.js is missing');
  const windowObject: { DandanAppState?: AppStateApi } = {};
  const context = createContext({ window: windowObject, console });
  runInContext(readFileSync(scriptPath, 'utf8'), context, { filename: scriptPath });
  if (!windowObject.DandanAppState) throw new Error('DandanAppState was not exported');
  return windowObject.DandanAppState;
}

describe('frontend application state', () => {
  it('unloads the authenticated blind-box iframe when the main page logs out', () => {
    const html = readFileSync(resolve(process.cwd(), '..', 'backend-handoff-package', 'growth-school.html'), 'utf8');

    expect(html).toContain("buddyboxFrame.setAttribute('src', 'about:blank')");
    expect(html).toContain("buddyboxFrame.getAttribute('src') === 'about:blank'");
  });

  it('starts in restoring state without pretending the visitor is logged out', () => {
    const state = loadAppState();

    expect(state.getState()).toEqual({
      authStatus: 'restoring',
      currentUser: null,
      currentCharacter: null,
      unreadCounts: {},
    });
  });

  it('notifies active subscribers with isolated snapshots', () => {
    const state = loadAppState();
    const firstListener = vi.fn();
    const removedListener = vi.fn();
    state.subscribe(firstListener);
    const unsubscribe = state.subscribe(removedListener);
    unsubscribe();

    state.setState({ authStatus: 'authenticated', currentUser: { id: '7', nickname: '测试用户' } });

    expect(firstListener).toHaveBeenCalledOnce();
    expect(firstListener.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      authStatus: 'authenticated',
      currentUser: { id: '7', nickname: '测试用户' },
    }));
    expect(removedListener).not.toHaveBeenCalled();
    const snapshot = firstListener.mock.calls[0]?.[0] as AppStateSnapshot;
    snapshot.unreadCounts.notifications = 99;
    expect(state.getState().unreadCounts).toEqual({});
  });

  it.each([
    ['negative', -3, 0],
    ['empty', null, 0],
    ['invalid', 'not-a-number', 0],
    ['decimal', 4.9, 4],
    ['positive string', '8', 8],
  ])('normalizes %s unread counts', (_label, input, expected) => {
    const state = loadAppState();

    const count = state.setUnreadCount('notifications', input);

    expect(count).toBe(expected);
    expect(state.getState().unreadCounts.notifications).toBe(expected);
  });

  it('ignores unknown top-level state keys', () => {
    const state = loadAppState();

    const snapshot = state.setState({ accessToken: 'must-not-be-stored' });

    expect(snapshot).not.toHaveProperty('accessToken');
    expect(state.getState()).not.toHaveProperty('accessToken');
  });

  it('resets authenticated and private state to a real guest state', () => {
    const state = loadAppState();
    state.setState({
      authStatus: 'authenticated',
      currentUser: { id: '7' },
      currentCharacter: { category: 'study', isCurrent: true },
    });
    state.setUnreadCount('feedback', 3);

    const snapshot = state.reset();

    expect(snapshot).toEqual({
      authStatus: 'guest',
      currentUser: null,
      currentCharacter: null,
      unreadCounts: {},
    });
  });
});
