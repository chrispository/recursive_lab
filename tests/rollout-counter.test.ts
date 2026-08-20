/**
 * The live rollout count behind the run progress bar.
 *
 * This reads a file that is being appended to by another process, so the cases
 * that matter are the racy ones: a read that lands mid-line, a file that does
 * not exist yet, and a resumed read whose offset is in bytes while the content
 * is not ASCII.
 */
import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRolloutCounter } from '../src/gym/results.ts';

const dirs: string[] = [];

async function workspace() {
  const dir = await mkdtemp(join(tmpdir(), 'rollout-counter-'));
  dirs.push(dir);
  return {
    main: join(dir, 'rollouts.jsonl'),
    failures: join(dir, 'rollouts_failures.jsonl'),
  };
}

/** Append exactly what gym appends: one serialized record and a newline. */
const append = async (path: string, text: string) => {
  const existing = await Bun.file(path).exists() ? await Bun.file(path).text() : '';
  await Bun.write(path, existing + text);
};

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

test('reports zero before gym has written anything', async () => {
  const { main } = await workspace();
  expect(await createRolloutCounter(main)()).toBe(0);
});

test('counts completed lines and only counts them once', async () => {
  const { main } = await workspace();
  const count = createRolloutCounter(main);

  await append(main, '{"a":1}\n{"a":2}\n');
  expect(await count()).toBe(2);

  // No new bytes: the same lines must not be counted a second time.
  expect(await count()).toBe(2);

  await append(main, '{"a":3}\n');
  expect(await count()).toBe(3);
});

test('ignores a line that is still being written', async () => {
  const { main } = await workspace();
  const count = createRolloutCounter(main);

  await append(main, '{"a":1}\n{"a":2');
  expect(await count()).toBe(1);

  await append(main, '}\n');
  expect(await count()).toBe(2);
});

test('resumes correctly after a partial line of multibyte text', async () => {
  const { main } = await workspace();
  const count = createRolloutCounter(main);

  // The offset is kept in bytes; these characters are three bytes each, so a
  // character-based offset would resume mid-codepoint and miscount from here on.
  await append(main, '{"note":"判決 — protective order"}\n{"a":2');
  expect(await count()).toBe(1);

  await append(main, '}\n{"a":3}\n');
  expect(await count()).toBe(3);
});

test('adds the failures sidecar to the main file', async () => {
  const { main, failures } = await workspace();
  const count = createRolloutCounter(main);

  await append(main, '{"a":1}\n');
  await append(failures, '{"a":2}\n{"a":3}\n');
  expect(await count()).toBe(3);
});

test('starts over if the output file is replaced under it', async () => {
  const { main } = await workspace();
  const count = createRolloutCounter(main);

  await append(main, '{"a":1}\n{"a":2}\n');
  expect(await count()).toBe(2);

  // A shorter file is a different run, not a rewind of this one.
  await Bun.write(main, '{"a":1}\n');
  expect(await count()).toBe(1);
});
