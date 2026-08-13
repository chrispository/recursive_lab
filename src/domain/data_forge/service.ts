import * as repo from './repo.ts';

export type { DataForgeSummary, DocumentRow } from './model.ts';

export const byRun = repo.findByRun;
export const documents = repo.listDocuments;
