/**
 * Writing side of the execution ledger.
 *
 * Anything long-running is a `jobs` row plus `job_log_lines` rows — see
 * AGENTS.md § Jobs. This module is how a service opens that job, appends to its
 * log, and closes it. `repo.ts` next door stays read-only.
 *
 * A trace is deliberately cheap to use: if tracing were awkward, services would
 * quietly stop doing it and the ledger would lie.
 */
import { insert, now, run } from '../../db/client.ts';
import { code } from '../../db/ids.ts';
import type { JobStatus } from './model.ts';

export type JobKind =
  | 'benchmark_import'
  | 'benchmark_run'
  | 'failure_map'
  | 'data_forge_run'
  | 'env_build'
  | 'env_eval'
  | 'env_publish'
  | 'training';

export type Trace = {
  jobId: number;
  jobCode: string;
  /** Append one line. `echo` also prints it, for scripts run in a terminal. */
  log: (line: string, stream?: 'out' | 'err') => Promise<void>;
  /** Update the human-readable phase and 0..1 progress. */
  step: (step: string, progress?: number) => Promise<void>;
  /** Close the job as succeeded, storing whatever the caller wants to keep. */
  succeed: (result?: unknown) => Promise<void>;
  /** Close the job as failed, recording the error text. */
  fail: (error: unknown) => Promise<void>;
  /** Record the process group so cancel can kill gym's children, not just the pid. */
  setPgid: (pgid: number) => Promise<void>;
};

/**
 * Opens a job in `running` and returns its handle.
 *
 * `subjectType` is the table name and `subjectId` its integer id, so a job can
 * point at any domain row without the schema growing a column per kind.
 */
export async function start(
  kind: JobKind,
  subjectType: string,
  subjectId: number,
  options: { step?: string; params?: unknown; echo?: boolean } = {},
): Promise<Trace> {
  const at = now();
  const jobId = await insert(
    `INSERT INTO jobs (kind, subject_type, subject_id, status, step, progress,
                       params_json, created_at, started_at)
     VALUES (?, ?, ?, 'running', ?, 0, ?, ?, ?)`,
    [kind, subjectType, subjectId, options.step ?? '', JSON.stringify(options.params ?? {}), at, at],
  );

  let seq = 0;
  const log = async (line: string, stream: 'out' | 'err' = 'out') => {
    seq += 1;
    if (options.echo) console.log(line);
    await run(
      `INSERT INTO job_log_lines (job_id, seq, at, stream, line) VALUES (?, ?, ?, ?, ?)`,
      [jobId, seq, now(), stream, line],
    );
  };

  const close = async (status: JobStatus, patch: string, args: unknown[]) => {
    await run(
      `UPDATE jobs SET status = ?, progress = ?, finished_at = ?, ${patch} WHERE id = ?`,
      [status, status === 'succeeded' ? 1 : 0, now(), ...(args as never[]), jobId],
    );
  };

  return {
    jobId,
    jobCode: code('jobs', jobId),
    log,
    step: async (step, progress = 0) => {
      await run(`UPDATE jobs SET step = ?, progress = ? WHERE id = ?`, [step, progress, jobId]);
    },
    succeed: async (result) => {
      await close('succeeded', 'exit_code = 0, result_json = ?', [JSON.stringify(result ?? {})]);
    },
    fail: async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      await log(message, 'err');
      await close('failed', 'exit_code = 1, error = ?', [message]);
    },
    setPgid: async (pgid) => {
      await run(`UPDATE jobs SET pgid = ? WHERE id = ?`, [pgid, jobId]);
    },
  };
}
