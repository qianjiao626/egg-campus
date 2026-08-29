import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const productionMode = process.argv[2] === '--production';
const manifestPath = process.argv[productionMode ? 3 : 2];
if (!manifestPath) {
  console.error('usage: node server/scripts/verify-release-boundary.mjs [--production] <manifest.json>');
  process.exit(2);
}

const absoluteManifest = path.resolve(root, manifestPath);
const manifest = JSON.parse(fs.readFileSync(absoluteManifest, 'utf8'));
const errors = [];
const releaseIndexPath = path.resolve(path.dirname(absoluteManifest), 'index.json');
const forbiddenPatterns = [
  /(^|[\/]).env(?:$|.)/i,
  /(^|[\/])node_modules([\/]|$)/i,
  /.rollback-/i,
  /.screenshot./i,
  /(^|[\/])output[\/]playwright([\/]|$)/i,
  /server[\/].vitest-full-result.json$/i,
];

if (!/^r\d+$/.test(String(manifest.version ?? ''))) {
  errors.push('manifest must include a monotonically named version such as r2');
}
if (!/^.+-r\d+$/.test(String(manifest.releaseId ?? ''))) {
  errors.push('releaseId must include the version suffix, for example -r2');
}
if (!fs.existsSync(releaseIndexPath)) {
  errors.push('release index is missing: docs/releases/index.json');
} else {
  const index = JSON.parse(fs.readFileSync(releaseIndexPath, 'utf8'));
  const registered = (index.releases ?? []).find((item) => item.releaseId === manifest.releaseId);
  if (!registered) errors.push('release is not registered in index: ' + manifest.releaseId);
  if (registered && registered.manifest !== path.basename(absoluteManifest)) {
    errors.push('release index manifest mismatch: expected ' + registered.manifest);
  }
  if (productionMode && index.activeReleaseId !== manifest.releaseId) {
    errors.push('production release is not the active indexed version: ' + manifest.releaseId);
  }
  if (manifest.status === 'isolated-test-only' && index.activeReleaseId !== manifest.releaseId) {
    errors.push('isolated release is not the active indexed version: ' + manifest.releaseId);
  }
}
if (!productionMode && manifest.productionDeployable !== false) {
  errors.push('non-production manifests must explicitly set productionDeployable=false');
}
if (!['isolated-test-only', 'superseded', 'production-approved'].includes(manifest.status)) {
  errors.push('manifest status must be isolated-test-only, superseded, or production-approved');
}
if (manifest.status === 'superseded' && !/^.+-r\d+$/.test(String(manifest.supersededBy ?? ''))) {
  errors.push('superseded manifests must identify a versioned supersededBy release');
}
if (manifest.status === 'isolated-test-only' && manifest.rollbackSource !== null) {
  errors.push('rollbackSource must be null when no versioned rollback artifact is approved');
}
if (productionMode && manifest.status !== 'production-approved') {
  if (manifest.status === 'superseded') errors.push('superseded releases are never deployable');
  else errors.push('production deployment requires a production-approved manifest');
}
if (productionMode && manifest.productionDeployable !== true) {
  errors.push('production deployment requires productionDeployable=true');
}

const seen = new Set();
const frontendTargets = new Set();
const frontendTargetEntries = new Map();
if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
  errors.push('manifest must include at least one release file');
}
for (const entry of manifest.files ?? []) {
  const rel = String(entry.path ?? '').replaceAll('\\', '/');
  if (!rel || seen.has(rel)) {
    errors.push(`duplicate or empty release path: ${rel}`);
    continue;
  }
  seen.add(rel);
  if (manifest.status !== 'superseded' && !['frontend', 'backend'].includes(entry.component)) {
    errors.push(`release file must declare component frontend or backend: ${rel}`);
  }
  if (entry.component === 'frontend') {
    const target = String(entry.target ?? '').replaceAll('\\', '/');
    const normalizedTarget = path.posix.normalize(target);
    if (!target || normalizedTarget !== target || target.startsWith('/') || target === '..' || target.startsWith('../')) {
      errors.push(`invalid frontend target: ${target}`);
    } else if (frontendTargets.has(target)) {
      errors.push(`duplicate frontend target: ${target}`);
    } else {
      frontendTargets.add(target);
      frontendTargetEntries.set(target, entry);
    }
    if (!rel.startsWith('backend-handoff-package/')) {
      errors.push(`frontend source must be under backend-handoff-package: ${rel}`);
    }
  } else if (entry.target != null) {
    errors.push(`only frontend files may declare a deployment target: ${rel}`);
  }
  if (forbiddenPatterns.some((pattern) => pattern.test(rel))) errors.push(`forbidden release path: ${rel}`);
  const absolute = path.resolve(root, rel);
  if (!absolute.startsWith(root + path.sep)) {
    errors.push(`release path escapes workspace: ${rel}`);
    continue;
  }
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    errors.push(`release file missing: ${rel}`);
    continue;
  }
  if (manifest.status !== 'superseded') {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
    if (!/^[a-f0-9]{64}$/i.test(entry.sha256 ?? '') || hash !== entry.sha256.toLowerCase()) {
      errors.push(`hash mismatch: ${rel} expected=${entry.sha256} actual=${hash}`);
    }
  }
}

if (manifest.status !== 'superseded' && frontendTargetEntries.size) {
  const localAssetPattern = /[\"'`]([^\"'`?#]+\.(?:html?|css|js|json|png|jpe?g|webp|gif|svg))(?:[?#][^\"'`]*)?[\"'`]/gi;
  for (const [target, entry] of frontendTargetEntries) {
    const source = path.resolve(root, String(entry.path));
    const content = fs.readFileSync(source, 'utf8');
    let match;
    while ((match = localAssetPattern.exec(content))) {
      const reference = match[1].replaceAll('\\', '/');
      if (/^(?:https?:|data:|mailto:|#|\/)/i.test(reference)) continue;
      const ownerDir = path.posix.dirname(target);
      let dependency = path.posix.normalize(path.posix.join(ownerDir, reference));
      if (dependency.endsWith('/')) dependency += 'index.html';
      if (dependency.startsWith('./')) dependency = dependency.slice(2);
      if (!frontendTargets.has(dependency)) {
        errors.push(`frontend runtime dependency is missing from manifest: ${dependency}`);
      }
    }
  }
}

if (errors.length) {
  console.error(errors.map((error) => `RELEASE_BOUNDARY_ERROR ${error}`).join('\n'));
  process.exit(1);
}
console.log(`RELEASE_BOUNDARY_OK ${manifest.releaseId} files=${seen.size} status=${manifest.status}`);
