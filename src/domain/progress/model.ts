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
  dataForgeRequested: number;
  dataForgeCreated: number;
  dataForgePending: number;
  dataForgeRejected: number;
  environments: ProgressStep;
  scaleReadyEnvironments: number;
  clusterHandoff: ProgressStep;
};

/** The pipeline destinations that can be reached by a handoff action. */
export type HandoffTarget = 'benchmarks' | 'results' | 'failures' | 'forge' | 'forge-review' | 'env-lab' | 'cluster';

/** A handoff's current availability and the explanation shown when it is closed. */
export type GateDecision = {
  open: boolean;
  reason: string | null;
};

const EMPTY: ProgressStep = { entity: null, count: 0 };

/**
 * How many of the seven rail stages are satisfied.
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
  if (reviewComplete(progress)) gates++;
  if (progress.environments.count > 0 && progress.scaleReadyEnvironments >= progress.environments.count) gates++;
  if (progress.clusterHandoff.count > 0 && progress.clusterHandoff.count >= progress.scaleReadyEnvironments) gates++;
  return gates;
}

/** Every requested novel slot must be approved before environments are built. */
export function reviewComplete(progress: BenchmarkRunProgress | null): boolean {
  return Boolean(
    progress?.dataForgeRun.entity
      && progress.dataForgeRequested > 0
      && progress.dataForgeRun.count >= progress.dataForgeRequested
      && progress.dataForgePending === 0
      && progress.dataForgeRejected === 0,
  );
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
 * analysis, a stored failure map unlocks Data forge, a complete human review
 * unlocks Env lab, and local validation unlocks the cluster handoff.
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
  if (target === 'forge-review' && !progress?.dataForgeRun.entity) {
    return {
      open: false,
      reason: 'Start a data forge run before opening document review.',
    };
  }
  if (target === 'env-lab' && !reviewComplete(progress)) {
    return {
      open: false,
      reason: 'Fill every requested forge slot and approve every novel document before sending this run to Env lab.',
    };
  }
  if (target === 'cluster' && (!progress?.environments.count || progress.scaleReadyEnvironments < 1)) {
    return {
      open: false,
      reason: 'Pass local validation for at least one environment before opening the cluster handoff.',
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
