/**
 * The sentences a benchmark run writes onto `jobs.step`.
 *
 * `gym/progress.ts` decides *which* phase the run is in, from Harbor's files.
 * This file is the English. A new status is one function here plus a kind
 * over there — not a string spliced into the file walker.
 *
 * Ingest is not a Harbor phase (the gym process has already exited), so
 * `saving` lives only here.
 */
import type { RunPhase } from '../../gym/progress.ts';

export const starting = () => 'Starting';
export const preparing = () => 'Preparing the environment';
export const finishing = () => 'Finishing this task';
export const saving = () => 'Saving results';

export const agent = (turn: number, maxTurns: number) =>
  `The agent is working — turn ${turn} of ${maxTurns}`;

export const scoring = (counted: number, total: number | null) => {
  if (total) return `Scoring answers — ${counted} of ${total} criteria`;
  if (counted > 0) return `Scoring answers — ${counted} so far`;
  return 'Scoring answers';
};

export const tasks = (done: number, total: number) => `${done} of ${total} tasks done`;

export function stepOf(phase: RunPhase): string {
  switch (phase.kind) {
    case 'starting':
      return starting();
    case 'preparing':
      return preparing();
    case 'agent':
      return agent(phase.turn, phase.maxTurns);
    case 'scoring':
      return scoring(phase.counted, phase.total);
    case 'finishing':
      return finishing();
    case 'tasks':
      return tasks(phase.done, phase.total);
  }
}
