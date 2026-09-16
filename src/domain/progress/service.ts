/**
 * Progress rules. Everything the rail and the "what can I do next?" logic needs.
 */
import type { RailState } from '../../views/layout/Rail.tsx';
import { gatesOf, type BenchmarkRunProgress } from './model.ts';
import * as repo from './repo.ts';
import * as environments from '../environments/service.ts';

export type { BenchmarkRunProgress } from './model.ts';

/**
 * The run the app is "on". There is no notion of a selected run persisted
 * anywhere — the newest run is the current one, which matches how the pipeline
 * is actually used (one run at a time, worked to completion).
 */
export async function current(): Promise<BenchmarkRunProgress | null> {
  const [newest] = await repo.listAll();
  return readiness(newest ?? null);
}

export const byBenchmarkRun = async (id: number) => readiness(await repo.findByBenchmarkRun(id));
export const list = async () => Promise.all((await repo.listAll()).map(async (row) => (await readiness(row))!));

async function readiness(row: BenchmarkRunProgress | null): Promise<BenchmarkRunProgress | null> {
  if (!row || !row.environments.count) return row;
  const ready = (await environments.listByBenchmarkRun(row.benchmarkRunId)).filter((env) => env.scaleReady);
  const count = ready.filter((env) => env.clusterPrepared).length;
  return { ...row, scaleReadyEnvironments: ready.length,
    clusterHandoff: { count, entity: count ? row.benchmarkRunCode : null } };
}

/** Projects progress into what the rail draws. */
export function railState(progress: BenchmarkRunProgress | null): RailState {
  if (!progress) return { benchmarkRunId: null, model: null, passRate: null, gates: 0 };
  return {
    benchmarkRunId: progress.benchmarkRunId,
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
