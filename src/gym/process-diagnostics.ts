/**
 * TEMP PRIME SUBPROCESS DIAGNOSTICS
 *
 * This file is intentionally isolated so the temporary instrumentation can be
 * removed in one place once Prime's failure mode is understood. It records
 * only command metadata and Prime's own output; API keys are never included.
 */
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const TAIL_LINES = 40;
const TAIL_LINE_LENGTH = 2_000;

export type PrimeProcessDiagnostic = {
  path: string;
  record: (line: string) => Promise<void>;
  tail: () => string[];
};

export async function startPrimeProcessDiagnostic(input: {
  outputDir: string;
  envId: string;
  model: string;
  baseUrl: string;
  apiKeyVar: string;
  split?: string;
  command: string[];
}): Promise<PrimeProcessDiagnostic> {
  const safe = (value: string) => value.replace(/[^a-zA-Z0-9._-]+/g, '-');
  const path = resolve(
    input.outputDir,
    'diagnostics',
    `${safe(input.envId)}-${safe(input.split || 'default')}-prime.log`,
  );
  const tailLines: string[] = [];
  let writes = Promise.resolve();

  // TEMP PRIME SUBPROCESS DIAGNOSTICS: failures here must never break an eval.
  await mkdir(resolve(path, '..'), { recursive: true }).catch(() => undefined);
  await writeFile(
    path,
    [
      '# TEMP PRIME SUBPROCESS DIAGNOSTICS',
      JSON.stringify({
        event: 'started',
        at: new Date().toISOString(),
        env_id: input.envId,
        model: input.model,
        provider_host: providerHost(input.baseUrl),
        api_key_var: input.apiKeyVar,
        command: input.command,
      }),
    ].join('\n') + '\n',
    'utf8',
  ).catch(() => undefined);

  const record = async (line: string) => {
    const clean = line.replace(/\r/g, '');
    tailLines.push(clean.slice(0, TAIL_LINE_LENGTH));
    if (tailLines.length > TAIL_LINES) tailLines.shift();
    writes = writes
      .then(() => appendFile(path, `${clean}\n`, 'utf8'))
      .catch(() => undefined);
    await writes;
  };

  return { path, record, tail: () => [...tailLines] };
}

function providerHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return 'invalid-url';
  }
}
