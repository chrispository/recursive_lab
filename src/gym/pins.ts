/**
 * The gym's own benchmark pin, read from its own files — a frozen commit, never
 * "latest". The lab holds two independent copies of a benchmark source (the
 * catalog and the gym's prepared assets) and this module reads the gym's side
 * so the app can state the gap instead of discovering it in a failed run.
 *
 * The pin is `.nemo_gym_asset.json` beside the prepared task cache; the runnable
 * set is `all.jsonl` in the same tree.
 */
import { resolve } from 'node:path';
import { config } from '../config.ts';
import * as gymConfig from './config.ts';
import * as head from './head.ts';
import { pickResources } from './servers.ts';

export type GymPin = {
  resolved: boolean;
  /** Populated when `resolved` is false. */
  reason: string;
  /** The benchmark repository the gym prepared, e.g. `https://github.com/o/r`. */
  repository: string;
  revision: string;
  /** The gym's own count, from the marker. */
  taskCount: number;
  /** Bare task ids the gym can actually run, from `all.jsonl`. */
  runnableTaskIds: string[];
};

const MARKER = '.nemo_gym_asset.json';

type Marker = {
  kind?: string;
  repository?: string;
  revision?: string;
  task_count?: number;
};

async function readMarker(dir: string): Promise<Marker | null> {
  try {
    return (await Bun.file(resolve(dir, MARKER)).json()) as Marker;
  } catch {
    // No marker here yet; the caller scans the next candidate directory.
    return null;
  }
}

/** Every runnable task id in an index, with the `alias::` prefix dropped. */
async function readRunnable(dir: string): Promise<string[]> {
  let text: string;
  try {
    text = await Bun.file(resolve(dir, 'all.jsonl')).text();
  } catch {
    // The runnable index is absent until the gym has prepared once.
    return [];
  }
  const ids: string[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as { instance_id?: string };
      if (typeof row.instance_id === 'string') ids.push(row.instance_id.split('::').pop() ?? row.instance_id);
    } catch {
      // A truncated trailing line is the index being written; skip it.
    }
  }
  return ids;
}

/** Cache and runtime dirs of the running resources server's prepared tasks. */
async function liveDirs(): Promise<{ cache: string; runtime: string }> {
  const live = await gymConfig.loadCached();
  const resources = pickResources(await head.health());
  const block = `${resources.processName}.resources_servers`;
  let cache = '';
  let runtime = '';
  for (const name of Object.keys(gymConfig.obj(live, block))) {
    const found = gymConfig.str(live, `${block}.${name}.harbor_tasks_cache_dir`);
    if (found) cache = resolve(config.gym.root, found);
    const running = gymConfig.str(live, `${block}.${name}.harbor_tasks_dir`);
    if (running) runtime = resolve(config.gym.root, running);
  }
  return { cache, runtime };
}

let cached: { at: number; value: GymPin } | null = null;
const CACHE_MS = 10_000;

/** The gym's pin, briefly cached — the settings panel polls on every swap. */
export async function resolvePin(): Promise<GymPin> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const value = await read();
  cached = { at: Date.now(), value };
  return value;
}

async function read(): Promise<GymPin> {
  const empty: GymPin = { resolved: false, reason: '', repository: '', revision: '', taskCount: 0, runnableTaskIds: [] };

  let cache = '';
  let runtime = '';
  try {
    ({ cache, runtime } = await liveDirs());
  } catch {
    // Gym is down; the checkout scan below still finds the marker on disk.
  }

  let marker = cache ? await readMarker(cache) : null;
  if (!marker) {
    const pattern = `resources_servers/*/data/cache/harbor_tasks/*/${MARKER}`;
    for (const path of new Bun.Glob(pattern).scanSync({ cwd: config.gym.root })) {
      const found = await readMarker(resolve(config.gym.root, path));
      if (found?.kind === 'tasks') {
        marker = found;
        cache = resolve(config.gym.root, path, '..');
        break;
      }
    }
  }
  if (!marker?.revision) {
    return { ...empty, reason: 'The gym has not prepared any benchmark assets yet. Start it once to build them.' };
  }

  const runnableTaskIds = await readRunnable(runtime || cache);
  return {
    resolved: true,
    reason: '',
    repository: marker.repository ?? '',
    revision: marker.revision,
    taskCount: marker.task_count ?? runnableTaskIds.length,
    runnableTaskIds,
  };
}
