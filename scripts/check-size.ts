#!/usr/bin/env bun
/**
 * Enforces the 500-line ceiling from AGENTS.md.
 *
 * The whole point of this repo is that any file can be read in one sitting.
 * When this fails, split the file — don't compress it. See AGENTS.md for how.
 */
import { Glob } from 'bun';

const LIMIT = 500;
/** Warn before it becomes a build failure, so splits happen calmly. */
const WARN = 400;

/** TS is enforced; CSS/JS are reported only until they are split deliberately. */
const globs: { pattern: string; enforce: boolean }[] = [
  { pattern: '{src,scripts,tests}/**/*.{ts,tsx}', enforce: true },
  { pattern: 'public/**/*.{js,css}', enforce: false },
];

const offenders: { path: string; lines: number }[] = [];
const warnings: { path: string; lines: number }[] = [];

for (const { pattern, enforce } of globs) {
  const glob = new Glob(pattern);
  for await (const path of glob.scan('.')) {
    const lines = (await Bun.file(path).text()).split('\n').length;
    if (lines > LIMIT) {
      if (enforce) offenders.push({ path, lines });
      else warnings.push({ path, lines });
    } else if (lines > WARN) {
      warnings.push({ path, lines });
    }
  }
}

const byLength = (a: { lines: number }, b: { lines: number }) => b.lines - a.lines;

for (const { path, lines } of warnings.sort(byLength)) {
  console.log(`  warn  ${String(lines).padStart(4)}  ${path}`);
}

if (offenders.length === 0) {
  console.log(`✓ no file over ${LIMIT} lines`);
  process.exit(0);
}

console.error(`\n✗ ${offenders.length} file(s) over the ${LIMIT}-line ceiling:\n`);
for (const { path, lines } of offenders.sort(byLength)) {
  console.error(`  ${String(lines).padStart(4)}  ${path}`);
}
console.error('\nSplit them. AGENTS.md § File size says how.');
process.exit(1);
