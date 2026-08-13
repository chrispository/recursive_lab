/**
 * Pipeline progress: how far one benchmark run has travelled.
 *
 * This is derived on every read, never stored. It drives the rail's stage ticks
 * and gate readout, and it is the answer to "what can I do next?".
 */
import { code } from '../../db/ids.ts';

/** One stage's presence, as the rail draws it. */
export type ProgressStep = {
  /** Display code of the entity that satisfies this stage, if any. */
  entity: string | null;
  /** Row count under it — failures, topics, documents, environments. */
  count: number;
};

export type Progress = {
  runId: number;
  runCode: string;
  label: string;
  model: string;
  passRate: number | null;
  benchmarkResult: ProgressStep;
  failureMapId: number | null;

  failureMap: ProgressStep;
  topicCount: number;
  dataForgeRun: ProgressStep;
  environments: ProgressStep;
};

const EMPTY: ProgressStep = { entity: null, count: 0 };

/**
 * How many of the five rail stages are satisfied.
 *
 * Each rail stage is satisfied by its own downstream entity. A benchmark run
 * opens stage 01; its first task result opens stage 02.
 */
export function gatesOf(progress: Progress | null): number {
  if (!progress) return 0;
  let gates = 1;
  if (progress.benchmarkResult.entity) gates++;
  if (progress.failureMap.entity) gates++;
  if (progress.dataForgeRun.entity) gates++;
  if (progress.environments.count > 0) gates++;
  return gates;
}

/** Builds a step from a nullable id plus its count. */
export const step = (
  entity: Parameters<typeof code>[0],
  id: number | null,
  count: number,
): ProgressStep => (id === null ? EMPTY : { entity: code(entity, id), count });
