/**
 * Read a gym eval JSONL and the Harbor trial scores it points at.
 *
 * Rollouts are unordered — sort by `(_ng_task_index, _ng_rollout_index)`.
 * Criterion wording is taken from the trial's scores.json (what the judge
 * saw), not from the catalog.
 */
import { fileURLToPath } from 'node:url';

/** Where gym puts the non-fatal failures it keeps out of the main file. */
const failuresPathOf = (outputPath: string) => outputPath.replace(/\.jsonl$/, '') + '_failures.jsonl';

type Cursor = { path: string; offset: number; lines: number };

/**
 * Count the newlines appended since the last call, and remember where we
 * stopped. Only complete lines count: gym flushes after each rollout, but a
 * read can still land mid-write, and half a rollout is not a rollout.
 */
async function advance(cursor: Cursor): Promise<void> {
  const file = Bun.file(cursor.path);
  const size = file.size;
  // A file that shrank was recreated under us; start it over rather than
  // reporting a count from a run that no longer exists.
  if (size < cursor.offset) {
    cursor.offset = 0;
    cursor.lines = 0;
  }
  if (size <= cursor.offset) return;

  const chunk = await file.slice(cursor.offset, size).text();
  const lastBreak = chunk.lastIndexOf('\n');
  if (lastBreak < 0) return;
  for (let i = 0; i <= lastBreak; i += 1) if (chunk[i] === '\n') cursor.lines += 1;
  cursor.offset += Buffer.byteLength(chunk.slice(0, lastBreak + 1));
}

/**
 * A live count of the rollouts gym has finished, for the progress bar.
 *
 * gym appends one line per rollout and flushes it immediately, so the files on
 * disk are an exact count with nothing to parse. The returned closure reads
 * only the bytes added since it last ran, so polling a run whose output is
 * hundreds of megabytes stays cheap.
 *
 * The count is a **lower bound**. A rollout gym drops entirely (`no_persist`)
 * is written to neither file, so a finished run can land under its total. Never
 * treat `count() === total` as the end of the run — the process exiting is.
 */
export function counter(outputPath: string): () => Promise<number> {
  const cursors: Cursor[] = [
    { path: outputPath, offset: 0, lines: 0 },
    { path: failuresPathOf(outputPath), offset: 0, lines: 0 },
  ];
  return async () => {
    for (const cursor of cursors) await advance(cursor);
    return cursors.reduce((total, cursor) => total + cursor.lines, 0);
  };
}

export function completeLines(outputPath: string): Promise<number> {
  return counter(outputPath)();
}

export type CriterionScore = {
  criterionId: string;
  title: string;
  result: 'pass' | 'fail' | 'error';
  reasoning: string;
  /** Which model produced this verdict, when the scores file records one. */
  judgeModel: string;
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

const messageOf = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'message' in value) {
    return String((value as { message: unknown }).message);
  }
  return '';
};

/**
 * Why this rollout produced no verdict, or '' if it ran to completion.
 *
 * Two fields carry a hard failure and only one of them is the OpenAI-shaped
 * one, which is the whole trap here:
 *
 *   * `response.error` — the model call itself failed.
 *   * `metadata.harbor_error` — the *harness* failed around the model. A
 *     dataset that resolved to zero runnable tasks, a container that would not
 *     start, a verifier that never ran. Gym still reports a well-formed
 *     response (`status: "completed"`, zero tokens) with `reward: 0.0`.
 *
 * Reading only the first is why a harness failure arrived here indistinguishable
 * from a model that scored zero, and was recorded as a graded `failed` — a
 * verdict about the model that the run never earned, on a task the model was
 * never shown. An eval that reports that is worse than one that reports nothing.
 */
function rolloutError(row: Json): string {
  return messageOf(asObject(row.response).error) || messageOf(asObject(row.metadata).harbor_error);
}

/**
 * Walls the agent hit that ended its turn early. Unlike the errors above these
 * are not fatal to grading: the verifier may still have scored the partial work,
 * so they only decide the outcome when no criteria came back.
 */
const LIMITS: [key: string, label: string][] = [
  ['context_length_exceeded_error', 'context length exceeded'],
  ['memory_limit_exceeded_error', 'memory limit exceeded'],
  ['agent_timeout_error', 'agent timed out'],
];

function rolloutLimit(row: Json): string {
  for (const [key, label] of LIMITS) if (asNumber(row[key])) return label;
  return '';
}

function criterionOf(raw: Json, fallbackJudge: string): CriterionScore {
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
    // Per-criterion first; Harbor usually records the judge once for the file.
    judgeModel: asString(raw.judge_model) || asString(raw.model) || fallbackJudge,
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
    const fallbackJudge = asString(body.judge_model) || asString(body.model);
    const list = Array.isArray(body.criteria_results) ? body.criteria_results : [];
    return list
      .filter((item): item is Json => !!item && typeof item === 'object')
      .map((item) => criterionOf(item, fallbackJudge));
  } catch {
    return [];
  }
}

function resultOf(
  error: string,
  limit: string,
  criteria: CriterionScore[],
  reward: number | null,
): Rollout['result'] {
  if (error) return 'error';
  if (criteria.some((item) => item.result === 'error')) return 'error';
  if (criteria.length === 0) {
    // No criteria and a wall the agent hit means nothing graded this rollout;
    // `reward: 0` here is gym's default, not a judge's verdict.
    if (limit) return 'error';
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
    const fatal = rolloutError(item.row);
    const limit = rolloutLimit(item.row);
    const reward = asNumber(item.row.reward);
    const result = resultOf(fatal, limit, criteria, reward);
    // A limit only reaches the stored error text when it is what decided the
    // outcome; alongside real criteria it is context, not the reason.
    const error = fatal || (criteria.length === 0 ? limit : '');
    const trialName = asString(metadata.trial_name) || `trial-${item.repeat + 1}`;
    rollouts.push({
      taskId: taskIdOf(item.row, metadata),
      trialName,
      reward,
      result,
      error,
      trialDir,
      criteria,
    });
  }
  return rollouts;
}
