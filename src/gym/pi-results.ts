/** Prime result discovery and parsing, kept separate from subprocess lifecycle. */
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { PiEvalOutcome, PiEvalRequest, PiRollout } from './pi.ts';

type SavedResult = { resultsPath: string; at: number };

/**
 * Prime stores each invocation below an additional run-id directory:
 * `evals/<env>--<model>/<run-id>/results.jsonl`.
 *
 * Keep the direct path as a compatibility fallback for older Prime output,
 * but discover the nested layout that current Prime writes. Empty files are
 * ignored because Prime creates results.jsonl before the first rollout lands.
 */
export async function savedResultPaths(request: PiEvalRequest): Promise<string[]> {
  const evalsRoot = resolve(request.outputDir, 'evals');
  const runs = await readdir(evalsRoot, { withFileTypes: true }).catch(() => []);
  const prefix = `${request.envId}--`;
  const paths: string[] = [];
  for (const entry of runs) {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
    const envDir = resolve(evalsRoot, entry.name);
    const candidates = [envDir];
    const nested = await readdir(envDir, { withFileTypes: true }).catch(() => []);
    for (const child of nested) {
      if (child.isDirectory()) candidates.push(resolve(envDir, child.name));
    }
    for (const dir of candidates) {
      const resultPath = resolve(dir, 'results.jsonl');
      const info = await stat(resultPath).catch(() => null);
      if (info?.isFile() && info.size > 0) paths.push(resultPath);
    }
  }
  return paths;
}

export async function readOutcome(request: PiEvalRequest, previousResults = new Set<string>()): Promise<PiEvalOutcome> {
  const evalsRoot = resolve(request.outputDir, 'evals');
  const candidates: SavedResult[] = [];
  for (const resultsPath of await savedResultPaths(request)) {
    if (previousResults.has(resultsPath)) continue;
    const at = await stat(resultsPath).then((file) => file.mtimeMs).catch(() => 0);
    if (at) candidates.push({ resultsPath, at });
  }
  const newest = candidates.sort((a, b) => b.at - a.at)[0];
  if (!newest) throw new Error(`No new saved results under ${evalsRoot} for ${request.envId}.`);
  const resultsPath = newest.resultsPath;
  const raw = await readFile(resultsPath, 'utf8');
  const rollouts: PiRollout[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as { example_id?: number; reward?: number; error?: string | null };
    rollouts.push({
      exampleId: Number(row.example_id ?? 0),
      reward: Number(row.reward ?? 0),
      error: typeof row.error === 'string' ? row.error : null,
    });
  }
  if (!rollouts.length) throw new Error(`Results for ${request.envId} contained no rollouts.`);
  const metadataRaw = await readFile(resolve(dirname(resultsPath), 'metadata.json'), 'utf8').catch(() => '{}');
  const metadata = JSON.parse(metadataRaw) as { avg_reward?: number; pass_at_k?: Record<string, number>; time?: number };
  return {
    resultsPath,
    rollouts,
    avgReward: Number(metadata.avg_reward ?? mean(rollouts.map((r) => r.reward))),
    passAtK: metadata.pass_at_k ?? {},
    seconds: Number(metadata.time ?? 0),
  };
}

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
