/**
 * Progress rules. Everything the rail and the "what can I do next?" logic needs.
 */
import type { RailState } from '../../views/layout/Rail.tsx';
import { gatesOf, type BenchmarkRunProgress } from './model.ts';
import * as repo from './repo.ts';

export type { BenchmarkRunProgress } from './model.ts';

/**
 * The run the app is "on". There is no notion of a selected run persisted
 * anywhere — the newest run is the current one, which matches how the pipeline
 * is actually used (one run at a time, worked to completion).
 */
export async function current(): Promise<BenchmarkRunProgress | null> {
  const [newest] = await repo.listAll();
  return newest ?? null;
}

export const byBenchmarkRun = repo.findByBenchmarkRun;
export const list = repo.listAll;

/** Projects progress into what the rail draws. */
export function railState(progress: BenchmarkRunProgress | null): RailState {
  if (!progress) return { benchmarkRunId: null, benchmarkRunCode: null, model: null, passRate: null, gates: 0 };
  return {
    benchmarkRunId: progress.benchmarkRunId,
    benchmarkRunCode: progress.benchmarkRunCode,
    model: progress.model,
    passRate: progress.passRate,
    gates: gatesOf(progress),
  };
}

/** Convenience for page handlers, which almost always want both. */
export async function currentWithRail(): Promise<{ progress: BenchmarkRunProgress | null; rail: RailState }> {
  const progress = await current();
  return { progress, rail: railState(progress) };
}
