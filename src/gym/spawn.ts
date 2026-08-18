/**
 * Detached process groups for gym subprocesses.
 *
 * Gym starts Ray, uv, and child servers. Killing a pid orphans them; cancel
 * must kill the process group. `setsid` makes the spawned pid the group id.
 * Nothing outside `src/gym/` may spawn a process.
 */
import { appendFileSync, closeSync, mkdirSync, openSync } from 'node:fs';
import { resolve } from 'node:path';
import { gymBin } from '../config.ts';

export type Spawned = {
  pid: number;
  pgid: number;
  wait: () => Promise<number>;
};

export class SpawnError extends Error {}

const SETSID = '/usr/bin/setsid';

export type SpawnOptions = {
  cwd: string;
  env?: Record<string, string>;
  onLine?: (line: string, stream: 'out' | 'err') => void | Promise<void>;
  /**
   * How the child's output reaches the world. `pipe` (default) streams lines
   * to `onLine` — but pipes die with this process, so a child meant to
   * outlive its spawner (the gym head, restarted by a sync job that may run
   * in a short-lived process) needs `file`, which appends straight to
   * `logPath` and never breaks when the parent exits.
   */
  stdio?: 'pipe' | 'file';
  /** Required when `stdio` is `file`. */
  logPath?: string;
};

export function gym(args: string[], options: SpawnOptions): Spawned {
  if (options.stdio === 'file') {
    if (!options.logPath) throw new SpawnError('A log path is required when gym stdio is a file.');
    return gymLogged(args, options.cwd, options.logPath, options.env);
  }
  return gymPiped(args, options);
}

/**
 * The detached, log-file form. The child gets real append-mode file
 * descriptors for stdio, so it writes the log directly — no pipes, no pump,
 * nothing that breaks or buffers in this process. It outlives its spawner
 * unconditionally, which is the entire point.
 */
function gymLogged(args: string[], cwd: string, logPath: string, env?: Record<string, string>): Spawned {
  mkdirSync(resolve(logPath, '..'), { recursive: true });
  appendFileSync(logPath, `\n$ gym ${args.join(' ')}\n`);
  const out = openSync(logPath, 'a');
  let err = out;
  try {
    // Separate fd for stderr keeps interleaving honest; fall back to stdout.
    err = openSync(logPath, 'a');
  } catch {
    err = out;
  }
  const proc = Bun.spawn([SETSID, gymBin(), ...args], {
    cwd,
    env: { ...process.env, PYTHONUNBUFFERED: '1', ...env } as Record<string, string>,
    stdin: 'ignore',
    stdout: out,
    stderr: err,
  });
  // The child dup'd these at spawn; our copies can close immediately.
  closeSync(out);
  if (err !== out) closeSync(err);
  const pid = proc.pid;
  if (!pid) throw new SpawnError('gym process started without a pid.');
  return { pid, pgid: pid, wait: () => proc.exited };
}

function gymPiped(args: string[], options: SpawnOptions): Spawned {
  const proc = Bun.spawn([SETSID, gymBin(), ...args], {
    cwd: options.cwd,
    env: { ...process.env, PYTHONUNBUFFERED: '1', ...options.env } as Record<string, string>,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const pid = proc.pid;
  if (!pid) throw new SpawnError('gym process started without a pid.');

  const pump = async (stream: ReadableStream<Uint8Array>, name: 'out' | 'err') => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.length) await options.onLine?.(line, name);
      }
    }
    if (buffer.length) await options.onLine?.(buffer, name);
  };

  const finished = Promise.all([
    pump(proc.stdout, 'out'),
    pump(proc.stderr, 'err'),
    proc.exited,
  ]).then(([, , code]) => code);

  return {
    pid,
    pgid: pid,
    wait: () => finished,
  };
}

/** SIGTERM the whole group. Safe if the process has already exited. */
export function killGroup(pgid: number): void {
  try {
    process.kill(-pgid, 'SIGTERM');
  } catch {
    // Already gone.
  }
}
