/**
 * Read a gym eval JSONL and the Harbor trial scores it points at.
 *
 * Rollouts are unordered — sort by `(_ng_task_index, _ng_rollout_index)`.
 * Criterion wording is taken from the trial's scores.json (what the judge
 * saw), not from the catalog.
 */
import { fileURLToPath } from 'node:url';

export type CriterionScore = {
  criterionId: string;
  title: string;
  result: 'pass' | 'fail' | 'error';
  reasoning: string;
  judgeError: boolean;
  errorType: string | null;
};

export type Rollout = {
  taskId: string;
  trialName: string;
  reward: number | null;
  result: 'passed' | 'failed' | 'error' | 'skipped';
  error: string;
  trialDir: string | null;
  criteria: CriterionScore[];
};

type Json = Record<string, unknown>;

const asObject = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};

const asString = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function taskIdOf(row: Json, metadata: Json): string {
  const named = asString(metadata.task_name);
  if (named) return named;
  const instance = asString(row.instance_id);
  const sep = instance.indexOf('::');
  return sep >= 0 ? instance.slice(sep + 2) : instance;
}

function trialDirOf(metadata: Json): string | null {
  const uri = asString(metadata.trial_uri);
  if (!uri) return null;
  try {
    if (uri.startsWith('file:')) return fileURLToPath(uri);
    if (uri.startsWith('/')) return uri;
  } catch {
    return null;
  }
  return null;
}

function rolloutError(row: Json): string {
  const response = asObject(row.response);
  const error = response.error;
  if (typeof error === 'string' && error) return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return '';
}

function criterionOf(raw: Json): CriterionScore {
  const verdict = asString(raw.verdict, 'fail').toLowerCase();
  const judgeError = raw.judge_error === true;
  let result: CriterionScore['result'] = 'fail';
  if (judgeError) result = 'error';
  else if (verdict === 'pass') result = 'pass';
  else if (verdict === 'fail') result = 'fail';
  else result = 'error';
  return {
    criterionId: asString(raw.id),
    title: asString(raw.title),
    result,
    reasoning: asString(raw.reasoning),
    judgeError,
    errorType: asString(raw.error_type) || null,
  };
}

async function scoresOf(trialDir: string | null): Promise<CriterionScore[]> {
  if (!trialDir) return [];
  const file = Bun.file(`${trialDir}/verifier/scores.json`);
  if (!(await file.exists())) return [];
  try {
    const body = (await file.json()) as Json;
    const list = Array.isArray(body.criteria_results) ? body.criteria_results : [];
    return list.filter((item): item is Json => !!item && typeof item === 'object').map(criterionOf);
  } catch {
    return [];
  }
}

function resultOf(error: string, criteria: CriterionScore[], reward: number | null): Rollout['result'] {
  if (error) return 'error';
  if (criteria.some((item) => item.result === 'error')) return 'error';
  if (criteria.length === 0) {
    if (reward === 1) return 'passed';
    if (reward === 0) return 'failed';
    return 'error';
  }
  if (criteria.every((item) => item.result === 'pass')) return 'passed';
  return 'failed';
}

/** Parse one eval output file into task/trial rollouts, sorted stably. */
export async function read(outputPath: string): Promise<Rollout[]> {
  const file = Bun.file(outputPath);
  if (!(await file.exists())) return [];
  const text = await file.text();
  const pending: { index: number; repeat: number; row: Json }[] = [];

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let row: Json;
    try {
      row = JSON.parse(line) as Json;
    } catch {
      continue;
    }
    pending.push({
      index: asNumber(row._ng_task_index) ?? pending.length,
      repeat: asNumber(row._ng_rollout_index) ?? 0,
      row,
    });
  }

  pending.sort((a, b) => a.index - b.index || a.repeat - b.repeat);

  const rollouts: Rollout[] = [];
  for (const item of pending) {
    const metadata = asObject(item.row.metadata);
    const trialDir = trialDirOf(metadata);
    const criteria = await scoresOf(trialDir);
    const error = rolloutError(item.row);
    const reward = asNumber(item.row.reward);
    const trialName = asString(metadata.trial_name) || `trial-${item.repeat + 1}`;
    rollouts.push({
      taskId: taskIdOf(item.row, metadata),
      trialName,
      reward,
      result: resultOf(error, criteria, reward),
      error,
      trialDir,
      criteria,
    });
  }
  return rollouts;
}
