import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const serverRoot = process.cwd();
const workspaceRoot = resolve(serverRoot, '..');
const appSource = readFileSync(resolve(serverRoot, 'src', 'app.ts'), 'utf8');
const schema = readFileSync(resolve(serverRoot, 'prisma', 'schema.prisma'), 'utf8');
const apiClient = readFileSync(resolve(workspaceRoot, 'backend-handoff-package', 'api-client.js'), 'utf8');
const page = readFileSync(resolve(workspaceRoot, 'backend-handoff-package', 'growth-school.html'), 'utf8');

describe('task cancellation request persistence contract', () => {
  it('guards task reward refunds with an explicit frozen state', () => {
    const appSource = readFileSync(resolve(process.cwd(), 'src/app.ts'), 'utf8');
    expect(appSource).toContain('task.rewardFrozen === true');
    expect(appSource).toContain('current.rewardFrozen !== true');
    expect(appSource).toContain('rewardFrozen: false');
  });
  it('persists teaching-task cancellation negotiations on the server', () => {
    expect(schema).toContain('model TaskCancellationRequest');
    expect(appSource).toContain("app.post('/api/tasks/:id/cancellation-requests'");
    expect(appSource).toContain("app.post('/api/tasks/:id/cancellation-requests/:requestId/respond'");
    expect(appSource).toContain("const taskCancellationResponseSchema = z.object({ status: z.enum(['accepted', 'rejected']) });");
  });

  it('does not keep cancellation requests only in browser memory', () => {
    expect(apiClient).toContain('createTaskCancellationRequest');
    expect(apiClient).toContain('respondTaskCancellationRequest');
    expect(page).not.toContain('CANCEL_REQUESTS');
    expect(page).toContain('createTaskCancellationRequest');
  });
});
