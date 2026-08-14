/**
 * Detached process groups for gym subprocesses.
 *
 * Gym starts Ray, uv, and child servers. Killing a pid orphans them; cancel
 * must kill the process group. `setsid` makes the spawned pid the group id.
 * Nothing outside `src/gym/` may spawn a process.
 */
import { gymBin } from '../config.ts';

export type Spawned = {
  pid: number;
  pgid: number;
  wait: () => Promise<number>;
};

export class SpawnError extends Error {}

const SETSID = '/usr/bin/setsid';

/**
 * Run `gym <args>` in `cwd` as a new session. `onLine` is called for each
 * stdout/stderr line so the job ledger can tail the process live.
 */
export function gym(
  args: string[],
  options: {
    cwd: string;
    env?: Record<string, string>;
    onLine?: (line: string, stream: 'out' | 'err') => void | Promise<void>;
  },
): Spawned {
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
