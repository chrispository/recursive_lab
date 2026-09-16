/** Read and verify the exact on-disk package used by an evaluation. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { moduleName } from './pi-package.ts';

export const packageFiles = (slug: string) => [
  'pyproject.toml', `${moduleName(slug)}.py`, 'README.md',
  'taskset/train.jsonl', 'taskset/canary.jsonl', 'taskset/heldout.jsonl',
];

// Retain the original hash algorithm so existing packages can be validated.
export async function hashFiles(paths: string[]): Promise<string> {
  const hash = createHash('sha256');
  for (const path of [...paths].sort()) {
    hash.update(path);
    hash.update(await readFile(path));
  }
  return hash.digest('hex').slice(0, 16);
}

export async function verifiedPackage(dir: string, slug: string, expectedHash: string) {
  const files = packageFiles(slug);
  const content = new Map<string, Buffer>();
  const hash = createHash('sha256');
  for (const name of [...files].sort()) {
    const path = resolve(dir, name);
    const data = await readFile(path);
    hash.update(path);
    hash.update(data);
    content.set(name, data);
  }
  if (!expectedHash || hash.digest('hex').slice(0, 16) !== expectedHash) {
    throw new Error('Package files changed since they were built. Build a new package and validate it before export.');
  }
  return content;
}

export const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
