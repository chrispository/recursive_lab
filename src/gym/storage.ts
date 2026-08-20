/**
 * Gym disk usage and safe deletion.
 *
 * Two rules shape this file. First, delete targets come from an allowlist of
 * directory *roles* resolved against the live config — never a caller-supplied
 * path, so a crafted request cannot aim a `rm -rf` outside the gym. Second,
 * gym-owned directories are cleared of their *contents*; the directory itself
 * stays, because a running server may hold it open or expect it to exist.
 */
import { readdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config } from '../config.ts';
import * as gymConfig from './config.ts';
import * as head from './head.ts';
import { pickAgent, pickResources } from './servers.ts';

export class StorageError extends Error {}

/** The directories the storage panel can watch or clear. */
export const BUCKET_IDS = [
  'gym-cache',
  'prepared-assets',
  'harbor-jobs',
  'run-artifacts',
  'staging',
  'snapshots',
] as const;

export type BucketId = (typeof BUCKET_IDS)[number];

const isBucketId = (value: string): value is BucketId => (BUCKET_IDS as readonly string[]).includes(value);

/** One deletable or watchable directory with a stable id. */
export type Bucket = {
  id: BucketId;
  label: string;
  /** The directories this bucket covers — several for prepared assets. */
  paths: string[];
  /** Who owns the directory — colours what deletion means. */
  owner: 'lab' | 'gym';
  /** Why this exists, shown next to the delete button. */
  note: string;
  /** False when the paths could not be resolved (gym not running). */
  resolved: boolean;
};

/** Usage for one bucket, plus per-run granularity for the shared dirs. */
export type BucketUsage = Bucket & {
  bytes: number;
  entries: { name: string; bytes: number }[];
};

/**
 * Resolve every bucket against the live gym config where one is needed.
 *
 * `prepared-assets` and `harbor-jobs` paths belong to server startup config and
 * change between checkouts, so they resolve only while gym runs — the same
 * honesty `settings.storage()` applies to its read-only list.
 */
async function buckets(): Promise<Bucket[]> {
  const gymCache: Bucket = {
    id: 'gym-cache',
    label: 'Gym package and download cache',
    paths: [resolve(config.gym.root, 'cache')],
    owner: 'gym',
    note: 'Package wheels and reused downloads. Cleared contents re-download on next start.',
    resolved: true,
  };
  const prepared: Bucket = {
    id: 'prepared-assets',
    label: 'Prepared benchmark assets',
    paths: [],
    owner: 'gym',
    note: 'Task caches and runtime material the resources server prepared. Re-prepared on next start.',
    resolved: false,
  };
  const harbor: Bucket = {
    id: 'harbor-jobs',
    label: 'Harbor trials',
    paths: [],
    owner: 'gym',
    note: 'Agent transcripts and judge scores per trial. Deleting loses trajectory detail; scores in the lab database survive.',
    resolved: false,
  };
  const runArtifacts: Bucket = {
    id: 'run-artifacts',
    label: 'Run inputs and rollouts',
    paths: [resolve(config.gym.root, 'results/lab')],
    owner: 'gym',
    note: 'One folder per benchmark run, written by the lab. Deleting a run folder orphans its database rows.',
    resolved: true,
  };
  const staging: Bucket = {
    id: 'staging',
    label: 'Import staging',
    paths: [config.paths.staging],
    owner: 'lab',
    note: 'Tarballs a preview downloaded but no commit consumed. Always safe to clear.',
    resolved: true,
  };
  const snapshots: Bucket = {
    id: 'snapshots',
    label: 'Benchmark snapshots',
    paths: [config.paths.benchmarks],
    owner: 'lab',
    note: 'Committed task definitions per benchmark. Deleting a snapshot breaks re-running that catalog.',
    resolved: true,
  };

  try {
    const live = await gymConfig.loadCached();
    const health = await head.health();
    const resources = pickResources(health);
    const agent = pickAgent(health, resources);

    // Task caches live under each resources server's own config block; the keys
    // are the server's, so they are enumerated rather than named. Values go
    // through `str` so `${oc.env:…}` interpolations resolve to real paths.
    const assets = new Set<string>();
    const servers = gymConfig.obj(live, `${resources.processName}.resources_servers`);
    for (const [serverName, server] of Object.entries(servers)) {
      if (!server || typeof server !== 'object') continue;
      for (const key of ['harbor_tasks_cache_dir', 'harbor_tasks_dir', 'harness_skills_dir']) {
        const value = gymConfig.str(live, `${resources.processName}.resources_servers.${serverName}.${key}`);
        if (value) assets.add(resolve(config.gym.root, value));
      }
    }
    if (assets.size) {
      prepared.paths = [...assets].sort();
      prepared.note = `${assets.size} directories. ${prepared.note}`;
      prepared.resolved = true;
    }

    const harborPath = gymConfig.harborJobsDir(live, agent.processName, agent.name);
    harbor.paths = harborPath ? [harborPath] : [];
    harbor.resolved = Boolean(harborPath);
  } catch {
    // An unresolvable bucket keeps resolved: false and its "start gym" note.
  }
  return [gymCache, prepared, harbor, runArtifacts, staging, snapshots];
}

/** Recursive size, skipping symlinks so a venv link cannot loop the walk. */
async function sizeOf(path: string): Promise<number> {
  let total = 0;
  const walk = async (dir: string) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = resolve(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(child);
      } else {
        try {
          total += (await stat(child)).size;
        } catch {
          // Removed mid-walk.
        }
      }
    }
  };
  await walk(path);
  return total;
}

/** The storage panel: buckets with sizes, and child folders where they vary. */
export async function usage(): Promise<BucketUsage[]> {
  const rows = await buckets();
  return Promise.all(
    rows.map(async (bucket): Promise<BucketUsage> => {
      if (!bucket.resolved) return { ...bucket, bytes: 0, entries: [] };
      if (bucket.id === 'prepared-assets') {
        const entries = await Promise.all(
          bucket.paths.map(async (path) => ({ name: path, bytes: await sizeOf(path) })),
        );
        return { ...bucket, bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0), entries };
      }
      const root = bucket.paths[0] ?? '';
      const bytes = await sizeOf(root);
      let entries: { name: string; bytes: number }[] = [];
      if (bucket.id === 'run-artifacts' || bucket.id === 'snapshots' || bucket.id === 'staging') {
        let children: import('node:fs').Dirent[];
        try {
          children = await readdir(root, { withFileTypes: true });
        } catch {
          children = [];
        }
        entries = await Promise.all(
          children
            .filter((child) => child.isDirectory())
            .slice(0, 50)
            .map(async (child) => ({ name: child.name, bytes: await sizeOf(resolve(root, child.name)) })),
        );
        entries.sort((a, b) => b.bytes - a.bytes);
      }
      return { ...bucket, bytes, entries };
    }),
  );
}

/** True when `target` is inside `root` (or equal to it, when equal is allowed). */
function within(target: string, root: string, allowEqual: boolean): boolean {
  const t = resolve(target);
  const r = resolve(root);
  if (t === r) return allowEqual;
  return t.startsWith(`${r}/`);
}

/**
 * Clear one bucket, or one entry inside it.
 *
 * `target` may name a child of a bucket (a single `BR-00007` run folder, one
 * benchmark snapshot) or be omitted to clear the whole bucket. Whole-bucket
 * clears remove the contents; gym-owned directories themselves are recreated,
 * the lab's own bucket roots are left in place by `rm`.
 */
export async function clear(bucketId: string, target?: string): Promise<{ removed: string }> {
  if (!isBucketId(bucketId)) throw new StorageError(`Unknown storage bucket ${bucketId}.`);

  const bucket = (await buckets()).find((row) => row.id === bucketId);
  if (!bucket) throw new StorageError(`Unknown storage bucket ${bucketId}.`);
  if (!bucket.resolved) throw new StorageError(`${bucket.label} is not resolved. Start NeMo Gym first.`);

  const roots = bucket.paths;
  if (target) {
    // A target is a single entry name — never a path. `..` and slashes have no
    // legitimate use here, so they are rejected rather than normalized away.
    if (target.includes('/') || target === '.' || target === '..') {
      throw new StorageError('Name a single entry to delete, not a path.');
    }
    let removed = '';
    for (const root of roots) {
      const child = resolve(root, target);
      if (!within(child, root, false)) continue;
      await rm(child, { recursive: true, force: true });
      removed = removed ? `${removed}, ${child}` : child;
    }
    if (!removed) throw new StorageError(`${target} was not found in ${bucket.label}.`);
    return { removed };
  }

  for (const root of roots) {
    // Whole-bucket clear: remove contents, keep the directory.
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      await rm(resolve(root, entry.name), { recursive: true, force: true });
    }
  }
  return { removed: roots.join(', ') };
}
