/**
 * Sanitized diagnostics for long-running model and Gym work.
 *
 * Job logs remain the short operator-facing stream. These sidecars retain the
 * useful process/request timeline without recording prompts, responses, or
 * credentials. Diagnostic writes are best effort and never cause the work to
 * fail.
 */
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const TAIL_LINES = 40;
const TAIL_LINE_LENGTH = 2_000;

export type Diagnostic = {
  path: string;
  record: (line: string) => Promise<void>;
  tail: () => string[];
};

type DiagnosticValue = string | number | boolean | null | undefined | string[];

export async function startDiagnostic(input: {
  directory: string;
  name: string;
  metadata?: Record<string, DiagnosticValue>;
}): Promise<Diagnostic> {
  const path = resolve(input.directory, `${safeName(input.name)}.log`);
  const tailLines: string[] = [];
  let writes = Promise.resolve();

  const metadata = Object.fromEntries(
    Object.entries(input.metadata ?? {}).map(([key, value]) => [key, redactMetadata(key, value)]),
  );
  await mkdir(resolve(path, '..'), { recursive: true }).catch(() => undefined);
  await writeFile(
    path,
    `${JSON.stringify({ event: 'started', at: new Date().toISOString(), ...metadata })}\n`,
    'utf8',
  ).catch(() => undefined);

  const record = async (line: string) => {
    const clean = line.replace(/\r/g, '').slice(0, TAIL_LINE_LENGTH);
    tailLines.push(clean);
    if (tailLines.length > TAIL_LINES) tailLines.shift();
    writes = writes
      .then(() => appendFile(path, `${clean}\n`, 'utf8'))
      .catch(() => undefined);
    await writes;
  };

  return { path, record, tail: () => [...tailLines] };
}

export type DiagnosticResponse = {
  status: number;
  ok: boolean;
  text: string;
  contentType: string;
};

export class DiagnosticRequestError extends Error {
  constructor(message: string, readonly diagnosticPath: string) {
    super(`${message} Diagnostics: ${diagnosticPath}.`);
    this.name = 'DiagnosticRequestError';
  }
}

/** Fetch a model response while logging only request/response metadata. */
export async function fetchTextWithDiagnostic(input: {
  diagnostic: Diagnostic;
  label: string;
  url: string;
  init: RequestInit;
  timeoutMs: number;
}): Promise<DiagnosticResponse> {
  const startedAt = Date.now();
  const method = input.init.method ?? 'GET';
  const requestBytes = typeof input.init.body === 'string' ? new TextEncoder().encode(input.init.body).byteLength : 0;
  const heartbeat = setInterval(() => {
    void input.diagnostic.record(`request heartbeat label=${input.label} elapsed_ms=${Date.now() - startedAt}`);
  }, 30_000);
  await input.diagnostic.record(
    `request start label=${input.label} method=${method} target=${targetOf(input.url)} timeout_ms=${input.timeoutMs} request_bytes=${requestBytes}`,
  );
  try {
    const response = await fetch(input.url, input.init);
    const text = await response.text();
    await input.diagnostic.record(
      `request response label=${input.label} status=${response.status} response_bytes=${new TextEncoder().encode(text).byteLength} content_type=${response.headers.get('content-type') ?? 'unknown'} elapsed_ms=${Date.now() - startedAt}`,
    );
    return {
      status: response.status,
      ok: response.ok,
      text,
      contentType: response.headers.get('content-type') ?? '',
    };
  } catch (error) {
    await input.diagnostic.record(`request error label=${input.label} elapsed_ms=${Date.now() - startedAt} error=${errorText(error)}`);
    throw new DiagnosticRequestError(errorText(error), input.diagnostic.path);
  } finally {
    clearInterval(heartbeat);
  }
}

export async function recordError(diagnostic: Diagnostic, label: string, error: unknown): Promise<void> {
  await diagnostic.record(`error label=${label} error=${errorText(error)}`);
}

export function providerHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return 'invalid-url';
  }
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, TAIL_LINE_LENGTH);
  return String(error).slice(0, TAIL_LINE_LENGTH);
}

function targetOf(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.host}${url.pathname}`;
  } catch {
    return 'invalid-url';
  }
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function redactMetadata(key: string, value: DiagnosticValue): DiagnosticValue {
  if (/(api[_-]?key|token|secret|password|authorization)/i.test(key)) return '[redacted]';
  return value;
}
