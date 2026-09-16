/**
 * Prime Intellect `verifiers` environments: package writer and eval runner.
 *
 * An environment is a v0 PI package — `pyproject.toml` plus one Python module
 * exposing `load_environment()` — next to its `taskset/` splits. Local proof
 * runs `prime eval run <id>` with the policy provider's endpoint; the judge
 * that scores verifier coverage rides in on `LAB_JUDGE_*` env vars. Secrets are
 * passed to the child only, never logged.
 */
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { providerHost, recordError } from './diagnostics.ts';
import { readOutcome, savedResultPaths } from './pi-results.ts';
import { runPrimeProcess } from './prime-process.ts';

export function piBin(): string {
  return process.env.PRIME_BIN ?? Bun.which('prime') ?? '/usr/local/bin/prime';
}

export function piInstalled(): boolean {
  return existsSync(piBin());
}

export { writePackage, moduleName, type PiTask, type PiPackageSpec } from './pi-package.ts';
export { clusterToml } from './pi-training.ts';

export type PiEvalRequest = {
  /** Environment id (package slug). */
  envId: string;
  /** Directory containing the package; becomes PYTHONPATH. */
  envDir: string;
  model: string;
  baseUrl: string;
  /** Name of the env var carrying the policy API key. */
  apiKeyVar: string;
  apiKey: string;
  judge: { baseUrl: string; apiKey: string; model: string };
  numExamples: number;
  rolloutsPerExample: number;
  maxConcurrent: number;
  /** Where `--output-dir` points; results land under `evals/` inside it. */
  outputDir: string;
  timeoutMs: number;
  /** Selects which generated taskset split `load_environment` exposes. */
  split?: 'train' | 'canary' | 'heldout';
  /** Internal sidecar path used by the generated verifier to emit target rows. */
  targetScoresPath?: string;
};

export type PiTargetScore = {
  targetIndex: number;
  targetText: string;
  score: number | null;
  verdict: 'pass' | 'fail' | 'error';
  judgeModel: string;
  error: string;
  documentId: number | null;
  details: Record<string, unknown>;
};

export type PiRollout = {
  exampleId: number;
  rolloutIndex: number;
  reward: number | null;
  error: string | null;
  documentId: number | null;
  trialName: string;
  targetScores: PiTargetScore[];
};

export type PiEvalOutcome = {
  resultsPath: string;
  targetScoresPath: string | null;
  rollouts: PiRollout[];
  avgReward: number;
  passAtK: Record<string, number>;
  seconds: number;
};

export type PiEvalHooks = {
  onLine?: (line: string, stream: 'out' | 'err') => void | Promise<void>;
  onSpawn?: (pgid: number) => void | Promise<void>;
};

/** Runs `prime eval run` and parses its saved results. Throws on non-zero exit. */
export async function runEval(request: PiEvalRequest, hooks: PiEvalHooks = {}): Promise<PiEvalOutcome> {
  await mkdir(request.outputDir, { recursive: true });
  const targetScoresPath = request.targetScoresPath ?? resolve(
    request.outputDir,
    'target-scores',
    `${request.envId}--${request.split ?? 'default'}-${randomUUID()}.jsonl`,
  );
  const previousResults = new Set(await savedResultPaths(request));
  const args = [
    'eval', 'run', request.envId,
    '--plain',
    '--disable-tui',
    '--provider', 'openai',
    '--api-base-url', request.baseUrl,
    '--api-key-var', request.apiKeyVar,
    '--model', request.model,
    '--num-examples', String(request.numExamples),
    '--rollouts-per-example', String(request.rolloutsPerExample),
    '--max-concurrent', String(request.maxConcurrent),
    '--save-results',
    '--output-dir', request.outputDir,
  ];
  if (request.split) args.push('--env-args', JSON.stringify({ split: request.split }));
  const prime = await runPrimeProcess({
    command: [piBin(), ...args],
    cwd: request.envDir,
    env: {
      PYTHONUNBUFFERED: '1',
      PRIME_DISABLE_VERSION_CHECK: '1',
      PYTHONPATH: request.envDir,
      [request.apiKeyVar]: request.apiKey,
      LAB_JUDGE_BASE_URL: request.judge.baseUrl,
      LAB_JUDGE_API_KEY: request.judge.apiKey,
      LAB_JUDGE_MODEL: request.judge.model,
      LAB_TARGET_SCORES_PATH: targetScoresPath,
      LAB_EVAL_ENV_ID: request.envId,
      LAB_EVAL_SPLIT: request.split ?? 'default',
    },
    timeoutMs: request.timeoutMs,
    diagnostic: {
      directory: resolve(request.outputDir, 'diagnostics'),
      name: `${request.envId}-${request.split ?? 'default'}-prime`,
      metadata: {
        kind: 'prime_eval',
        env_id: request.envId,
        model: request.model,
        provider_host: providerHost(request.baseUrl),
        api_key_var: request.apiKeyVar,
        split: request.split,
        timeout_ms: request.timeoutMs,
      },
    },
    onLine: hooks.onLine,
    onSpawn: hooks.onSpawn,
  });
  try {
    return await readOutcome({ ...request, targetScoresPath }, previousResults);
  } catch (error) {
    await recordError(prime.diagnostic, 'result parsing', error);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message} Prime diagnostics: ${prime.diagnostic.path}.`);
  }
}
