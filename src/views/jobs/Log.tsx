import type { JobLogLine, JobRow } from '../../domain/jobs/model.ts';
import { isLive } from '../../domain/jobs/model.ts';

function LogLine({ line }: { line: JobLogLine }) {
  return (
    <span class="m-log-line" data-seq={String(line.seq)} data-stream={line.stream}>
      {line.line}{'\n'}
    </span>
  );
}

/**
 * Sentinel at the end of the log. Swapping it for new lines plus a new
 * sentinel is how `after` advances without replaying what is already on
 * screen — HTMX has no other way to rewrite its own query string.
 */
export function LogPoll({ jobCode, after }: { jobCode: string; after: number }) {
  return (
    <span
      id="jobs-log-poll"
      hx-get={`/ui/jobs/${jobCode}/log?after=${after}`}
      hx-trigger="every 1s"
      hx-swap="outerHTML"
    />
  );
}

/** New lines plus the next poll sentinel. The GET returns only this. */
export function LogChunk({ job, lines }: { job: JobRow; lines: JobLogLine[] }) {
  const last = lines[lines.length - 1]?.seq ?? 0;
  return (
    <>
      {lines.map((line) => <LogLine line={line} />)}
      {isLive(job) ? <LogPoll jobCode={job.jobCode} after={last} /> : null}
    </>
  );
}

/**
 * Live tail of one job. Own fragment (`#jobs-log` ⇄ `/ui/jobs/:code/log`)
 * so a polling status row never carries log text.
 *
 * Not mounted on the Benchmarks tab — the run ledger is the progress surface
 * there. Keep this for the jobs strip / Results execution ledger when those
 * grow a tail.
 */
export function JobLog({
  job,
  lines,
  oob,
}: {
  job: JobRow | null;
  lines: JobLogLine[];
  oob?: boolean;
}) {
  const last = lines[lines.length - 1]?.seq ?? 0;
  return (
    <section
      id="jobs-log"
      class={job ? 'm-job-log' : 'm-job-log is-empty'}
      hx-swap-oob={oob ? 'true' : undefined}
    >
      {job ? (
        <>
          <div class="m-job-log-head">
            <h3>Job log</h3>
            <span class="m-code">{job.jobCode} · {job.step || job.status}</span>
          </div>
          <pre class="m-job-log-body">
            {lines.map((line) => <LogLine line={line} />)}
            {isLive(job) ? <LogPoll jobCode={job.jobCode} after={last} /> : null}
          </pre>
        </>
      ) : null}
    </section>
  );
}
