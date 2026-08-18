export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type JobRow = {
  jobId: number;
  jobCode: string;
  kind: string;
  subjectCode: string;
  status: JobStatus;
  step: string;
  progress: number;
  exitCode: number | null;
  /** Why the job failed, or '' while it is running or once it succeeded. */
  error: string;
  /** When the job opened. Scopes what a live run may claim as its own work. */
  startedAt: string;
};

export type JobLogLine = {
  seq: number;
  at: string;
  stream: 'out' | 'err';
  line: string;
};

export const isLive = (job: JobRow | undefined | null): boolean =>
  job?.status === 'running' || job?.status === 'queued';
