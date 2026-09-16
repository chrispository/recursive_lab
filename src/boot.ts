/**
 * Gym lifecycle at app boot and shutdown.
 *
 * `bun run dev` should bring up the whole machine, gym included, and Ctrl+C
 * should take it back down. The Settings panel's start/stop buttons and this
 * module call the same `lifecycle` functions, so there is exactly one ladder
 * for starting and one for stopping. Two guards keep boot quiet: an
 * already-listening head server means there is nothing to start, and a missing
 * venv means the checkout has not been built yet, which the Settings panel
 * reports better than a boot crash.
 */
import { mkdir, open, readFile } from 'node:fs/promises';
import { unlinkSync as unlinkNow } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './config.ts';
import * as head from './gym/head.ts';
import * as lifecycle from './gym/lifecycle.ts';
import { reconcileOrphans } from './domain/jobs/trace.ts';

const RESOURCES_SERVER = 'legal_agent_bench';
const MODEL_TYPE = 'inference_provider';
const LOCK_PATH = resolve(ROOT, 'data', 'dev-server.lock');

/**
 * One local server owns the app. Bun permits multiple listeners on one port,
 * which makes requests round-robin between different source revisions — a
 * disastrous failure mode for development. This lock fails the second launch
 * before it can listen or start Gym.
 */
export async function acquireServerLock(): Promise<() => void> {
  await mkdir(resolve(LOCK_PATH, '..'), { recursive: true });
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try { unlinkNow(LOCK_PATH); } catch { /* Already gone. */ }
  };
  for (;;) {
    try {
      const handle = await open(LOCK_PATH, 'wx', 0o600);
      await handle.writeFile(`${process.pid}\n`);
      await handle.close();
      return release;
    } catch (error: unknown) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
      const pid = Number((await readFile(LOCK_PATH, 'utf8').catch(() => '')).trim());
      // Bun's --watch restart re-enters the app under the watcher PID without
      // running the old process's exit handler. That lock is ours, not a
      // second server; keep it and let the new boot own its cleanup.
      if (pid === process.pid) return release;
      if (Number.isInteger(pid) && pid > 1 && lifecycle.isProcessAlive(pid)) {
        throw new Error(`Another dev server is already running (pid ${pid}). Stop it before starting another.`);
      }
      // A previous process died without running its signal handler. Only its
      // stale lock remains, so remove it and retry the exclusive create.
      try { unlinkNow(LOCK_PATH); } catch { /* Another starter won the race. */ }
    }
  }
}

/**
 * Close out jobs the previous process was still running.
 *
 * Nothing resumes a job across a restart, so an open row is wreckage, not work
 * in progress. Left alone it reads as live forever: the stage that owns it
 * keeps polling and keeps its actions disabled. Boot is the only moment where
 * "still running" can be answered honestly, because no job of ours has started
 * yet.
 */
export async function reconcileInterruptedJobs(): Promise<void> {
  try {
    const closed = await reconcileOrphans();
    if (closed) console.log(`closed ${closed} interrupted job${closed === 1 ? '' : 's'} from the previous process.`);
  } catch (error) {
    // A boot must not fail over bookkeeping.
    console.log(`job reconciliation skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Bring the gym up with the app, unless it is already running or unbuilt. */
async function reportGymReady(resourcesServer: string): Promise<void> {
  // Cold preparation can download several GiB. Keep watching rather than
  // declaring the environment ready merely because its head listener bound.
  for (;;) {
    const gym = await head.health();
    const resources = gym.servers.find((server) => server.processName === resourcesServer);
    if (resources?.healthy) {
      console.log(`gym ready → ${resourcesServer} (${resources.url})`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

export function autostartGym(): void {
  void lifecycle
    .start({ resourcesServer: RESOURCES_SERVER, modelType: MODEL_TYPE })
    .then(({ pid }) => {
      console.log(`gym env start → pid ${pid} (head will be up once prepared)`);
      return reportGymReady(RESOURCES_SERVER);
    })
    .catch((error: unknown) =>
      console.log(`gym env start skipped: ${error instanceof Error ? error.message : String(error)}`),
    );
}

/**
 * Take the gym down with the app — the same SIGINT ladder the Settings stop
 * button uses, so child servers and Ray shut down gracefully rather than
 * orphaning when the dev server dies.
 *
 * The caller waits for this promise on the first Ctrl+C, so Gym has time to
 * receive its shutdown signals. The app still caps that wait at eight seconds
 * and a second Ctrl+C exits immediately.
 */
export async function autostopGym(): Promise<void> {
  try {
    const { stopped, killed } = await lifecycle.stop(8_000);
    if (stopped.length || killed.length) {
      console.log(`gym stopped with the app (${stopped.length} exited, ${killed.length} killed).`);
    }
  } catch {
    // Shutdown must never throw.
  }
}
