import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(process.cwd(), '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'docs/releases/2026-08-29-production-r3.json'), 'utf8'));
const isolatedManifest = JSON.parse(readFileSync(resolve(root, 'docs/releases/2026-08-28-auth-profile-task-ui-r2.json'), 'utf8'));
const supersededManifest = JSON.parse(readFileSync(resolve(root, 'docs/releases/2026-08-28-auth-profile-task-ui.json'), 'utf8'));
const releaseIndex = JSON.parse(readFileSync(resolve(root, 'docs/releases/index.json'), 'utf8'));
const frontendDeployScript = readFileSync(resolve(root, 'deploy-frontend.sh'), 'utf8');
const expectedFrontendTargets = [
  'api-client.js',
  'assets/theme-bg.jpg',
  'blacklist.js',
  'blind-box/app.js',
  'blind-box/buddy-box-api.js',
  'blind-box/city-data.js',
  'blind-box/index.html',
  'blind-box/region-data.json',
  'blind-box/styles.css',
  'char-eggy-game.jpg',
  'char-eggy-hermit.jpg',
  'char-eggy-hobby-v2.jpg',
  'char-eggy-job-v2.jpg',
  'char-eggy-life-v2.jpg',
  'char-eggy-side.jpg',
  'char-eggy-study-v2.jpg',
  'growth-school.html',
  'identity-view.js',
  'realtime-client.js',
  'sensitive-filter.js',
];

describe('release boundary manifest', () => {
  it('tracks the approved release and points to explicit source files', () => {
    expect(manifest.status).toBe('production-approved');
    expect(manifest.version).toBe('r3');
    expect(manifest.releaseId).toBe('2026-08-29-production-r3');
    expect(manifest.productionDeployable).toBe(true);
    expect(manifest.sourceOfTruth).toBe('component-scoped');
    expect(manifest.componentSources).toEqual({
      frontend: 'backend-handoff-package',
      backend: 'server/src',
    });
    expect(manifest.rollbackSource).toEqual(expect.objectContaining({ releaseId: 'production-baseline-20260829' }));
    expect(manifest.supersedes).toBe('2026-08-28-auth-profile-task-ui-r2');
    expect(releaseIndex.activeReleaseId).toBe(manifest.releaseId);
    expect(releaseIndex.releases).toEqual(expect.arrayContaining([
      expect.objectContaining({ releaseId: manifest.releaseId, manifest: '2026-08-29-production-r3.json', status: 'production-approved' }),
      expect.objectContaining({ releaseId: isolatedManifest.releaseId, manifest: '2026-08-28-auth-profile-task-ui-r2.json', status: 'isolated-test-only' }),
      expect.objectContaining({ releaseId: supersededManifest.releaseId, manifest: '2026-08-28-auth-profile-task-ui.json', status: 'superseded' }),
    ]));
    expect(manifest.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'backend-handoff-package/growth-school.html' }),
      expect.objectContaining({ path: 'server/src/app.ts' }),
    ]));
  });

  it('does not allow stale rollback or secret paths in the release file list', () => {
    const paths = manifest.files.map((entry: { path: string }) => entry.path);
    expect(paths.some((entry: string) => /(^|[\\/]).env|node_modules|rollback|screenshot/i.test(entry))).toBe(false);
  });

  it('marks the previous manifest as historical and non-deployable', () => {
    expect(supersededManifest.status).toBe('superseded');
    expect(supersededManifest.productionDeployable).toBe(false);
    expect(supersededManifest.releaseId).toBe('2026-08-28-auth-profile-task-ui-r1');
    expect(supersededManifest.supersededBy).toBe(isolatedManifest.releaseId);
  });

  it('rejects superseded releases and isolated-only releases as deployment candidates', () => {
    const verifier = resolve(process.cwd(), 'scripts/verify-release-boundary.mjs');
    const superseded = spawnSync(process.execPath, [verifier, '--production', 'docs/releases/2026-08-28-auth-profile-task-ui.json'], { encoding: 'utf8' });
    const isolatedProduction = spawnSync(process.execPath, [verifier, '--production', 'docs/releases/2026-08-28-auth-profile-task-ui-r2.json'], { encoding: 'utf8' });

    expect(superseded.status).not.toBe(0);
    expect(isolatedProduction.status).not.toBe(0);
    expect(superseded.stderr).toContain('superseded releases are never deployable');
    expect(isolatedProduction.stderr).toContain('production-approved');
  });

  it('rejects an approved production release when it is not the active indexed version', () => {
    const tempReleaseDir = mkdtempSync(resolve(tmpdir(), 'dandan-release-boundary-'));
    const approvedManifest = {
      ...manifest,
      releaseId: '2026-08-28-auth-profile-task-ui-r3',
      version: 'r3',
      status: 'production-approved',
      productionDeployable: true,
    };
    writeFileSync(resolve(tempReleaseDir, 'r3.json'), JSON.stringify(approvedManifest));
    writeFileSync(resolve(tempReleaseDir, 'index.json'), JSON.stringify({
      activeReleaseId: '2026-08-28-auth-profile-task-ui-r4',
      releases: [{
        releaseId: approvedManifest.releaseId,
        manifest: 'r3.json',
        status: approvedManifest.status,
      }],
    }));

    try {
      const verifier = resolve(process.cwd(), 'scripts/verify-release-boundary.mjs');
      const result = spawnSync(process.execPath, [verifier, '--production', resolve(tempReleaseDir, 'r3.json')], { encoding: 'utf8' });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('active indexed version');
    } finally {
      rmSync(tempReleaseDir, { recursive: true, force: true });
    }
  });

  it('requires an explicitly approved manifest before deploying', () => {
    expect(frontendDeployScript).toContain('RELEASE_MANIFEST is required');
    expect(frontendDeployScript).toContain('verify-release-boundary.mjs" --production');
    expect(frontendDeployScript).toContain('STATIC_DIR="\${STATIC_DIR:-/var/www/dd}"');
    expect(frontendDeployScript).toContain('stage-release-frontend.mjs');
    expect(frontendDeployScript).not.toContain('for f in api-client.js growth-school.html');

    const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
    const result = spawnSync(bash, [resolve(root, 'deploy-frontend.sh')], {
      encoding: 'utf8',
      env: { ...process.env, RELEASE_MANIFEST: '' },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('RELEASE_MANIFEST is required');
  });

  it('stages every declared frontend runtime file from the manifest', () => {
    const frontendFiles = manifest.files.filter((entry: { component?: string }) => entry.component === 'frontend');
    expect(frontendFiles.map((entry: { target: string }) => entry.target).sort()).toEqual(expectedFrontendTargets);
    expect(manifest.files.filter((entry: { component?: string }) => entry.component === 'backend')).toEqual([
      expect.objectContaining({ path: 'server/src/app.ts' }),
    ]);

    const stagingDir = mkdtempSync(resolve(tmpdir(), 'dandan-frontend-stage-'));
    try {
      const stager = resolve(process.cwd(), 'scripts/stage-release-frontend.mjs');
      const result = spawnSync(process.execPath, [stager, 'docs/releases/2026-08-29-production-r3.json', stagingDir], { encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);

      for (const entry of frontendFiles) {
        const staged = resolve(stagingDir, entry.target);
        expect(existsSync(staged), `missing staged file: ${entry.target}`).toBe(true);
        expect(readFileSync(staged)).toEqual(readFileSync(resolve(root, entry.path)));
      }
    } finally {
      rmSync(stagingDir, { recursive: true, force: true });
    }
  }, 15000);

  it('rejects a manifest that omits a local frontend runtime dependency', () => {
    const tempReleaseDir = mkdtempSync(resolve(tmpdir(), 'dandan-release-dependency-'));
    const incompleteManifest = {
      ...manifest,
      releaseId: '2026-08-28-auth-profile-task-ui-r3',
      version: 'r3',
      files: manifest.files.filter((entry: { target?: string }) => entry.target !== 'identity-view.js'),
    };
    writeFileSync(resolve(tempReleaseDir, 'r3.json'), JSON.stringify(incompleteManifest));
    writeFileSync(resolve(tempReleaseDir, 'index.json'), JSON.stringify({
      activeReleaseId: incompleteManifest.releaseId,
      releases: [{
        releaseId: incompleteManifest.releaseId,
        manifest: 'r3.json',
        status: incompleteManifest.status,
      }],
    }));

    try {
      const verifier = resolve(process.cwd(), 'scripts/verify-release-boundary.mjs');
      const result = spawnSync(process.execPath, [verifier, resolve(tempReleaseDir, 'r3.json')], { encoding: 'utf8' });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('frontend runtime dependency is missing from manifest: identity-view.js');
    } finally {
      rmSync(tempReleaseDir, { recursive: true, force: true });
    }
  });

  it('deploys the complete frontend component declared by an approved manifest', () => {
    const sandbox = mkdtempSync(resolve(tmpdir(), 'dandan-frontend-deploy-'));
    const releaseDir = resolve(sandbox, 'releases');
    const staticDir = resolve(sandbox, 'site');
    const backupRoot = resolve(sandbox, 'backups');
    const approvedManifest = {
      ...manifest,
      releaseId: '2026-08-28-auth-profile-task-ui-r3',
      version: 'r3',
      status: 'production-approved',
      productionDeployable: true,
      targetEnvironments: ['production'],
    };
    const approvedManifestPath = resolve(releaseDir, 'r3.json');
    const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';

    try {
      mkdirSync(releaseDir, { recursive: true });
      mkdirSync(staticDir, { recursive: true });
      writeFileSync(resolve(staticDir, 'api-client.js'), 'stale api client');
      writeFileSync(resolve(staticDir, 'identity-view.js'), 'stale identity');
      writeFileSync(resolve(staticDir, 'growth-school.html'), 'stale page');
      writeFileSync(approvedManifestPath, JSON.stringify(approvedManifest), { flag: 'wx' });
      writeFileSync(resolve(releaseDir, 'index.json'), JSON.stringify({
        activeReleaseId: approvedManifest.releaseId,
        releases: [{
          releaseId: approvedManifest.releaseId,
          manifest: 'r3.json',
          status: approvedManifest.status,
        }],
      }));

      const result = spawnSync(bash, [resolve(root, 'deploy-frontend.sh')], {
        encoding: 'utf8',
        env: {
          ...process.env,
          RELEASE_MANIFEST: approvedManifestPath,
          STATIC_DIR: staticDir,
          BACKUP_ROOT: backupRoot,
        },
      });
      expect(result.status, result.stderr).toBe(0);

      for (const entry of approvedManifest.files.filter((item: { component?: string }) => item.component === 'frontend')) {
        expect(readFileSync(resolve(staticDir, entry.target))).toEqual(readFileSync(resolve(root, entry.path)));
      }
      const backupDirs = existsSync(backupRoot) ? [resolve(backupRoot, ...readFileSync(resolve(backupRoot, '.latest'), 'utf8').trim().split('/'))] : [];
      expect(backupDirs).toHaveLength(1);
      expect(readFileSync(resolve(backupDirs[0], 'identity-view.js'), 'utf8')).toBe('stale identity');
      expect(readFileSync(resolve(backupDirs[0], 'growth-school.html'), 'utf8')).toBe('stale page');
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  }, 15000);

  it('restores the previous frontend files when deployment fails partway through', () => {
    const sandbox = mkdtempSync(resolve(tmpdir(), 'dandan-frontend-rollback-'));
    const releaseDir = resolve(sandbox, 'releases');
    const staticDir = resolve(sandbox, 'site');
    const backupRoot = resolve(sandbox, 'backups');
    const approvedManifest = {
      ...manifest,
      releaseId: '2026-08-28-auth-profile-task-ui-r3',
      version: 'r3',
      status: 'production-approved',
      productionDeployable: true,
      targetEnvironments: ['production'],
    };
    const approvedManifestPath = resolve(releaseDir, 'r3.json');
    const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';

    try {
      mkdirSync(releaseDir, { recursive: true });
      mkdirSync(staticDir, { recursive: true });
      writeFileSync(resolve(staticDir, 'api-client.js'), 'stale api client');
      writeFileSync(resolve(staticDir, 'identity-view.js'), 'stale identity');
      writeFileSync(resolve(staticDir, 'growth-school.html'), 'stale page');
      writeFileSync(resolve(staticDir, 'blind-box'), 'blocks the blind-box directory');
      writeFileSync(approvedManifestPath, JSON.stringify(approvedManifest));
      writeFileSync(resolve(releaseDir, 'index.json'), JSON.stringify({
        activeReleaseId: approvedManifest.releaseId,
        releases: [{
          releaseId: approvedManifest.releaseId,
          manifest: 'r3.json',
          status: approvedManifest.status,
        }],
      }));

      const result = spawnSync(bash, [resolve(root, 'deploy-frontend.sh')], {
        encoding: 'utf8',
        env: {
          ...process.env,
          RELEASE_MANIFEST: approvedManifestPath,
          STATIC_DIR: staticDir,
          BACKUP_ROOT: backupRoot,
        },
      });
      expect(result.status).not.toBe(0);
      expect(readFileSync(resolve(staticDir, 'api-client.js'), 'utf8')).toBe('stale api client');
      expect(readFileSync(resolve(staticDir, 'identity-view.js'), 'utf8')).toBe('stale identity');
      expect(readFileSync(resolve(staticDir, 'growth-school.html'), 'utf8')).toBe('stale page');
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  }, 15000);
});
