import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchTextWithDiagnostic, startDiagnostic } from '../src/gym/diagnostics.ts';

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('diagnostics', () => {
  it('records request metadata without writing credentials or payloads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'diagnostics-'));
    dirs.push(dir);
    const diagnostic = await startDiagnostic({
      directory: dir,
      name: 'model request',
      metadata: { kind: 'failure_map', model: 'test-model', api_key: 'do-not-write' },
    });

    const response = await fetchTextWithDiagnostic({
      diagnostic,
      label: 'test request',
      url: 'data:text/plain,ok',
      init: { method: 'POST', body: 'private prompt body' },
      timeoutMs: 1000,
    });
    const text = await readFile(diagnostic.path, 'utf8');

    expect(response.text).toBe('ok');
    expect(text).toContain('request start label=test request');
    expect(text).toContain('request response label=test request status=200');
    expect(text).toContain('"api_key":"[redacted]"');
    expect(text).not.toContain('do-not-write');
    expect(text).not.toContain('private prompt body');
  });
});
