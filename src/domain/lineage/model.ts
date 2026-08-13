/**
 * The lineage: how far one benchmark run has travelled down the pipeline.
 *
 * This is derived on every read, never stored. It drives the rail's stage ticks
 * and gate readout, and it is the answer to "what can I do next?".
 */
import { code } from '../../db/ids.ts';

/** One stage's presence, as the rail draws it. */
export type LineageStep = {
  /** Display code of the entity that satisfies this stage, if any. */
  entity: string | null;
  /** Row count under it — failures, topics, documents, environments. */
  count: number;
};

export type Lineage = {
  runId: number;
  runCode: string;
  label: string;
  model: string;
  passRate: number | null;
  taxonomyId: number | null;

  failureMap: LineageStep;
  taxonomy: LineageStep;
  forgeRun: LineageStep;
  environments: LineageStep;
};

const EMPTY: LineageStep = { entity: null, count: 0 };

/**
 * How many of the five rail stages are satisfied.
 *
 * Stage 01 (benchmarks) and 02 (results) are both satisfied by the run itself
 * existing — a run you can look at is a run you have configured. After that
 * each stage needs its own entity.
 */
export function gatesOf(lineage: Lineage | null): number {
  if (!lineage) return 0;
  let gates = 2;
  if (lineage.failureMap.entity) gates++;
  if (lineage.forgeRun.entity) gates++;
  if (lineage.environments.count > 0) gates++;
  return gates;
}

/** Builds a step from a nullable id plus its count. */
export const step = (
  entity: Parameters<typeof code>[0],
  id: number | null,
  count: number,
): LineageStep => (id === null ? EMPTY : { entity: code(entity, id), count });
