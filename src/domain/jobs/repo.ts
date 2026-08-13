import { all, type Row } from '../../db/client.ts';
import { code, type Entity } from '../../db/ids.ts';
import type { JobRow } from './model.ts';

type JobDb = Row & {
  id: number;
  kind: string;
  subject_type: string;
  subject_id: number;
  status: JobRow['status'];
  step: string;
  progress: number;
  exit_code: number | null;
};

export async function listByRun(runId: number): Promise<JobRow[]> {
  const rows = await all<JobDb>(
    `SELECT j.id, j.kind, j.subject_type, j.subject_id, j.status, j.step,
            j.progress, j.exit_code
       FROM jobs j
      WHERE (j.subject_type = 'benchmark_runs' AND j.subject_id = ?)
         OR j.subject_id IN (
              SELECT fm.id FROM failure_maps fm
               JOIN benchmarks_results brs ON brs.id = fm.benchmark_result_id
              WHERE brs.benchmark_run_id = ?
              UNION ALL
              SELECT df.id FROM data_forge_runs df
               JOIN failure_maps fm ON fm.id = df.failure_map_id
               JOIN benchmarks_results brs ON brs.id = fm.benchmark_result_id
              WHERE brs.benchmark_run_id = ?
              UNION ALL
              SELECT e.id FROM environments e WHERE e.run_id = ?
              UNION ALL
              SELECT ee.id FROM environment_evaluations ee WHERE ee.run_id = ?
            )
      ORDER BY j.created_at ASC, j.id ASC`,
    [runId, runId, runId, runId, runId],
  );
  return rows.map((row) => ({
    jobCode: code('jobs', row.id),
    kind: row.kind,
    subjectCode: code(row.subject_type as Entity, row.subject_id),
    status: row.status,
    step: row.step,
    progress: row.progress,
    exitCode: row.exit_code,
  }));
}
