/**
 * Live Harbor/gym progress behind the run-ledger subtitle.
 *
 * Gym's JSONL line is the task-complete signal. Everything before that is
 * read from the pinned harbor_jobs tree: a folder, a turn-flushed transcript,
 * verifier events, then result.json.
 */
import { afterEach, expect, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stepOf } from '../src/domain/runs/steps.ts';
import { snapshot } from '../src/gym/progress.ts';

const dirs: string[] = [];

async function workspace() {
  const dir = join(tmpdir(), `live-progress-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(dir, { recursive: true });
  dirs.push(dir);
  const jobs = join(dir, 'harbor_jobs');
  await mkdir(jobs, { recursive: true });
  return {
    outputPath: join(dir, 'rollouts.jsonl'),
    harborJobsDir: jobs,
    trial: join(jobs, '20260814', 'lab', 'glm', 'job1', 'trial1'),
  };
}

async function write(path: string, text: string) {
  await mkdir(join(path, '..'), { recursive: true });
  await Bun.write(path, text);
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

test('says Starting when Harbor has not created a trial yet', async () => {
  const { outputPath, harborJobsDir } = await workspace();
  const live = await snapshot({ outputPath, harborJobsDir, total: 1, maxTurns: 60 });
  expect(stepOf(live.phase)).toBe('Starting');
  expect(live.fraction).toBe(0);
  expect(live.done).toBe(0);
});

test('says Preparing once Harbor has created a folder', async () => {
  const { outputPath, harborJobsDir } = await workspace();
  await mkdir(join(harborJobsDir, '20260814'), { recursive: true });
  const live = await snapshot({ outputPath, harborJobsDir, total: 1, maxTurns: 60 });
  expect(stepOf(live.phase)).toBe('Preparing the environment');
  expect(live.fraction).toBeGreaterThan(0);
  expect(live.fraction).toBeLessThan(0.2);
});

test('names the agent turn from the flushed transcript', async () => {
  const { outputPath, harborJobsDir, trial } = await workspace();
  const transcript = join(trial, 'agent/artifacts/lab-run/transcript.jsonl');
  await write(transcript, '{"turn": 1, "role": "model_input"}\n{"turn": 12, "role": "model_input"}\n');
  const live = await snapshot({ outputPath, harborJobsDir, total: 1, maxTurns: 60 });
  expect(stepOf(live.phase)).toBe('The agent is working — turn 12 of 60');
  expect(live.fraction).toBeGreaterThan(0.1);
  expect(live.fraction).toBeLessThan(0.5);
});

test('reads the turn off the start of a megabyte-sized last line', async () => {
  const { outputPath, harborJobsDir, trial } = await workspace();
  const transcript = join(trial, 'agent/artifacts/lab-run/transcript.jsonl');
  const huge = `{"turn": 7, "role": "model_input", "messages": "${'x'.repeat(800_000)}"}\n`;
  await write(transcript, huge);
  const live = await snapshot({ outputPath, harborJobsDir, total: 1, maxTurns: 60 });
  expect(stepOf(live.phase)).toBe('The agent is working — turn 7 of 60');
});

test('names scoring from verifier events, with a criteria hint', async () => {
  const { outputPath, harborJobsDir, trial } = await workspace();
  const verifier = join(trial, 'verifier/transcript.jsonl');
  await write(
    verifier,
    '{"type": "criterion_start", "criterion_id": "C-0"}\n' +
      '{"type": "criterion_complete", "criterion_id": "C-0"}\n' +
      '{"type": "criterion_start", "criterion_id": "C-1"}\n',
  );
  const live = await snapshot({
    outputPath,
    harborJobsDir,
    total: 1,
    maxTurns: 60,
    criteriaHint: 50,
  });
  expect(stepOf(live.phase)).toBe('Scoring answers — 2 of 50 criteria');
  expect(live.fraction).toBeGreaterThan(0.7);
});

test('a finished Harbor trial with no JSONL yet is Finishing this task', async () => {
  const { outputPath, harborJobsDir, trial } = await workspace();
  await write(join(trial, 'result.json'), '{"ok":true}\n');
  const live = await snapshot({ outputPath, harborJobsDir, total: 1, maxTurns: 60 });
  expect(stepOf(live.phase)).toBe('Finishing this task');
  expect(live.fraction).toBe(1);
});

test('a JSONL line is a finished task', async () => {
  const { outputPath, harborJobsDir } = await workspace();
  await Bun.write(outputPath, '{"reward":1}\n');
  const live = await snapshot({ outputPath, harborJobsDir, total: 1, maxTurns: 60 });
  expect(stepOf(live.phase)).toBe('1 of 1 tasks done');
  expect(live.fraction).toBe(1);
  expect(live.done).toBe(1);
});
