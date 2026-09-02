import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(resolve(process.cwd(), '..', 'backend-handoff-package', 'growth-school.html'), 'utf8');

describe('frontend responsive shell contract', () => {
  it('keeps the main shell fluid below desktop while preventing horizontal overflow', () => {
    expect(html).toContain('@media (max-width:1100px)');
    expect(html).toContain('overflow-x:hidden');
    expect(html).toContain('.app,.main,.page,.app > *, .main > *, .page > *{min-width:0!important}');
    expect(html).toContain('.main{width:100%!important;height:100dvh!important;overflow-x:hidden!important;overflow-y:hidden!important');
    expect(html).toContain('.page{width:100%!important;height:calc(100dvh - 84px)!important;min-height:0!important;overflow-x:hidden!important;overflow-y:auto!important');
    expect(html).toContain('.topbar{min-width:0!important;display:flex!important;flex-wrap:wrap!important;align-items:center!important;gap:10px!important');
    expect(html).toContain('padding:calc(12px + env(safe-area-inset-top))');
    expect(html).toContain('min-height:100vh');
  });

  it('keeps narrow screens on a single vertical scroll owner with a phone nav fallback', () => {
    expect(html).toContain('@media (max-width:620px)');
    expect(html).toContain('overflow-y:auto');
    expect(html).toContain('.sidebar{width:72px');
    expect(html).toContain('.sidebar .nav-item span');
    expect(html).toContain('.sidebar .logout');
    expect(html).toContain('.sidebar .nav-item{justify-content:center!important;align-items:center!important;min-height:44px!important;height:44px!important');
  });

  it('covers content grids, tables, modals, notifications, and charts on smaller screens', () => {
    expect(html).toContain('@media (max-width:900px)');
    expect(html).toContain('.grid-3,.grid-2,.kpi-row{grid-template-columns:minmax(0,1fr)!important}');
    expect(html).toContain('.table{max-width:100%;overflow:auto;-webkit-overflow-scrolling:touch}');
    expect(html).toContain('.modal-overlay .modal-box,.modal-overlay .feedback-card,.modal-overlay .invite-modal-box,.modal-overlay .char-modal-card,.modal-overlay .reg-modal-card,.modal-overlay .login-card,.modal-overlay .task-detail-card');
    expect(html).toContain('.notif-panel{width:min(360px,calc(100vw - 24px));max-height:calc(100dvh - 24px)');
    expect(html).toContain('.modal-overlay,.rank-modal-overlay{align-items:flex-end;padding:12px 12px calc(12px + env(safe-area-inset-bottom))');
    expect(html).toContain('.dash-chart-row{grid-template-columns:minmax(0,1fr)}');
    expect(html).toContain('@media(max-width:600px)');
    expect(html).toContain('.dash-chart-card{padding:12px;min-height:240px}.dash-chart{height:196px;min-height:196px}');
    expect(html).toContain('.btn,.login-btn,.reg-btn,.egg-draw-btn,.egg-redraw-btn,.banner-publish-btn,.task-detail-card .td-status .btn{min-height:44px');
    expect(html).toContain('.notif-panel{position:fixed;left:12px;right:12px;top:auto;bottom:calc(12px + env(safe-area-inset-bottom))');
  });
});
