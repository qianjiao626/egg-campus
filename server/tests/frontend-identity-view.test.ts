import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

type TextElement = { textContent: string };
type IdentityElements = {
  sidebarName: TextElement;
  profileName: TextElement;
  profileSchool: TextElement;
};

type IdentityView = {
  renderSessionIdentity(state: Record<string, unknown>, elements: IdentityElements): void;
};

function loadIdentityView(): IdentityView {
  const scriptPath = resolve(process.cwd(), '..', 'backend-handoff-package', 'identity-view.js');
  if (!existsSync(scriptPath)) throw new Error('identity-view.js is missing');
  const windowObject: { DandanIdentityView?: IdentityView } = {};
  runInContext(readFileSync(scriptPath, 'utf8'), createContext({ window: windowObject }), { filename: scriptPath });
  if (!windowObject.DandanIdentityView) throw new Error('DandanIdentityView was not exported');
  return windowObject.DandanIdentityView;
}

function elements(): IdentityElements {
  return {
    sidebarName: { textContent: '' },
    profileName: { textContent: '' },
    profileSchool: { textContent: '' },
  };
}

describe('session identity view', () => {
  it('keeps a restoring session distinct from a real guest', () => {
    const view = loadIdentityView();
    const target = elements();

    view.renderSessionIdentity({ authStatus: 'restoring', currentUser: null }, target);

    expect(target.profileName.textContent).toBe('正在恢复登录状态');
    expect(target.profileSchool.textContent).toBe('正在读取个人资料');
    expect(target.profileName.textContent).not.toBe('未登录');
  });

  it('renders the same authenticated user in the sidebar and profile', () => {
    const view = loadIdentityView();
    const target = elements();

    view.renderSessionIdentity({
      authStatus: 'authenticated',
      currentUser: { nickname: '真实用户', school: '南京大学' },
    }, target);

    expect(target.sidebarName.textContent).toBe('真实用户');
    expect(target.profileName.textContent).toBe('真实用户');
    expect(target.profileSchool.textContent).toBe('南京大学');
  });

  it('shows a stable school fallback without downgrading the user to guest', () => {
    const view = loadIdentityView();
    const target = elements();

    view.renderSessionIdentity({
      authStatus: 'authenticated',
      currentUser: { nickname: '真实用户', school: null },
    }, target);

    expect(target.profileName.textContent).toBe('真实用户');
    expect(target.profileSchool.textContent).toBe('学校未填写');
  });

  it('shows not logged in only after the session is confirmed as guest', () => {
    const view = loadIdentityView();
    const target = elements();

    view.renderSessionIdentity({ authStatus: 'guest', currentUser: null }, target);

    expect(target.sidebarName.textContent).toBe('访客');
    expect(target.profileName.textContent).toBe('未登录');
    expect(target.profileSchool.textContent).toBe('登录后查看学校');
  });
});
