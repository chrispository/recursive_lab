/**
 * Counts for the Settings inventory.
 *
 * One statement, one round trip. Every number the panel states is a `COUNT`
 * over a real table rather than a derived or cached figure, so a row that says
 * "none yet" is saying the table is empty and nothing else.
 */
import { all, one } from '../../db/client.ts';

export type InventoryCounts = {
  benchmarks: number;
  tasks: number;
  criteria: number;
  runs: number;
  attempts: number;
  gradedCriteria: number;
  failureMaps: number;
  topics: number;
  failureItems: number;
  forgeRuns: number;
  documents: number;
  environments: number;
};

const COUNTS = `
  SELECT
    (SELECT COUNT(*) FROM benchmarks)              AS benchmarks,
    (SELECT COUNT(*) FROM benchmark_tasks)         AS tasks,
    (SELECT COUNT(*) FROM benchmark_task_criteria) AS criteria,
    (SELECT COUNT(*) FROM benchmark_runs)          AS runs,
    (SELECT COUNT(*) FROM task_results)            AS attempts,
    (SELECT COUNT(*) FROM criterion_results)       AS gradedCriteria,
    (SELECT COUNT(*) FROM failure_maps)            AS failureMaps,
    (SELECT COUNT(*) FROM topics)                  AS topics,
    (SELECT COUNT(*) FROM failure_items)           AS failureItems,
    (SELECT COUNT(*) FROM data_forge_runs)         AS forgeRuns,
    (SELECT COUNT(*) FROM documents)               AS documents,
    (SELECT COUNT(*) FROM environments)            AS environments
`;

export async function counts(): Promise<InventoryCounts> {
  const row = await one<Record<string, number>>(COUNTS);
  const read = (key: keyof InventoryCounts) => Number(row?.[key] ?? 0);
  return {
    benchmarks: read('benchmarks'),
    tasks: read('tasks'),
    criteria: read('criteria'),
    runs: read('runs'),
    attempts: read('attempts'),
    gradedCriteria: read('gradedCriteria'),
    failureMaps: read('failureMaps'),
    topics: read('topics'),
    failureItems: read('failureItems'),
    forgeRuns: read('forgeRuns'),
    documents: read('documents'),
    environments: read('environments'),
  };
}

/**
 * Where each finished run says its recording file was written.
 *
 * Kept as the stored string rather than a resolved path: a run recorded before
 * the gym moved into this repo points outside it, and that discrepancy is
 * exactly what the panel needs to be able to say out loud.
 */
export async function resultPaths(): Promise<string[]> {
  const rows = await all<{ result_path: string | null }>(
    `SELECT result_path FROM benchmark_results ORDER BY id`,
  );
  return rows.map((row) => row.result_path ?? '').filter(Boolean);
}

/** The distinct models that have been put under test, newest run first. */
export async function modelsTested(): Promise<string[]> {
  const rows = await all<{ model: string }>(
    `SELECT model, MAX(id) AS latest FROM benchmark_runs GROUP BY model ORDER BY latest DESC`,
  );
  return rows.map((row) => row.model);
}
