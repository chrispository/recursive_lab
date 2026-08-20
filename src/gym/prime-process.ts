/**
 * Prime subprocess lifecycle: detached process groups, output capture,
 * heartbeats, timeout handling, and sanitized diagnostics.
 *
 * `pi.ts` owns Prime command construction and result parsing; this module owns
 * everything that can leave a child process or its pipes hanging.
 */
import { startDiagnostic, type Diagnostic, errorText } from './diagnostics.ts';

const SETSID = '/usr/bin/setsid';
const HEARTBEAT_MS = 30_000;
const DRAIN_GRACE_MS = 2_000;
const DRAIN_LINGER_MS = 500;

export type PrimeProcessRequest = {
  command: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  diagnostic: {
    directory: string;
    name: string;
    metadata: Record<string, string | number | boolean | null | undefined | string[]>;
  };
  onLine?: (line: string, stream: 'out' | 'err') => void | Promise<void>;
  onSpawn?: (pgid: number) => void | Promise<void>;
};

export type PrimeProcessResult = {
  exitCode: number;
  timedOut: boolean;
  diagnostic: Diagnostic;
};

export class PrimeProcessError extends Error {
  constructor(
    message: string,
    readonly diagnosticPath: string,
    readonly timedOut: boolean,
  ) {
    super(message);
    this.name = 'PrimeProcessError';
  }
}

export async function runPrimeProcess(input: PrimeProcessRequest): Promise<PrimeProcessResult> {
  const diagnostic = await startDiagnostic({
    directory: input.diagnostic.directory,
    name: input.diagnostic.name,
    metadata: {
      ...input.diagnostic.metadata,
      command: input.command,
    },
  });
  await diagnostic.record(`command=${input.command.join(' ')}`);

  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([SETSID, ...input.command], {
      cwd: input.cwd,
      env: { ...process.env, ...input.env } as Record<string, string>,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });
  } catch (error) {
    await diagnostic.record(`spawn failed error=${errorText(error)}`);
    throw new PrimeProcessError(`Prime process failed to spawn. Prime diagnostics: ${diagnostic.path}.`, diagnostic.path, false);
  }

  const pid = proc.pid;
  if (!pid) {
    await diagnostic.record('spawn failed error=process started without a pid');
    throw new PrimeProcessError(`Prime process started without a pid. Prime diagnostics: ${diagnostic.path}.`, diagnostic.path, false);
  }
  await diagnostic.record(`spawned pid=${pid}`);
  await input.onSpawn?.(pid);

  let timedOut = false;
  let outputLines = 0;
  let lastOutputAt = Date.now();
  const startedAt = Date.now();
  const timer = setTimeout(() => {
    timedOut = true;
    void diagnostic.record(`timeout reached elapsed_ms=${Date.now() - startedAt} timeout_ms=${input.timeoutMs} sending_sigterm_pgid=${pid}`);
    try {
      process.kill(-pid, 'SIGTERM');
    } catch (error) {
      void diagnostic.record(`timeout kill failed error=${errorText(error)}`);
    }
  }, input.timeoutMs);
  const heartbeat = setInterval(() => {
    void diagnostic.record(
      `heartbeat elapsed_ms=${Date.now() - startedAt} idle_ms=${Date.now() - lastOutputAt} output_lines=${outputLines} timed_out=${timedOut}`,
    );
  }, HEARTBEAT_MS);

  const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
  const pump = async (stream: ReadableStream<Uint8Array>, name: 'out' | 'err') => {
    const reader = stream.getReader();
    readers.push(reader);
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.length) continue;
        outputLines += 1;
        lastOutputAt = Date.now();
        await diagnostic.record(`[${name}] ${line}`);
        await input.onLine?.(line, name);
      }
    }
    if (buffer.length) {
      outputLines += 1;
      lastOutputAt = Date.now();
      await diagnostic.record(`[${name}] ${buffer}`);
      await input.onLine?.(buffer, name);
    }
  };

  const exitPromise = proc.exited.then(async (exitCode) => {
    await diagnostic.record(`process exited code=${exitCode} elapsed_ms=${Date.now() - startedAt}`);
    return exitCode;
  });
  const pumps = Promise.all([
    pump(proc.stdout as ReadableStream<Uint8Array>, 'out'),
    pump(proc.stderr as ReadableStream<Uint8Array>, 'err'),
  ]);

  try {
    const streamsDrained = await Promise.race([
      pumps.then(() => true),
      exitPromise.then(() => delay(DRAIN_GRACE_MS).then(() => false)),
    ]);
    const exitCode = await exitPromise;
    if (!streamsDrained) {
      await diagnostic.record('output streams did not close after process exit; cancelling readers');
      await Promise.all(readers.map((reader) => reader.cancel().catch(() => undefined)));
      await Promise.race([pumps.catch(() => undefined), delay(DRAIN_LINGER_MS)]);
      void pumps.catch(() => undefined);
    } else {
      await pumps;
    }
    await diagnostic.record(`finished timed_out=${timedOut} output_lines=${outputLines} diagnostic=${diagnostic.path}`);
    if (exitCode !== 0 || timedOut) {
      const tail = diagnostic.tail().slice(-12).join('\n');
      const reason = timedOut ? `timed out after ${input.timeoutMs}ms` : `exited with code ${exitCode}`;
      throw new PrimeProcessError(
        `Prime eval ${reason} for ${input.diagnostic.metadata.env_id ?? 'environment'}. Prime diagnostics: ${diagnostic.path}.${tail ? `\nLast Prime output:\n${tail}` : ''}`,
        diagnostic.path,
        timedOut,
      );
    }
    return { exitCode, timedOut, diagnostic };
  } finally {
    clearTimeout(timer);
    clearInterval(heartbeat);
  }
}

const delay = (milliseconds: number) => new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds));
