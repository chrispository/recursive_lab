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
import { all, insert, now, run, value, type Row } from '../../db/client.ts';
import { code } from '../../db/ids.ts';
import { isProcessGroupAlive, signalProcessGroup } from '../../gym/lifecycle.ts';
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

/**
 * Terminal steps, kept generic because this layer serves every job kind. A
 * caller with better words for its own ending passes them to `succeed`/`fail`.
 */
const DONE = 'Done';
const FAILED = 'Failed';

export type Trace = {
  jobId: number;
  jobCode: string;
  /** Append one line. `echo` also prints it, for scripts run in a terminal. */
  log: (line: string, stream?: 'out' | 'err') => Promise<void>;
  /** Update the human-readable phase and 0..1 progress. */
  step: (step: string, progress?: number) => Promise<void>;
  /** Publish an incremental result while the job is still running. */
  setResult: (result: unknown) => Promise<void>;
  /** Close the job as succeeded, storing whatever the caller wants to keep. */
  succeed: (result?: unknown, step?: string) => Promise<void>;
  /** Close the job as failed, recording the error text. */
  fail: (error: unknown, step?: string) => Promise<void>;
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

  /**
   * Success completes the progress bar; failure leaves it where it stopped.
   * Resetting it to 0 erased how far the job actually got, which is the one
   * thing you want to know about a job that died.
   *
   * Closing also overwrites `step`. The views render `step || status`, so a
   * job that closed while its last step still read "Saving results" went on
   * advertising that phase forever — a finished run was indistinguishable from
   * a hung one, which is the single most expensive thing this ledger can get
   * wrong. A terminal step is the only honest value once `finished_at` is set.
   */
  const close = async (status: JobStatus, step: string, patch: string, args: unknown[]) => {
    const progress = status === 'succeeded' ? ', progress = 1' : '';
    await run(
      `UPDATE jobs SET status = ?, step = ?${progress}, finished_at = ?, ${patch}
        WHERE id = ? AND status IN ('running', 'queued')`,
      [status, step, now(), ...(args as never[]), jobId],
    );
  };

  return {
    jobId,
    jobCode: code('jobs', jobId),
    log,
    step: async (step, progress = 0) => {
      await run(`UPDATE jobs SET step = ?, progress = ? WHERE id = ?`, [step, progress, jobId]);
    },
    setResult: async (result) => {
      await run(`UPDATE jobs SET result_json = ? WHERE id = ?`, [JSON.stringify(result ?? {}), jobId]);
    },
    succeed: async (result, step = DONE) => {
      await close('succeeded', step, 'exit_code = 0, result_json = ?', [JSON.stringify(result ?? {})]);
    },
    fail: async (error, step = FAILED) => {
      const message = error instanceof Error ? error.message : String(error);
      await log(message, 'err');
      await close('failed', step, 'exit_code = 1, error = ?', [message]);
    },
    setPgid: async (pgid) => {
      await run(`UPDATE jobs SET pgid = ? WHERE id = ?`, [pgid, jobId]);
    },
  };
}

/** Update step/progress on an already-open job, without a Trace handle. */
export async function setStep(jobId: number, step: string, progress: number): Promise<void> {
  await run(`UPDATE jobs SET step = ?, progress = ? WHERE id = ?`, [step, progress, jobId]);
}

/**
 * Fail every job the previous process left open.
 *
 * A job only advances while the promise that opened it is alive. Bun's
 * `--watch` re-enters the app in the same PID without running any exit
 * handler, so a source edit during a run drops that promise mid-flight: the
 * row stays `running` forever, its progress frozen, and the env lab polls a
 * status that will never change while the stage's buttons stay disabled. A
 * crash leaves the same wreckage.
 *
 * The orphaned child cannot be observed either — whatever reads its output and
 * records its results is gone — so a still-live process group is stopped
 * rather than left to spend API budget on results nobody will collect.
 */
export async function reconcileOrphans(): Promise<number> {
  const open = await all<Row & { id: number; kind: string; pgid: number | null; step: string }>(
    `SELECT id, kind, pgid, step FROM jobs WHERE status IN ('running', 'queued')`,
  );
  let closed = 0;
  for (const row of open) {
    const jobId = Number(row.id);
    const pgid = row.pgid === null ? null : Number(row.pgid);
    const orphan = pgid !== null && isProcessGroupAlive(pgid);
    if (orphan) signalProcessGroup(pgid, 'SIGTERM');
    const message = `The server restarted while this ${row.kind} job was running, so it can no longer be observed.${
      orphan ? ` Its process group (${pgid}) was stopped.` : ''
    }`;
    const seq = Number(await value<number>(`SELECT COALESCE(MAX(seq), 0) FROM job_log_lines WHERE job_id = ?`, [jobId]) ?? 0);
    await run(
      `INSERT INTO job_log_lines (job_id, seq, at, stream, line) VALUES (?, ?, ?, 'err', ?)`,
      [jobId, seq + 1, now(), message],
    );
    closed += await run(
      `UPDATE jobs
          SET status = 'failed', step = ?, exit_code = 1, error = ?, finished_at = ?
        WHERE id = ? AND status IN ('running', 'queued')`,
      ['Interrupted', message, now(), jobId],
    );
  }
  return closed;
}
