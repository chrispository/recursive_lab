export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type JobRow = {
  jobCode: string;
  kind: string;
  subjectCode: string;
  status: JobStatus;
  step: string;
  progress: number;
  exitCode: number | null;
};
