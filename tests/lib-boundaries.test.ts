/**
 * Hostile-input boundaries in the import libraries.
 *
 * These are the guarantees the import relies on: paths cannot escape staging,
 * a malformed line or file is skipped rather than aborting an import, and a
 * source URL parses to the right host shape.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArchiveError, stagedFile, stagingPath } from '../src/lib/archive.ts';
import * as harbor from '../src/lib/harbor.ts';
import { parseSource, SourceError } from '../src/lib/source.ts';
import * as tabular from '../src/lib/tabular.ts';

const dirs: string[] = [];

async function workspace(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('source URL parsing', () => {
  test('parses a bare owner/repo as GitHub', () => {
    const spec = parseSource('owner/repo');
    expect(spec.kind).toBe('github');
    expect(spec.identifier).toBe('owner/repo');
  });

  test('reads the ref from a /tree/ link', () => {
    const spec = parseSource('https://github.com/owner/repo/tree/feature/x');
    expect(spec.requestedRef).toBe('feature/x');
  });

  test('parses a HuggingFace dataset URL', () => {
    const spec = parseSource('https://huggingface.co/datasets/ns/dataset');
    expect(spec.kind).toBe('huggingface');
    expect(spec.identifier).toBe('ns/dataset');
  });

  test('rejects an unsupported host', () => {
    expect(() => parseSource('https://example.com/owner/repo')).toThrow(SourceError);
  });
});

describe('archive path guarding', () => {
  test('rejects traversal out of staging', () => {
    expect(() => stagedFile('/tmp/base', '../evil')).toThrow(ArchiveError);
    expect(() => stagingPath('/tmp/workspace', '../../etc')).toThrow(ArchiveError);
  });

  test('accepts an in-tree path and strips a leading slash', () => {
    expect(stagedFile('/tmp/base', 'sub/file.txt')).toBe(join('/tmp/base', 'sub/file.txt'));
  });
});

describe('tabular reader', () => {
  test('skips a malformed line without losing the valid rows', async () => {
    const root = await workspace('tabular-');
    await writeFile(
      join(root, 'data.jsonl'),
      '{"question": "a", "answer": "1"}\nnot json\n{"question": "b", "answer": "2"}\n',
    );
    const tasks = await tabular.read(root);
    expect(tasks.map((task) => task.name)).toHaveLength(2);
  });
});

describe('harbor reader', () => {
  test('skips a malformed task.json without failing the import', async () => {
    const root = await workspace('harbor-');
    await mkdir(join(root, 'tasks/alpha'), { recursive: true });
    await writeFile(join(root, 'tasks/alpha/task.json'), '{ not json');
    await mkdir(join(root, 'tasks/beta'), { recursive: true });
    await writeFile(join(root, 'tasks/beta/task.json'), JSON.stringify({ title: 'Beta' }));
    const tasks = await harbor.read(root);
    expect(tasks.map((task) => task.name)).toEqual(['Beta']);
  });
});
