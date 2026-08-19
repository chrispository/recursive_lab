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
  /** Eligible row count under it — failures, topics, approved documents, environments. */
  count: number;
};

export type BenchmarkRunProgress = {
  benchmarkRunId: number;
  benchmarkRunCode: string;
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

/** The pipeline destinations that can be reached by a handoff action. */
export type HandoffTarget = 'benchmarks' | 'results' | 'failures' | 'forge' | 'env-lab';

/** A handoff's current availability and the explanation shown when it is closed. */
export type GateDecision = {
  open: boolean;
  reason: string | null;
};

const EMPTY: ProgressStep = { entity: null, count: 0 };

/**
 * How many of the five rail stages are satisfied.
 *
 * Each rail stage is satisfied by its own downstream entity. A benchmark run
 * opens stage 01; its first task result opens stage 02.
 */
export function gatesOf(progress: BenchmarkRunProgress | null): number {
  if (!progress) return 0;
  let gates = 1;
  if (progress.benchmarkResult.entity) gates++;
  if (progress.failureMap.entity) gates++;
  if (progress.dataForgeRun.entity) gates++;
  if (progress.environments.count > 0) gates++;
  return gates;
}

/**
 * Decides whether a handoff destination is currently available.
 *
 * These are derived workflow rules, not persisted state. The UI uses the
 * decision to explain and disable a handoff, while the destination's domain
 * service remains responsible for enforcing its own prerequisite when work
 * is eventually started.
 *
 * The transitions are ordered prerequisites: benchmark results unlock failure
 * analysis, a stored failure map unlocks Data forge, and at least one generated
 * document unlocks the environment stage.
 */
export function handoffGate(target: HandoffTarget, progress: BenchmarkRunProgress | null): GateDecision {
  if ((target === 'results' || target === 'failures') && !progress?.benchmarkResult.entity) {
    return {
      open: false,
      reason: 'Finish a benchmark result before sending this run onward.',
    };
  }
  if (target === 'forge' && !progress?.failureMap.entity) {
    return {
      open: false,
      reason: 'Create a failure map before sending this run to Data forge.',
    };
  }
  if (target === 'env-lab' && (!progress?.dataForgeRun.entity || progress.dataForgeRun.count < 1)) {
    return {
      open: false,
      reason: 'Generate at least one reviewed data-forged document before sending this run to Env lab.',
    };
  }
  return { open: true, reason: null };
}

/** Builds a step from a nullable id plus its count. */
export const step = (
  entity: Parameters<typeof code>[0],
  id: number | null,
  count: number,
): ProgressStep => (id === null ? EMPTY : { entity: code(entity, id), count });
