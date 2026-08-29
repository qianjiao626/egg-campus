import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const manifestArg = process.argv[2];
const stagingArg = process.argv[3];

if (!manifestArg || !stagingArg) {
  console.error('usage: node server/scripts/stage-release-frontend.mjs <manifest.json> <staging-dir>');
  process.exit(2);
}

const manifestPath = path.resolve(root, manifestArg);
const stagingDir = path.resolve(stagingArg);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const existingEntries = fs.existsSync(stagingDir) ? fs.readdirSync(stagingDir) : [];
if (existingEntries.length) {
  console.error(`FRONTEND_STAGE_ERROR staging directory is not empty: ${stagingDir}`);
  process.exit(1);
}
fs.mkdirSync(stagingDir, { recursive: true });

const frontendFiles = (manifest.files ?? []).filter((entry) => entry.component === 'frontend');
const errors = [];
const targets = new Set();

if (!frontendFiles.length) errors.push('manifest has no frontend files');
for (const entry of frontendFiles) {
  const sourcePath = String(entry.path ?? '').replaceAll('\\', '/');
  const targetPath = String(entry.target ?? '').replaceAll('\\', '/');
  const normalizedTarget = path.posix.normalize(targetPath);
  if (!sourcePath.startsWith('backend-handoff-package/')) {
    errors.push(`frontend source is outside backend-handoff-package: ${sourcePath}`);
    continue;
  }
  if (!targetPath || normalizedTarget !== targetPath || targetPath.startsWith('/') || targetPath === '..' || targetPath.startsWith('../')) {
    errors.push(`invalid frontend target: ${targetPath}`);
    continue;
  }
  if (targets.has(targetPath)) {
    errors.push(`duplicate frontend target: ${targetPath}`);
    continue;
  }
  targets.add(targetPath);

  const source = path.resolve(root, sourcePath);
  const sourceRoot = path.resolve(root, 'backend-handoff-package');
  if (!source.startsWith(sourceRoot + path.sep) || !fs.existsSync(source) || !fs.statSync(source).isFile()) {
    errors.push(`frontend source is missing or invalid: ${sourcePath}`);
    continue;
  }
  const actualHash = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  if (actualHash !== String(entry.sha256 ?? '').toLowerCase()) {
    errors.push(`frontend hash mismatch: ${sourcePath}`);
    continue;
  }

  const destination = path.resolve(stagingDir, ...targetPath.split('/'));
  if (!destination.startsWith(stagingDir + path.sep)) {
    errors.push(`frontend target escapes staging directory: ${targetPath}`);
    continue;
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

if (errors.length) {
  console.error(errors.map((error) => `FRONTEND_STAGE_ERROR ${error}`).join('\n'));
  process.exit(1);
}
console.log(`FRONTEND_STAGE_OK ${manifest.releaseId} files=${targets.size} dir=${stagingDir}`);
