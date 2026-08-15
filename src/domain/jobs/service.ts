import * as repo from './repo.ts';

export type { JobLogLine, JobRow, JobStatus } from './model.ts';
export { isLive } from './model.ts';

export const get = repo.get;
export const listByBenchmarkRun = repo.listByBenchmarkRun;
export const linesAfter = repo.linesAfter;
