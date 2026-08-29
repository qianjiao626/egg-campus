import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const packageRoot = resolve(process.cwd(), '..', 'backend-handoff-package');
const motionPath = resolve(packageRoot, 'motion.js');

describe('task card motion contract', () => {
  it('ships a local lazy-loaded anime.js wrapper with deterministic fallbacks', () => {
    expect(existsSync(motionPath)).toBe(true);
    const motion = readFileSync(motionPath, 'utf8');
    expect(motion).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
    expect(motion).toContain("import('./vendor/anime.esm.min.js')");
    expect(motion).toContain('animateTaskCards');
    expect(motion).toContain('highlightTaskCard');
    expect(motion).toContain('activeAnimation.cancel()');
    expect(motion).toContain('console.warn');
  });

  it('vendors anime.js and its MIT notice locally', () => {
    expect(existsSync(resolve(packageRoot, 'vendor', 'anime.esm.min.js'))).toBe(true);
    expect(existsSync(resolve(packageRoot, 'vendor', 'anime-LICENSE.md'))).toBe(true);
    const notices = readFileSync(resolve(packageRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    expect(notices).toContain('animejs@4.5.0');
    expect(notices).toContain('Uiverse.io');
    expect(notices).toContain('Admin12121');
  });
});
