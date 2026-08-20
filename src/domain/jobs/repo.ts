import { all, json, now, one, run, type Row } from '../../db/client.ts';
import { code, type Entity } from '../../db/ids.ts';
import type { JobLogLine, JobRow } from './model.ts';

type JobDb = Row & {
  id: number;
  kind: string;
  subject_type: string;
  subject_id: number;
  status: JobRow['status'];
  step: string;
  progress: number;
  exit_code: number | null;
  error: string | null;
  params_json: string;
  result_json: string;
  started_at: string | null;
};

function asJob(row: JobDb): JobRow {
  return {
    jobId: row.id,
    jobCode: code('jobs', row.id),
    kind: row.kind,
    subjectCode: code(row.subject_type as Entity, row.subject_id),
    status: row.status,
    step: row.step,
    progress: row.progress,
    exitCode: row.exit_code,
    error: row.error ?? '',
    params: json<Record<string, unknown>>(row.params_json, {}),
    result: json<Record<string, unknown>>(row.result_json, {}),
    startedAt: row.started_at ?? '',
  };
}

const JOB_COLS = `j.id, j.kind, j.subject_type, j.subject_id, j.status, j.step,
            j.progress, j.exit_code, j.error, j.params_json, j.result_json, j.started_at`;

export async function get(id: number): Promise<JobRow | null> {
  const row = await one<JobDb>(`SELECT ${JOB_COLS} FROM jobs j WHERE j.id = ?`, [id]);
  return row ? asJob(row) : null;
}

type JobControl = Row & { status: JobRow['status']; pgid: number | null };

/** Cancel a live job and return the process group that the service must stop. */
export async function cancel(id: number): Promise<{ changed: boolean; status: JobRow['status']; pgid: number | null } | null> {
  const row = await one<JobControl>(`SELECT status, pgid FROM jobs WHERE id = ?`, [id]);
  if (!row) return null;
  if (row.status !== 'running' && row.status !== 'queued') {
    return { changed: false, status: row.status, pgid: row.pgid === null ? null : Number(row.pgid) };
  }
  const changed = await run(
    `UPDATE jobs
        SET status = 'cancelled', step = 'Cancelled', error = ?, finished_at = ?
      WHERE id = ? AND status IN ('running', 'queued')`,
    ['Cancelled by user.', now(), id],
  );
  return { changed: changed > 0, status: changed > 0 ? 'cancelled' : row.status, pgid: row.pgid === null ? null : Number(row.pgid) };
}

export async function listByBenchmarkRun(benchmarkRunId: number): Promise<JobRow[]> {
  const rows = await all<JobDb>(
    `SELECT ${JOB_COLS}
       FROM jobs j
      WHERE (j.subject_type = 'benchmark_runs' AND j.subject_id = ?)
         OR j.id IN (
              SELECT ee.job_id FROM environment_evaluations ee WHERE ee.benchmark_run_id = ?
            )
         OR j.subject_id IN (
              SELECT fm.id FROM failure_maps fm
               JOIN benchmark_results brs ON brs.id = fm.benchmark_result_id
              WHERE brs.benchmark_run_id = ?
              UNION ALL
              SELECT df.id FROM data_forge_runs df
               JOIN failure_maps fm ON fm.id = df.failure_map_id
               JOIN benchmark_results brs ON brs.id = fm.benchmark_result_id
              WHERE brs.benchmark_run_id = ?
              UNION ALL
              SELECT e.id FROM environments e WHERE e.benchmark_run_id = ?
            )
      ORDER BY j.created_at ASC, j.id ASC`,
    [benchmarkRunId, benchmarkRunId, benchmarkRunId, benchmarkRunId, benchmarkRunId],
  );
  return rows.map(asJob);
}

/**
 * Lines after `seq`, oldest first. A first paint passes `after = 0` and gets
 * the most recent `limit` lines — not the first `limit` — so a job that has
 * been running for an hour still opens on what it is doing now.
 */
export async function linesAfter(jobId: number, after: number, limit = 120): Promise<JobLogLine[]> {
  const rows = await all<Row & JobLogLine>(
    `SELECT seq, at, stream, line FROM (
        SELECT seq, at, stream, line
          FROM job_log_lines
         WHERE job_id = ? AND seq > ?
         ORDER BY seq DESC
         LIMIT ?
      ) t
      ORDER BY seq ASC`,
    [jobId, after, limit],
  );
  return rows.map((row) => ({
    seq: Number(row.seq),
    at: String(row.at),
    stream: row.stream === 'err' ? 'err' : 'out',
    line: String(row.line),
  }));
}
