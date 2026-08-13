/**
 * Progress rules. Everything the rail and the "what can I do next?" logic needs.
 */
import type { RailState } from '../../views/layout/Rail.tsx';
import { gatesOf, type Progress } from './model.ts';
import * as repo from './repo.ts';

export type { Progress } from './model.ts';

/**
 * The run the app is "on". There is no notion of a selected run persisted
 * anywhere — the newest run is the current one, which matches how the pipeline
 * is actually used (one run at a time, worked to completion).
 */
export async function current(): Promise<Progress | null> {
  const [newest] = await repo.listAll();
  return newest ?? null;
}

export const byRun = repo.findByRun;
export const list = repo.listAll;

/** Projects progress into what the rail draws. */
export function railState(progress: Progress | null): RailState {
  if (!progress) return { runCode: null, model: null, passRate: null, gates: 0 };
  return {
    runCode: progress.runCode,
    model: progress.model,
    passRate: progress.passRate,
    gates: gatesOf(progress),
  };
}

/** Convenience for page handlers, which almost always want both. */
export async function currentWithRail(): Promise<{ progress: Progress | null; rail: RailState }> {
  const progress = await current();
  return { progress, rail: railState(progress) };
}
