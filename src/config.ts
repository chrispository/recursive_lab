/**
 * Every environment-dependent value in the app, resolved once at import time.
 *
 * Add new knobs here with a default that lets the app boot. `NODE_ENV` is the
 * one exception: src/index.ts reads it directly for the static cache policy.
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
    /**
     * Point these two at a different NeMo Gym checkout / head server. Child
     * ports, adapter names, and `--model-type` are discovered from the head
     * (`/server_instances`), not configured here.
     */
    root: env('GYM_ROOT', resolve(ROOT, 'gym')),
    headUrl: env('GYM_HEAD_URL', 'http://127.0.0.1:11000'),
    /** Head server calls are local and cheap; nothing should hang a page load. */
    timeoutMs: Number(env('GYM_TIMEOUT_MS', '5000')),
  },
} as const;

/** Absolute path to the gym CLI, falling back to whatever is on PATH. */
export const gymBin = () => resolve(config.gym.root, '.venv/bin/gym');

/** Where a benchmark run's inputs and rollouts live, e.g. results/lab/BR-00012. */
export const benchmarkRunDir = (benchmarkRunCode: string) => resolve(config.gym.root, 'results/lab', benchmarkRunCode);

/*
 * There is deliberately no `harborJobsDir` here. Harbor's trial folder is not
 * the lab's to place: the agent server reads that path from its own startup
 * config, so a per-run directory invented here is one the lab watches and
 * Harbor never writes to. Ask the running gym instead — `gym/config.ts`.
 */
