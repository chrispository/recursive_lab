/**
 * Every environment-dependent value in the app, resolved once at import time.
 *
 * Nothing else in the codebase reads `process.env` or hardcodes a path. If you
 * need a new knob, add it here with a default that lets the app boot.
 */
import { resolve } from 'node:path';

const env = (key: string, fallback: string) => process.env[key]?.trim() || fallback;

/** Repo root, so relative paths don't depend on where `bun` was invoked. */
export const ROOT = resolve(import.meta.dir, '..');

export const config = {
  host: env('HOST', '127.0.0.1'),
  port: Number(env('PORT', '8767')),

  db: {
    url: env('DATABASE_URL', `file:${resolve(ROOT, 'data/lab.db')}`),
    /** Set both to turn the local file into a Turso embedded replica. */
    syncUrl: process.env.TURSO_SYNC_URL || undefined,
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  },

  /** Where imported benchmark sources live on disk. */
  paths: {
    /** Snapshots staged by a preview, keyed by token. Safe to delete at any time. */
    staging: env('STAGING_DIR', resolve(ROOT, 'data/staging')),
    /** Snapshots kept by a committed import, keyed by benchmark code. */
    benchmarks: env('BENCHMARKS_DIR', resolve(ROOT, 'data/benchmarks')),
  },

  gym: {
    /** The NeMo Gym checkout we shell into. All gym paths are relative to it. */
    root: env('GYM_ROOT', '/home/chris/Documents/recursive'),
    /**
     * The head server started by `gym env start` in that checkout. It is the
     * registry every other gym server is discovered through — we never hardcode
     * a resources-server port, we ask this endpoint for it.
     */
    headUrl: env('GYM_HEAD_URL', 'http://127.0.0.1:11000'),
    /** Head server calls are local and cheap; nothing should hang a page load. */
    timeoutMs: Number(env('GYM_TIMEOUT_MS', '5000')),
  },
} as const;

/** Absolute path to the gym CLI, falling back to whatever is on PATH. */
export const gymBin = () => resolve(config.gym.root, '.venv/bin/gym');

/** Where a benchmark run's inputs and rollouts live, e.g. results/lab/BR-00012. */
export const benchmarkRunDir = (benchmarkRunCode: string) => resolve(config.gym.root, 'results/lab', benchmarkRunCode);
