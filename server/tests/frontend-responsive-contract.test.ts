import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), '..', 'backend-handoff-package', 'blind-box', 'styles.css'), 'utf8');

describe('frontend responsive shell contract', () => {
  it('keeps the main shell fluid below desktop while preventing horizontal overflow', () => {
    expect(css).toContain('html,body,.buddy-content{max-width:100%');
    expect(css).toContain('overflow-x:hidden');
    expect(css).toContain('@media(max-width:1120px)');
    expect(css).toContain('.workspace{grid-template-columns:minmax(0,1fr) 340px}');
    expect(css).toContain('.match-grid{grid-template-columns:repeat(2,minmax(0,1fr))}');
    expect(css).toContain('@media(max-width:860px)');
    expect(css).toContain('.workspace{grid-template-columns:1fr}');
    expect(css).toContain('.stage-rail,.preference-workbench{grid-column:1;grid-row:auto}');
  });

  it('keeps narrow screens on a single vertical scroll owner with a phone nav fallback', () => {
    expect(css).toContain('@media(max-width:620px)');
    expect(css).toContain('.buddy-stage{min-height:374px');
    expect(css).toContain('.open-box{min-height:44px}');
    expect(css).toContain('.choice{min-height:44px;padding:0 11px}');
    expect(css).toContain('.send-message{min-height:44px}');
    expect(css).toContain('.match-grid{grid-template-columns:1fr}');
    expect(css).toContain('.feature-grid{grid-template-columns:1fr}');
    expect(css).toContain('.message-drawer{top:auto;bottom:0;width:100%;height:min(86vh,720px);border-radius:20px 20px 0 0;padding:20px 16px calc(20px + env(safe-area-inset-bottom))');
  });

  it('covers content grids, tables, modals, notifications, and charts on smaller screens', () => {
    expect(css).toContain('.feature-modal{position:relative;width:min(520px,100%);max-height:min(680px,calc(100vh - 32px));overflow:auto');
    expect(css).toContain('@media(max-width:620px){.feature-section{padding-top:32px}.feature-group{padding:12px}.feature-grid{grid-template-columns:1fr}');
    expect(css).toContain('.feature-modal{width:100%;max-height:calc(100dvh - 24px);overflow:auto;padding:20px 16px;border-radius:18px}');
    expect(css).toContain('.feature-modal-actions{position:sticky;bottom:0;padding-top:12px;padding-bottom:calc(12px + env(safe-area-inset-bottom));background:var(--panel)}');
    expect(css).toContain('.message-drawer{position:fixed;z-index:50;right:0;top:0;width:min(410px,100%);height:100vh');
    expect(css).toContain('.message-drawer{top:auto;bottom:0;width:100%;height:min(86vh,720px);border-radius:20px 20px 0 0;padding:20px 16px calc(20px + env(safe-area-inset-bottom))');
    expect(css).toContain('.stage-object{max-width:100%;overflow:hidden;right:-8px;top:93px;transform:scale(.72);transform-origin:top right}');
  });
});
