/**
 * Live status of a gym eval, read from files Harbor and gym write as they go.
 *
 * Gym's JSONL line appears only after a whole Harbor trial (agent + judge),
 * which on LAB is minutes. The trial folder fills in earlier: environment,
 * then a turn-flushed transcript, then verifier events, then result.json.
 * This module is the only place outside Harbor that knows those paths.
 *
 * It returns a phase kind, not a sentence. The words live in
 * `domain/runs/steps.ts`, so a copy change does not touch this walker.
 */
import { readdir } from 'node:fs/promises';
import { completeLines } from './results.ts';

export type LiveOpts = {
  outputPath: string;
  harborJobsDir: string;
  total: number;
  maxTurns: number;
  /** Catalog criteria for the in-flight task, when we know which one it is. */
  criteriaHint?: number;
};

export type RunPhase =
  | { kind: 'starting' }
  | { kind: 'preparing' }
  | { kind: 'agent'; turn: number; maxTurns: number }
  | { kind: 'scoring'; counted: number; total: number | null }
  | { kind: 'finishing' }
  | { kind: 'tasks'; done: number; total: number };

export type LiveProgress = {
  done: number;
  /** 0–1 of the requested tasks, including the in-flight trial's fraction. */
  fraction: number;
  phase: RunPhase;
};

const PREPARE = 0.05;
const AGENT_START = 0.08;
const AGENT_SPAN = 0.67;
const SCORE_START = 0.75;
const SCORE_SPAN = 0.22;
const FINISH = 0.97;

const MARKERS = [
  '/agent/artifacts/lab-run/transcript.jsonl',
  '/agent/artifacts/lab-run/config.json',
  '/verifier/transcript.jsonl',
  '/verifier/scores.json',
  '/result.json',
] as const;

const PATTERNS = [
  '**/result.json',
  '**/verifier/scores.json',
  '**/verifier/transcript.jsonl',
  '**/artifacts/lab-run/transcript.jsonl',
  '**/artifacts/lab-run/config.json',
];

type Trial = {
  dir: string;
  config: boolean;
  transcript: string | null;
  verifier: string | null;
  scores: boolean;
  result: boolean;
};

type Measured = { frac: number; phase: RunPhase };

async function globFiles(root: string, pattern: string): Promise<string[]> {
  const glob = new Bun.Glob(pattern);
  const found: string[] = [];
  try {
    for await (const path of glob.scan({ cwd: root, absolute: true })) found.push(path);
  } catch {
    return [];
  }
  return found;
}

function trialDirOf(path: string): string | null {
  for (const marker of MARKERS) {
    if (path.endsWith(marker)) return path.slice(0, -marker.length);
  }
  return null;
}

async function trialsOf(root: string): Promise<Trial[]> {
  const byDir = new Map<string, Trial>();
  const take = (dir: string) => {
    let trial = byDir.get(dir);
    if (!trial) {
      trial = { dir, config: false, transcript: null, verifier: null, scores: false, result: false };
      byDir.set(dir, trial);
    }
    return trial;
  };
  for (const pattern of PATTERNS) {
    for (const path of await globFiles(root, pattern)) {
      const dir = trialDirOf(path);
      if (!dir) continue;
      const trial = take(dir);
      if (path.endsWith('/result.json')) trial.result = true;
      else if (path.endsWith('/verifier/scores.json')) trial.scores = true;
      else if (path.endsWith('/verifier/transcript.jsonl')) trial.verifier = path;
      else if (path.endsWith('/transcript.jsonl')) trial.transcript = path;
      else if (path.endsWith('/config.json')) trial.config = true;
    }
  }
  return [...byDir.values()];
}

async function nonempty(dir: string): Promise<boolean> {
  try {
    const entries = await readdir(dir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

/**
 * The turn field sits at the start of each transcript line. A later line can
 * be megabytes (it embeds the whole message list), so we walk back from EOF
 * until we see a line that begins with it.
 */
async function lastTurn(path: string): Promise<number> {
  const file = Bun.file(path);
  const size = Number(file.size);
  if (!size) return 0;
  const chunk = 512 * 1024;
  let end = size;
  while (end > 0) {
    const start = Math.max(0, end - chunk);
    const text = await file.slice(start, end).text();
    let found: number | null = null;
    for (const match of text.matchAll(/(?:^|\n)\{\"turn\":\s*(\d+)/g)) {
      found = Number(match[1]);
    }
    if (found !== null) return found;
    if (start === 0) return 0;
    end = start + 32;
  }
  return 0;
}

async function countType(path: string, type: string): Promise<number> {
  const file = Bun.file(path);
  if (!(await file.exists())) return 0;
  const text = await file.text();
  const needle = `"type": "${type}"`;
  let n = 0;
  for (let i = 0; i < text.length; ) {
    const at = text.indexOf(needle, i);
    if (at < 0) break;
    n += 1;
    i = at + needle.length;
  }
  return n;
}

async function measure(trial: Trial, maxTurns: number, criteriaHint?: number): Promise<Measured> {
  if (trial.result) return { frac: 1, phase: { kind: 'finishing' } };
  if (trial.scores) return { frac: FINISH, phase: { kind: 'finishing' } };
  if (trial.verifier) {
    const scored = await countType(trial.verifier, 'criterion_complete');
    const started = await countType(trial.verifier, 'criterion_start');
    const counted = Math.max(scored, started);
    const total = criteriaHint && criteriaHint > 0 ? criteriaHint : null;
    const frac = SCORE_START + SCORE_SPAN * (total ? Math.min(1, counted / total) : Math.min(1, counted * 0.02));
    return { frac, phase: { kind: 'scoring', counted, total } };
  }
  if (trial.transcript) {
    const turn = await lastTurn(trial.transcript);
    if (turn > 0) {
      const frac = AGENT_START + AGENT_SPAN * Math.min(1, turn / Math.max(1, maxTurns));
      return { frac, phase: { kind: 'agent', turn, maxTurns } };
    }
  }
  if (trial.config || trial.transcript) {
    return { frac: AGENT_START, phase: { kind: 'preparing' } };
  }
  return { frac: PREPARE, phase: { kind: 'preparing' } };
}

export async function snapshot(opts: LiveOpts): Promise<LiveProgress> {
  const total = Math.max(1, opts.total);
  const done = await completeLines(opts.outputPath);
  if (done >= total) return { done, fraction: 1, phase: { kind: 'tasks', done, total } };

  const started = await nonempty(opts.harborJobsDir);
  const trials = started ? await trialsOf(opts.harborJobsDir) : [];
  const incomplete = trials.filter((trial) => !trial.result);
  const recorded = trials.filter((trial) => trial.result).length;
  const lag = Math.max(0, recorded - done);

  const measured = await Promise.all(incomplete.map((trial) => measure(trial, opts.maxTurns, opts.criteriaHint)));
  let inFlight = lag + measured.reduce((sum, item) => sum + item.frac, 0);
  if (trials.length === 0 && started) inFlight += PREPARE;

  const fraction = Math.min(1, (done + inFlight) / total);
  const lead = measured.reduce<Measured | null>((best, item) => {
    if (!best || item.frac >= best.frac) return item;
    return best;
  }, null);

  let phase: RunPhase = { kind: 'starting' };
  if (lead && lead.phase.kind !== 'preparing') phase = lead.phase;
  else if (lag > 0) phase = { kind: 'finishing' };
  else if (done > 0) phase = { kind: 'tasks', done, total };
  else if (started) phase = { kind: 'preparing' };

  return { done, fraction, phase };
}
