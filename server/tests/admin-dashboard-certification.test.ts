import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), '..');
const app = readFileSync(resolve(root, 'server/src/app.ts'), 'utf8');
const schema = readFileSync(resolve(root, 'server/prisma/schema.prisma'), 'utf8');
const html = readFileSync(resolve(root, 'backend-handoff-package/growth-school.html'), 'utf8');
const client = readFileSync(resolve(root, 'backend-handoff-package/api-client.js'), 'utf8');

describe('admin dashboard contracts', () => {
  it('defines analytics storage and protected aggregation endpoints', () => {
    expect(schema).toContain('model AnalyticsEvent');
    expect(app).toContain("app.post('/api/analytics/event'");
    expect(app).toContain("app.get('/api/admin/dashboard/stats'");
    expect(app).toContain('PERMISSION_KEYS.userList');
  });

  it('exposes six chart regions and client methods', () => {
    ['chartRegistration', 'chartExposure', 'chartDAU', 'chartNavClicks', 'chartPublish', 'chartClaim'].forEach((id) => expect(html).toContain(`id="${id}"`));
    expect(html).toContain('echarts@5.5.1');
    expect(client).toContain('trackEvent');
    expect(client).toContain('adminDashboardStats');
  });
});
