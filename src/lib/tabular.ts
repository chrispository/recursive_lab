/**
 * Row-per-task benchmarks: `.jsonl` and `.json` arrays.
 *
 * This is the shape most question-answering benchmarks ship in — one row per
 * task, with a field holding the prompt and another holding the expected
 * answer. There is no fixed vocabulary for those field names, so the reader
 * looks for the ones the ecosystem actually uses and records what it chose in
 * the task metadata rather than pretending it knew.
 *
 * A row's expected answer becomes a single grading criterion. That is a weaker
 * signal than a Harbor task's explicit rubric, and it is reported as such: the
 * criterion is titled "Expected answer" so nobody mistakes it for one an author
 * wrote.
 */
import { basename } from 'node:path';
import type { BenchmarkFormat, Detection, ImportedTask } from './formats.ts';

/** Directories that hold data rather than source code, plus the repo root. */
const DATA_DIR = /^(data|datasets|dataset|test|tests|eval|evals|benchmark|benchmarks)\//i;
/** Files that are configuration or lockfiles, never benchmark rows. */
const NOT_DATA = /^(package|tsconfig|composer|lerna|renovate|angular)\b|lock\.json$/i;

const isCandidate = (path: string) => {
  const name = basename(path);
  if (NOT_DATA.test(name)) return false;
  if (name.endsWith('.jsonl')) return true;
  // A bare .json is only a candidate in an obvious data directory — otherwise
  // every repository's config files would look like a benchmark.
  return name.endsWith('.json') && DATA_DIR.test(path);
};

/** Field names carrying the task prompt, best first. */
const PROMPT_FIELDS = ['question', 'prompt', 'input', 'instruction', 'query', 'problem', 'text'];
/** Field names carrying the expected answer, best first. */
const ANSWER_FIELDS = ['answer', 'output', 'target', 'label', 'solution', 'expected', 'response'];
/** Field names carrying a stable per-row id, best first. */
const ID_FIELDS = ['id', 'task_id', 'instance_id', 'example_id', 'uid', '_id'];

const firstPresent = (row: Record<string, unknown>, names: string[]) =>
  names.find((name) => typeof row[name] === 'string' && (row[name] as string).trim() !== '') ?? '';

const oneLine = (value: string, limit = 120) => {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
};

/** Parse `.jsonl` line-by-line, or a `.json` file holding a top-level array. */
function parseRows(text: string, path: string): Record<string, unknown>[] {
  if (path.endsWith('.json')) {
    try {
      const parsed = JSON.parse(text) as unknown;
      return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [];
    } catch {
      return [];
    }
  }
  const rows: Record<string, unknown>[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        rows.push(parsed as Record<string, unknown>);
      }
    } catch {
      // A single malformed line does not invalidate the file.
    }
  }
  return rows;
}

async function candidateFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  for await (const path of new Bun.Glob('**/*.{jsonl,json}').scan(root)) {
    if (isCandidate(path)) found.push(path);
  }
  return found.sort();
}

/** `data/train.jsonl` + row 12 → `train__000012`, stable across imports. */
function taskIdOf(path: string, index: number, row: Record<string, unknown>): string {
  const declared = firstPresent(row, ID_FIELDS);
  const stem = basename(path).replace(/\.(jsonl|json)$/, '').replaceAll(/[^A-Za-z0-9_-]+/g, '-');
  return declared ? `${stem}__${declared}` : `${stem}__${String(index).padStart(6, '0')}`;
}

export async function read(root: string): Promise<ImportedTask[]> {
  const tasks: ImportedTask[] = [];
  let position = 0;

  for (const path of await candidateFiles(root)) {
    const rows = parseRows(await Bun.file(`${root}/${path}`).text(), path);
    for (const [index, row] of rows.entries()) {
      const promptField = firstPresent(row, PROMPT_FIELDS);
      if (!promptField) continue; // not a task row
      const answerField = firstPresent(row, ANSWER_FIELDS);
      const prompt = String(row[promptField]);
      const answer = answerField ? String(row[answerField]) : '';

      tasks.push({
        taskId: taskIdOf(path, index, row),
        name: oneLine(prompt),
        sourcePath: path,
        position: position++,
        metadata: {
          // Record the guess, so a wrong mapping is visible rather than silent.
          prompt_field: promptField,
          answer_field: answerField,
          row_index: index,
          source_file: path,
        },
        criteria: answer
          ? [{
              criterionId: 'C-001',
              title: 'Expected answer',
              matchCriteria: answer,
              position: 0,
              source: row,
            }]
          : [],
      });
    }
  }
  return tasks;
}

export async function detect(root: string): Promise<Detection> {
  const base: Detection = {
    detected: false,
    format: 'tabular',
    label: 'JSONL / JSON rows',
    taskCount: 0,
    criterionCount: 0,
    tasksWithoutCriteria: 0,
    reason: '',
  };

  const files = await candidateFiles(root);
  if (files.length === 0) return { ...base, reason: 'no .jsonl or data/*.json files' };

  const tasks = await read(root);
  if (tasks.length === 0) {
    return { ...base, reason: `found ${files.length} data files but no rows with a recognised prompt field` };
  }

  const tasksWithoutCriteria = tasks.filter((task) => task.criteria.length === 0).length;
  return {
    ...base,
    detected: true,
    taskCount: tasks.length,
    criterionCount: tasks.reduce((sum, task) => sum + task.criteria.length, 0),
    tasksWithoutCriteria,
    reason: tasksWithoutCriteria
      ? `${tasksWithoutCriteria} rows have no answer field and cannot be graded.`
      : '',
  };
}

export const format: BenchmarkFormat = {
  id: 'tabular',
  label: 'JSONL / JSON rows',
  keep: isCandidate,
  detect,
  read,
};
