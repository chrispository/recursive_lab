import * as repo from './repo.ts';

export type { BenchmarkCatalog, BenchmarkTask } from './model.ts';

export const list = repo.listCatalogs;
