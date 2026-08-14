import { all, db, insert, now, one, run, value, type Row } from '../../db/client.ts';
import { code } from '../../db/ids.ts';
import type { BenchmarkCatalog, BenchmarkHeader, TaskWrite } from './model.ts';

/** libSQL is happiest with a few hundred statements per batch, not 100k. */
const BATCH = 500;
/** Everything from a URL import is one split until a source declares others. */
export const DATASET = 'validation';

/**
 * An import is identified by source *and* revision.
 *
 * Importing the same repository at a newer commit is a new benchmark, not an
 * update — the old rows stay pinned so past runs keep meaning what they meant.
 */
export async function findBySourceRevision(
  identifier: string,
  revision: string,
): Promise<{ benchmarkId: number; benchmarkCode: string } | null> {
  const row = await one<Row & { id: number }>(
    `SELECT id FROM benchmarks WHERE source_identifier = ? AND revision = ? LIMIT 1`,
    [identifier, revision],
  );
  return row ? { benchmarkId: row.id, benchmarkCode: code('benchmarks', row.id) } : null;
}

/**
 * Opens a benchmark in `importing` and not runnable.
 *
 * It becomes `ready` once its tasks land, but stays `runnable = 0` until an
 * adapter names the gym resources server that can execute it.
 */
export async function insertBenchmark(header: BenchmarkHeader): Promise<number> {
  const at = now();
  return insert(
    `INSERT INTO benchmarks (name, lab, source_url, source_kind, source_identifier, revision,
                             detected_format, adapter, status, runnable, snapshot_path,
                             description, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'importing', 0, ?, ?, ?, ?, ?)`,
    [
      header.name, header.lab, header.url, header.kind, header.identifier, header.revision,
      header.detectedFormat, header.adapter, header.snapshotPath, header.description,
      JSON.stringify({ pinned_url: header.pinnedUrl }), at, at,
    ],
  );
}

/** Removes a benchmark and everything that cascades from it. */
export async function deleteBenchmark(benchmarkId: number): Promise<void> {
  await run(`DELETE FROM benchmarks WHERE id = ?`, [benchmarkId]);
}

/**
 * Writes one page of tasks and their criteria.
 *
 * Criteria carry the composite task key rather than a task row id because
 * `benchmark_tasks` is keyed by `(benchmark_id, dataset, task_id)` — the
 * benchmark's own opaque ids, which every downstream artifact refers to.
 */
export async function insertTasks(benchmarkId: number, tasks: TaskWrite[]): Promise<number> {
  const at = now();
  const taskRows = tasks.map((task) => ({
    sql: `INSERT INTO benchmark_tasks (benchmark_id, dataset, task_id, name, source_path,
                                       position, metadata_json)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      benchmarkId, task.dataset, task.taskId, task.name, task.sourcePath, task.position,
      JSON.stringify(task.metadata),
    ],
  }));
  for (let start = 0; start < taskRows.length; start += BATCH) {
    await db.batch(taskRows.slice(start, start + BATCH), 'write');
  }

  const criterionRows = tasks.flatMap((task) =>
    task.criteria.map((criterion) => ({
      sql: `INSERT INTO benchmark_task_criteria (benchmark_id, dataset, task_id, criterion_id,
                                                 title, match_criteria, position, source_json,
                                                 created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        benchmarkId, task.dataset, task.taskId, criterion.criterionId, criterion.title,
        criterion.matchCriteria, criterion.position, JSON.stringify(criterion.source), at, at,
      ],
    })),
  );
  for (let start = 0; start < criterionRows.length; start += BATCH) {
    await db.batch(criterionRows.slice(start, start + BATCH), 'write');
  }
  return criterionRows.length;
}

export async function markReady(benchmarkId: number, snapshotPath: string): Promise<void> {
  await run(
    `UPDATE benchmarks SET status = 'ready', snapshot_path = ?, updated_at = ? WHERE id = ?`,
    [snapshotPath, now(), benchmarkId],
  );
}

export async function markFailed(benchmarkId: number): Promise<void> {
  await run(`UPDATE benchmarks SET status = 'failed', runnable = 0, updated_at = ? WHERE id = ?`, [now(), benchmarkId]);
}

export const countTasks = async (benchmarkId: number) =>
  (await value<number>(`SELECT COUNT(*) FROM benchmark_tasks WHERE benchmark_id = ?`, [benchmarkId])) ?? 0;

export const countCriteria = async (benchmarkId: number) =>
  (await value<number>(`SELECT COUNT(*) FROM benchmark_task_criteria WHERE benchmark_id = ?`, [benchmarkId])) ?? 0;

type CatalogDbRow = Row & {
  benchmark_id: number;
  benchmark_name: string;
  lab: string;
  source_url: string;
  source_kind: BenchmarkCatalog['sourceKind'];
  source_identifier: string;
  revision: string;
  detected_format: string;
  adapter: string;
  status: BenchmarkCatalog['status'];
  runnable: number;
  description: string;
  task_count: number;
  criterion_count: number;
};

/**
 * The catalog, with counts done in SQL.
 *
 * The previous version left-joined every task row and grouped in TypeScript,
 * so rendering one count dragged a benchmark's entire task list across the
 * boundary. Sample tasks are a separate, bounded query.
 */
export async function listCatalogs(sampleTasks = 5): Promise<BenchmarkCatalog[]> {
  const rows = await all<CatalogDbRow>(`
    SELECT b.id AS benchmark_id, b.name AS benchmark_name, b.lab, b.source_url,
           b.source_kind, b.source_identifier, b.revision, b.detected_format,
           b.adapter, b.status, b.runnable, b.description,
           (SELECT COUNT(*) FROM benchmark_tasks t WHERE t.benchmark_id = b.id) AS task_count,
           (SELECT COUNT(*) FROM benchmark_task_criteria c WHERE c.benchmark_id = b.id) AS criterion_count
      FROM benchmarks b
     ORDER BY b.created_at DESC, b.id DESC
  `);

  const catalogs: BenchmarkCatalog[] = [];
  for (const row of rows) {
    catalogs.push({
      benchmarkId: row.benchmark_id,
      benchmarkCode: code('benchmarks', row.benchmark_id),
      name: row.benchmark_name,
      lab: row.lab,
      sourceUrl: row.source_url,
      sourceKind: row.source_kind,
      sourceIdentifier: row.source_identifier,
      revision: row.revision,
      detectedFormat: row.detected_format,
      adapter: row.adapter,
      status: row.status,
      runnable: row.runnable === 1,
      description: row.description,
      taskCount: row.task_count,
      criterionCount: row.criterion_count,
      tasks: await listTasks(row.benchmark_id, sampleTasks),
    });
  }
  return catalogs;
}

/** A bounded page of tasks. A list view never receives a whole benchmark. */
export async function listTasks(benchmarkId: number, limit = 50, offset = 0) {
  const rows = await all<Row & { dataset: string; task_id: string; name: string; source_path: string; position: number }>(
    `SELECT dataset, task_id, name, source_path, position
       FROM benchmark_tasks WHERE benchmark_id = ?
      ORDER BY position ASC, task_id ASC LIMIT ? OFFSET ?`,
    [benchmarkId, limit, offset],
  );
  return rows.map((row) => ({
    dataset: row.dataset,
    taskId: row.task_id,
    name: row.name,
    sourcePath: row.source_path,
    position: row.position,
  }));
}
