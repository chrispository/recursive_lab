/**
 * Start and stop the gym head server from the app.
 *
 * There is no `gym env stop`: shutdown is a SIGINT to the `gym env start`
 * process, whose `RunHelper` catches it, SIGINTs each child server, waits,
 * escalates to SIGKILL, and stops the head (nemo_gym/cli/env.py § shutdown).
 * `stop()` here walks that same ladder so it also works for a gym the app did
 * not start — the pids come from the head registry, never from our memory.
 */
import { appendFile, mkdir, readdir, readlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config, gymBin } from '../config.ts';
import { gym, type Spawned } from './spawn.ts';

const LOG_PATH = resolve(config.gym.root, 'results/lab/gym-env-start.log');

/** A component name is the only gym vocabulary a caller may pass to start. */
const NAME = /^[a-z0-9][a-z0-9_-]*$/i;

export class LifecycleError extends Error {}

/**
 * The pid listening on the head port, found through /proc so no subprocess is
 * spawned and no port other than the configured one is ever touched.
 */
async function headPid(): Promise<number | null> {
  const port = Number(new URL(config.gym.headUrl).port);
  if (!Number.isInteger(port) || port <= 0) return null;

  const inodes = new Set<string>();
  for (const table of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let text: string;
    try {
      text = await Bun.file(table).text();
    } catch {
      continue;
    }
    for (const line of text.split('\n').slice(1)) {
      const cells = line.trim().split(/\s+/);
      // local_address is `1F:port hex`, state 0A is LISTEN.
      if (cells.length < 10) continue;
      const local = cells[1] ?? '';
      const state = cells[3] ?? '';
      if (state !== '0A') continue;
      if (parseInt(local.split(':')[1] ?? '', 16) !== port) continue;
      const inode = cells[9];
      if (inode) inodes.add(inode);
    }
  }
  if (!inodes.size) return null;

  // A manual walk, not Bun.Glob: /proc is full of entries that vanish or
  // refuse between listing and reading, and one EACCES must not lose the rest.
  const procs = (await readdir('/proc', { withFileTypes: true }).catch(() => [])) as import('node:fs').Dirent[];
  for (const proc of procs) {
    if (!proc.isDirectory() || !/^\d+$/.test(proc.name)) continue;
    const fds = await readdir(`/proc/${proc.name}/fd`, { withFileTypes: false }).catch(() => []);
    for (const fd of fds) {
      let link: string;
      try {
        link = await readlink(`/proc/${proc.name}/fd/${fd}`);
      } catch {
        continue; // fd closed between listing and reading
      }
      const inode = /socket:\[(\d+)\]/.exec(link)?.[1];
      if (inode && inodes.has(inode)) return Number(proc.name);
    }
  }
  return null;
}

/** True when the pid exists — `kill(pid, 0)` probes without signalling. */
export const isProcessAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const signalProcess = (pid: number, sig: NodeJS.Signals) => {
  try {
    process.kill(pid, sig);
  } catch {
    // Already gone.
  }
};

/** The process group reported by procfs, if this process has one. */
async function pgidOf(pid: number): Promise<number | null> {
  try {
    const stat = await Bun.file(`/proc/${pid}/stat`).text();
    const tail = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/);
    const pgid = Number(tail[2]); // fields 3 (state), 4 (ppid), 5 (pgrp)
    return Number.isInteger(pgid) && pgid > 1 ? pgid : null;
  } catch {
    return null;
  }
}

export const isProcessGroupAlive = (pgid: number) => {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
};

export const signalProcessGroup = (pgid: number, sig: NodeJS.Signals) => {
  try {
    process.kill(-pgid, sig);
  } catch {
    // The group has already exited.
  }
};

const sleep = (ms: number) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

/** The one `gym env start` the app spawned, if it is still ours to describe. */
let started: Spawned | null = null;

/**
 * Bring up the head server detached, teeing output to a log inside the gym
 * checkout so a run started from the UI can be read after a dev restart.
 *
 * Component names, not bench names: the resources server comes from the
 * benchmark's stored adapter, the model type from the running set it replaces.
 */
export async function start(options: { resourcesServer: string; modelType?: string }): Promise<{ pid: number }> {
  if (!NAME.test(options.resourcesServer)) {
    throw new LifecycleError('A gym resources server name is required to start the environment.');
  }
  if (await headPid()) {
    throw new LifecycleError('A gym head server is already listening on the configured head URL.');
  }
  if (!await Bun.file(gymBin()).exists()) {
    throw new LifecycleError(`No gym CLI at ${gymBin()}. Build the checkout's venv first.`);
  }

  const args = ['env', 'start', '--resources-server', options.resourcesServer];
  if (options.modelType && NAME.test(options.modelType)) args.push('--model-type', options.modelType);

  await mkdir(resolve(LOG_PATH, '..'), { recursive: true });
  await appendFile(LOG_PATH, `\n$ gym ${args.join(' ')}\n`);

  // File-backed stdio, never pipes: a sync job may start the gym from a
  // short-lived process, and the gym must outlive its spawner.
  started = gym(args, { cwd: config.gym.root, stdio: 'file', logPath: LOG_PATH });
  return { pid: started.pid };
}

/**
 * Graceful stop: SIGINT every registered server, then the head listener, then
 * wait for the port to close; anything still holding it after the grace period
 * is SIGKILLed. Safe to call when nothing is running.
 */
export async function stop(graceMs = 20_000): Promise<{ stopped: number[]; killed: number[] }> {
  const pids = new Set<number>();
  // A Ctrl+C can land while `gym env start` is still preparing Ray, before the
  // head listener and registry exist. This process is ours, so it must be part
  // of shutdown even when discovery below finds nothing yet.
  if (started && isProcessAlive(started.pid)) pids.add(started.pid);
  try {
    // The registry only — no health probes, they add nothing to a shutdown.
    const response = await fetch(`${config.gym.headUrl}/server_instances`, {
      signal: AbortSignal.timeout(config.gym.timeoutMs),
    });
    if (response.ok) {
      const rows = (await response.json()) as { pid?: number }[];
      for (const row of rows) if (row.pid && row.pid > 1) pids.add(row.pid);
    }
  } catch {
    // No registry to consult; the head itself is still worth stopping.
  }
  const listener = await headPid();
  if (listener && listener > 1) pids.add(listener);

  // Our launcher creates a detached group whose leader is the head process.
  // Signal that whole group so Ray and Harbor cannot outlive a stopped head.
  // Never group-kill a manually launched gym whose process group could be the
  // user's terminal; those still get the safe per-pid shutdown below.
  const leader = listener ?? (started && isProcessAlive(started.pid) ? started.pid : null);
  const leaderGroup = leader ? await pgidOf(leader) : null;
  const group = leader && leaderGroup === leader ? leaderGroup : null;

  const stopped: number[] = [];
  const killed: number[] = [];
  if (!pids.size) return { stopped, killed };

  if (group) signalProcessGroup(group, 'SIGINT');
  for (const pid of pids) signalProcess(pid, 'SIGINT');
  const deadline = Date.now() + graceMs;
  const pending = new Set(pids);
  while (pending.size && Date.now() < deadline) {
    await sleep(500);
    for (const pid of pending) {
      if (!isProcessAlive(pid)) {
        pending.delete(pid);
        stopped.push(pid);
      }
    }
  }
  for (const pid of pending) {
    signalProcess(pid, 'SIGKILL');
    killed.push(pid);
  }
  // Pids in the head registry can all vanish while a Ray descendant remains.
  // The detached group is the ownership boundary, so force it down too.
  if (group && isProcessGroupAlive(group)) {
    signalProcessGroup(group, 'SIGKILL');
    if (!killed.includes(group)) killed.push(group);
  }

  started = null;
  return { stopped, killed };
}

/** The head listener pid and whether it is the one this process started. */
export async function status(): Promise<{ headPid: number | null; startedByApp: boolean }> {
  return { headPid: await headPid(), startedByApp: Boolean(started && isProcessAlive(started.pid)) };
}
