/**
 * Lineage rules. Everything the rail and the "what can I do next?" logic needs.
 */
import type { RailState } from '../../views/layout/Rail.tsx';
import { gatesOf, type Lineage } from './model.ts';
import * as repo from './repo.ts';

export type { Lineage } from './model.ts';

/**
 * The run the app is "on". There is no notion of a selected run persisted
 * anywhere — the newest run is the current one, which matches how the pipeline
 * is actually used (one run at a time, worked to completion).
 */
export async function current(): Promise<Lineage | null> {
  const [newest] = await repo.listAll();
  return newest ?? null;
}

export const byRun = repo.findByRun;
export const list = repo.listAll;

/** Projects a lineage into what the rail draws. */
export function railState(lineage: Lineage | null): RailState {
  if (!lineage) return { runCode: null, model: null, passRate: null, gates: 0 };
  return {
    runCode: lineage.runCode,
    model: lineage.model,
    passRate: lineage.passRate,
    gates: gatesOf(lineage),
  };
}

/** Convenience for page handlers, which almost always want both. */
export async function currentWithRail(): Promise<{ lineage: Lineage | null; rail: RailState }> {
  const lineage = await current();
  return { lineage, rail: railState(lineage) };
}
