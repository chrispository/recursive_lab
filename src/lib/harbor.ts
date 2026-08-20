/**
 * The Harbor benchmark format.
 *
 * A Harbor benchmark is a `tasks/` tree where every leaf directory holds a
 * `task.json` describing one task and its grading criteria:
 *
 *   tasks/antitrust-competition/analyze-antitrust-hsr-strategy/task.json
 *   tasks/antitrust-competition/extract-market-share-data/scenario-01/task.json
 *
 * Depth varies — some tasks have per-scenario subdirectories — so the task id
 * is the path below `tasks/` with separators replaced by `__`, which is the
 * convention NeMo Gym itself uses.
 *
 * This module reads a staged directory and returns plain data. It performs no
 * SQL, no HTTP, and never executes anything out of the snapshot. Adding a
 * second benchmark format means adding a sibling file, not editing this one.
 */
import { basename } from 'node:path';
import type { BenchmarkFormat, Detection, ImportedCriterion, ImportedTask, ReadOptions } from './formats.ts';

/** Files this format needs staged. Everything else can be streamed past. */
export const keep = (path: string) => basename(path) === 'task.json';

const LABEL = 'Harbor tasks';

type RawTask = {
  title?: string;
  work_type?: string;
  tags?: unknown;
  deliverables?: unknown;
  metadata?: Record<string, unknown>;
  criteria?: Record<string, unknown>[];
};

/** `tasks/a/b/c/task.json` → `a__b__c`. */
function taskIdOf(relativePath: string): string {
  return relativePath
    .replace(/^tasks\//, '')
    .replace(/\/task\.json$/, '')
    .replaceAll('/', '__');
}

function criteriaOf(raw: RawTask): ImportedCriterion[] {
  const list = Array.isArray(raw.criteria) ? raw.criteria : [];
  return list.map((criterion, index) => ({
    // Criterion ids are unique only within their task; C-001 exists on every
    // one. The fallback keeps position meaningful when a source omits the id.
    criterionId: String(criterion.id ?? `C-${String(index + 1).padStart(3, '0')}`),
    title: String(criterion.title ?? ''),
    matchCriteria: String(criterion.match_criteria ?? ''),
    position: index,
    source: criterion,
  }));
}

/** Every `tasks/**‍/task.json` under `root`, in stable path order. */
async function taskFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  for await (const path of new Bun.Glob('tasks/**/task.json').scan(root)) found.push(path);
  return found.sort();
}

/**
 * Read every task in a staged snapshot.
 *
 * `onProgress` fires per task so a 1700-task read can report movement instead
 * of going silent.
 */
export async function read(
  root: string,
  options: ReadOptions & { onProgress?: (done: number, total: number) => void } = {},
): Promise<ImportedTask[]> {
  const all = await taskFiles(root);
  // Slice before reading, not after: the point of a limit is to not open 1700
  // files. `position` stays the index within the full set either way.
  const files = options.limit === undefined ? all : all.slice(0, options.limit);
  const tasks: ImportedTask[] = [];
  const onProgress = options.onProgress;

  for (const [index, relative] of files.entries()) {
    let raw: RawTask;
    let sourceContent: string;
    try {
      sourceContent = await Bun.file(`${root}/${relative}`).text();
      raw = JSON.parse(sourceContent) as RawTask;
    } catch {
      // One unparseable task.json should not abort an import of thousands;
      // the count difference is reported by detect() and the import trace.
      continue;
    }
    const taskId = taskIdOf(relative);
    tasks.push({
      taskId,
      name: raw.title || taskId,
      sourcePath: relative.replace(/\/task\.json$/, ''),
      sourceContent,
      position: index,
      metadata: {
        work_type: raw.work_type ?? '',
        tags: raw.tags ?? [],
        deliverables: raw.deliverables ?? {},
        harbor: raw.metadata ?? {},
      },
      criteria: criteriaOf(raw),
    });
    onProgress?.(index + 1, files.length);
  }
  return tasks;
}

/** Does this snapshot look like a Harbor benchmark, and how big is it? */
export async function detect(root: string): Promise<Detection> {
  const empty: Detection = {
    detected: false,
    format: 'harbor',
    label: LABEL,
    taskCount: 0,
    criterionCount: 0,
    tasksWithoutCriteria: 0,
    reason: '',
  };

  const files = await taskFiles(root);
  if (files.length === 0) return { ...empty, reason: 'no tasks/**/task.json tree' };

  const tasks = await read(root);
  if (tasks.length === 0) {
    return { ...empty, reason: `found ${files.length} task.json files but none held valid JSON` };
  }

  return {
    ...empty,
    detected: true,
    taskCount: tasks.length,
    criterionCount: tasks.reduce((sum, task) => sum + task.criteria.length, 0),
    tasksWithoutCriteria: tasks.filter((task) => task.criteria.length === 0).length,
    reason: files.length === tasks.length ? '' : `${files.length - tasks.length} task.json files could not be parsed.`,
  };
}

export const format: BenchmarkFormat = { id: 'harbor', label: LABEL, keep, detect, read };
