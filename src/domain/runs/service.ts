import * as repo from './repo.ts';

export type { JsonObject, RunSummary } from './model.ts';

export const byId = repo.findById;
export const list = repo.listAll;

export async function current() {
  const [run] = await repo.listAll();
  return run ?? null;
}
