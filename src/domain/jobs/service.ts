import * as repo from './repo.ts';
import { killGroup } from '../../gym/spawn.ts';

import type { JobRow } from './model.ts';
export type { JobLogLine, JobRow, JobStatus } from './model.ts';
export { isLive } from './model.ts';

export const get = repo.get;
export const listByBenchmarkRun = repo.listByBenchmarkRun;
export const linesAfter = repo.linesAfter;

/** Stop a job's detached process group, then return its persisted terminal row. */
export async function cancel(jobId: number): Promise<JobRow | null> {
  const result = await repo.cancel(jobId);
  if (!result) return null;
  if (result.changed && result.pgid && result.pgid > 1) killGroup(result.pgid);
  return repo.get(jobId);
}
