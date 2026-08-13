import * as repo from './repo.ts';

export type { DataForgeSummary, DocumentRow } from './model.ts';

export const byBenchmarkRun = repo.findByBenchmarkRun;
export const documents = repo.listDocuments;
