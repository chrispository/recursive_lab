/**
 * How a rollout's outcome is decided, and specifically what counts as an error.
 *
 * The distinction these tests defend is the one the eval exists to make: a
 * model that was graded and scored zero, versus a run that never graded
 * anything. Gym reports both as a well-formed response with `reward: 0.0`, so
 * the only thing separating them is which failure fields get read. Confusing
 * the two writes a capability claim the run never earned.
 */
import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRollouts } from '../src/gym/results.ts';

const dirs: string[] = [];

/** One eval output file holding exactly the rows given. */
async function outputOf(...rows: Record<string, unknown>[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rollout-outcome-'));
  dirs.push(dir);
  const path = join(dir, 'rollouts.jsonl');
  await Bun.write(path, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  return path;
}

/** A rollout as gym writes it: completed response, no trial, reward 0. */
const rollout = (extra: Record<string, unknown> = {}) => ({
  response: { status: 'completed', error: null },
  reward: 0.0,
  instance_id: 'legal_agent_bench::firm-knowledge__tasks__018',
  metadata: {},
  _ng_task_index: 0,
  _ng_rollout_index: 0,
  ...extra,
});

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

test('a graded zero is a failure, not an error', async () => {
  const [only] = await readRollouts(await outputOf(rollout()));
  expect(only?.outcome).toBe('failed');
  expect(only?.error).toBe('');
});

test('a harness error is an error, not a graded failure', async () => {
  // The exact shape that made a benchmark run report the model as failing on a
  // task the model was never shown: the harness died, and said so in metadata
  // rather than in `response.error`.
  const path = await outputOf(
    rollout({
      metadata: {
        harbor_error: 'ValueError: Harbor dataset selection resolved to zero runnable tasks.',
      },
    }),
  );
  const [only] = await readRollouts(path);
  expect(only?.outcome).toBe('error');
  expect(only?.error).toContain('zero runnable tasks');
});

test('a failed model call is still an error', async () => {
  const path = await outputOf(rollout({ response: { error: { message: 'upstream 503' } } }));
  const [only] = await readRollouts(path);
  expect(only?.outcome).toBe('error');
  expect(only?.error).toBe('upstream 503');
});

test('an ungraded rollout that hit a wall is an error', async () => {
  const path = await outputOf(rollout({ agent_timeout_error: 1.0 }));
  const [only] = await readRollouts(path);
  expect(only?.outcome).toBe('error');
  expect(only?.error).toBe('agent timed out');
});

test('a wall the agent hit does not override criteria that were graded', async () => {
  // The verifier scored the partial work, so the run *can* claim it graded this
  // task. Treating the limit as fatal here would discard a real verdict.
  const dir = await mkdtemp(join(tmpdir(), 'rollout-outcome-trial-'));
  dirs.push(dir);
  await Bun.write(
    join(dir, 'verifier/scores.json'),
    JSON.stringify({ criteria_results: [{ id: 'C-001', title: 'x', verdict: 'pass' }] }),
  );
  const path = await outputOf(
    rollout({
      context_length_exceeded_error: 1.0,
      metadata: { trial_uri: dir, trial_name: 'trial-1' },
    }),
  );

  const [only] = await readRollouts(path);
  expect(only?.outcome).toBe('passed');
  expect(only?.error).toBe('');
});

test('reads verifier criteria and token usage from a completed trial', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rollout-outcome-scored-'));
  dirs.push(dir);
  await mkdir(join(dir, 'verifier'), { recursive: true });
  await mkdir(join(dir, 'agent/artifacts/lab-run'), { recursive: true });
  await Bun.write(
    join(dir, 'verifier/scores.json'),
    JSON.stringify({
      judge_model: 'judge-model',
      cost: { input_tokens: 11, output_tokens: 7, wall_clock_seconds: 2.5 },
      criteria_results: [{ id: 'C-001', title: 'x', verdict: 'pass' }],
    }),
  );
  await Bun.write(
    join(dir, 'agent/artifacts/lab-run/transcript.jsonl'),
    JSON.stringify({ role: 'assistant', input_tokens: 101, output_tokens: 13 }) + '\n',
  );

  const path = await outputOf(
    rollout({
      metadata: { trial_uri: dir, trial_name: 'trial-1' },
    }),
  );

  const [only] = await readRollouts(path);
  expect(only?.outcome).toBe('passed');
  expect(only?.criteria).toHaveLength(1);
  expect(only?.criteria[0]?.verdict).toBe('pass');
  expect(only?.tokens).toEqual({
    agentInputTokens: 101,
    agentOutputTokens: 13,
    agentTurns: 1,
    judgeInputTokens: 11,
    judgeOutputTokens: 7,
    judgeWallClockSeconds: 2.5,
  });
});
