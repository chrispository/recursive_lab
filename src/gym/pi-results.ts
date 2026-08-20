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
  const rollouts = await readSavedResult(resultsPath, request.targetScoresPath);
  if (!rollouts.length) throw new Error(`Results for ${request.envId} contained no rollouts.`);
  const metadataRaw = await readFile(resolve(dirname(resultsPath), 'metadata.json'), 'utf8').catch(() => '{}');
  const metadata = JSON.parse(metadataRaw) as { avg_reward?: number; pass_at_k?: Record<string, number>; time?: number };
  return {
    resultsPath,
    targetScoresPath: request.targetScoresPath ?? null,
    rollouts,
    avgReward: Number(metadata.avg_reward ?? mean(rollouts.flatMap((r) => r.reward === null ? [] : [r.reward]))),
    passAtK: metadata.pass_at_k ?? {},
    seconds: Number(metadata.time ?? 0),
  };
}

type RawResult = {
  order: number;
  exampleId: number;
  rolloutIndex: number;
  reward: number | null;
  error: string | null;
};

type TargetEvent = {
  callIndex: number | null;
  exampleId: number | null;
  rolloutIndex: number | null;
  documentId: number | null;
  targetIndex: number;
  targetText: string;
  score: number | null;
  verdict: PiRollout['targetScores'][number]['verdict'];
  judgeModel: string;
  error: string;
  details: Record<string, unknown>;
};

async function targetEventsOf(path: string | undefined): Promise<TargetEvent[]> {
  if (!path || !(await Bun.file(path).exists())) return [];
  const raw = await readFile(path, 'utf8').catch(() => '');
  const events: TargetEvent[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Record<string, unknown>;
      const verdict = row.verdict === 'pass' || row.verdict === 'fail' || row.verdict === 'error' ? row.verdict : 'error';
      events.push({
        callIndex: numberOrNull(row.call_index),
        exampleId: numberOrNull(row.example_id),
        rolloutIndex: numberOrNull(row.rollout_index),
        documentId: numberOrNull(row.document_id),
        targetIndex: Number(row.target_index ?? 0),
        targetText: typeof row.target_text === 'string' ? row.target_text : '',
        score: numberOrNull(row.score),
        verdict,
        judgeModel: typeof row.judge_model === 'string' ? row.judge_model : '',
        error: typeof row.error === 'string' ? row.error : '',
        details: row.details && typeof row.details === 'object' && !Array.isArray(row.details)
          ? row.details as Record<string, unknown>
          : {},
      });
    } catch {
      // A partially flushed sidecar line is not a target score.
    }
  }
  return events;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function keyOf(exampleId: number | null, rolloutIndex: number | null): string | null {
  return exampleId === null || rolloutIndex === null ? null : `${exampleId}:${rolloutIndex}`;
}

/** Parse one saved Prime result and its optional target-score sidecar. */
export async function readSavedResult(resultsPath: string, targetScoresPath?: string): Promise<PiRollout[]> {
  const raw = await readFile(resultsPath, 'utf8');
  const pending: RawResult[] = [];
  for (const [order, line] of raw.split('\n').entries()) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as Record<string, unknown>;
    pending.push({
      order,
      exampleId: Number(row.example_id ?? row._ng_task_index ?? 0),
      rolloutIndex: Number(row._ng_rollout_index ?? row.rollout_index ?? pending.length),
      reward: numberOrNull(row.reward),
      error: typeof row.error === 'string' ? row.error : null,
    });
  }
  pending.sort((a, b) => a.exampleId - b.exampleId || a.rolloutIndex - b.rolloutIndex || a.order - b.order);

  const events = await targetEventsOf(targetScoresPath);
  const exact = new Map<string, TargetEvent[]>();
  const byCall = new Map<number, TargetEvent[]>();
  const unkeyed: TargetEvent[] = [];
  for (const event of events) {
    const key = keyOf(event.exampleId, event.rolloutIndex);
    if (key) exact.set(key, [...(exact.get(key) ?? []), event]);
    else if (event.callIndex !== null) byCall.set(event.callIndex, [...(byCall.get(event.callIndex) ?? []), event]);
    else unkeyed.push(event);
  }

  return pending.map((row, position) => {
    const eventRows = exact.get(keyOf(row.exampleId, row.rolloutIndex) ?? '')
      ?? byCall.get(position)
      ?? (unkeyed.length ? unkeyed.splice(0, unkeyed.length) : []);
    const targetScores = eventRows
      .sort((a, b) => a.targetIndex - b.targetIndex)
      .map((event) => ({
        targetIndex: event.targetIndex,
        targetText: event.targetText,
        score: event.score,
        verdict: event.verdict,
        judgeModel: event.judgeModel,
        error: event.error,
        documentId: event.documentId,
        details: event.details,
      }));
    return {
      exampleId: row.exampleId,
      rolloutIndex: row.rolloutIndex,
      reward: row.reward,
      error: row.error,
      documentId: targetScores.find((target) => target.documentId !== null)?.documentId ?? null,
      trialName: `trial-${row.rolloutIndex + 1}`,
      targetScores,
    };
  });
}

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
