import { resolve } from 'node:path';
import { config } from '../config.ts';
import { recordError, type Diagnostic } from './diagnostics.ts';
import type { ProviderConfig } from './settings.ts';

export type DataDesignerTopic = {
  name: string;
  description: string;
  verifierStrategy: string;
  remaining: number;
};

type DataDesignerResponse = {
  documents?: Array<Record<string, unknown>>;
  errors?: string[];
};

export class DataDesignerError extends Error {}

/** Run the project-local NVIDIA Data Designer library through its Python adapter. */
export async function generate(input: {
  provider: ProviderConfig;
  prompt: string;
  topics: DataDesignerTopic[];
  artifactPath: string;
  diagnostic?: Diagnostic;
}): Promise<{ content: string; usage: Record<string, unknown> }> {
  const pending = input.topics.map((topic) => ({ ...topic }));
  const documents: Array<Record<string, unknown>> = [];
  const diagnostics: string[] = [];
  const requested = pending.reduce((sum, topic) => sum + topic.remaining, 0);
  let attemptsUsed = 0;

  for (let attempt = 1; attempt <= 3 && pending.length > 0; attempt += 1) {
    attemptsUsed = attempt;
    await input.diagnostic?.record(`data-designer attempt start attempt=${attempt} pending_slots=${pending.reduce((sum, topic) => sum + topic.remaining, 0)}`);
    const result = await runOnce({
      ...input,
      topics: pending,
      artifactPath: resolve(input.artifactPath, `attempt-${attempt}`),
    }).catch(async (error: unknown) => {
      diagnostics.push(error instanceof Error ? error.message : String(error));
      if (input.diagnostic) await recordError(input.diagnostic, `data-designer attempt ${attempt}`, error);
      return null;
    });

    if (result) {
      const capacity = new Map(pending.map((topic) => [topic.name, topic.remaining]));
      const accepted: Array<Record<string, unknown>> = [];
      for (const document of result.documents) {
        const topicName = typeof document.topic_name === 'string' ? document.topic_name : '';
        const slots = capacity.get(topicName) ?? 0;
        if (slots > 0) {
          capacity.set(topicName, slots - 1);
          accepted.push(document);
        } else {
          diagnostics.push(`Data Designer returned an unexpected or duplicate topic '${topicName || '(empty)'}'.`);
        }
      }
      documents.push(...accepted);
      if (result.errors?.length) diagnostics.push(...result.errors);
      await input.diagnostic?.record(`data-designer attempt response attempt=${attempt} documents=${result.documents.length} errors=${result.errors?.length ?? 0}`);

      for (const topic of pending) topic.remaining = capacity.get(topic.name) ?? 0;
      for (let index = pending.length - 1; index >= 0; index -= 1) {
        const topic = pending[index];
        if (topic?.remaining === 0) pending.splice(index, 1);
      }
    }

    if (pending.length > 0 && attempt < 3) await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
  }

  if (pending.length > 0) {
    const missing = pending.map((topic) => `${topic.name} (${topic.remaining})`).join('; ');
    const detail = diagnostics.slice(-3).join(' | ');
    throw new DataDesignerError(
      `Data Designer filled ${documents.length}/${requested} document slots after 3 attempts. ` +
      `Missing: ${missing}.${detail ? ` Diagnostics: ${detail}` : ''}${input.diagnostic ? ` See diagnostics: ${input.diagnostic.path}.` : ''}`,
    );
  }
  return {
    content: JSON.stringify({ documents }),
    usage: {
      attempts: attemptsUsed,
      retries: Math.max(0, attemptsUsed - 1),
      requested_documents: requested,
      generated_documents: documents.length,
    },
  };
}

async function runOnce(input: {
  provider: ProviderConfig;
  prompt: string;
  topics: DataDesignerTopic[];
  artifactPath: string;
  diagnostic?: Diagnostic;
}): Promise<DataDesignerResponse & { documents: Array<Record<string, unknown>> }> {
  const python = resolve(config.gym.root, 'recursive_workspace/.data-designer-venv/bin/python');
  const script = resolve(import.meta.dir, 'data_designer_runner.py');
  if (!await Bun.file(python).exists()) {
    throw new DataDesignerError(`Data Designer is not installed at ${python}.`);
  }

  const payload = JSON.stringify(input);
  const child = Bun.spawn([python, script], {
    cwd: config.gym.root,
    env: { ...process.env, NEMO_TELEMETRY_ENABLED: 'false' } as Record<string, string>,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  await input.diagnostic?.record(`data-designer spawned pid=${child.pid} attempt_artifact=${input.artifactPath}`);
  child.stdin.write(payload);
  child.stdin.end();

  const startedAt = Date.now();
  const heartbeat = setInterval(() => {
    void input.diagnostic?.record(`data-designer heartbeat elapsed_ms=${Date.now() - startedAt}`);
  }, 30_000);
  let stdout: string;
  let stderr: string;
  let exitCode: number;
  try {
    [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
  } finally {
    clearInterval(heartbeat);
  }
  await input.diagnostic?.record(`data-designer process exited code=${exitCode} stdout_bytes=${new TextEncoder().encode(stdout).byteLength} stderr_bytes=${new TextEncoder().encode(stderr).byteLength}`);
  if (exitCode !== 0) {
    const detail = stderr.trim().slice(-2_000);
    await input.diagnostic?.record(`data-designer process error detail=${detail || `exit_code=${exitCode}`}`);
    throw new DataDesignerError(detail || `Data Designer exited with code ${exitCode}.`);
  }

  let result: DataDesignerResponse;
  try {
    result = JSON.parse(stdout) as DataDesignerResponse;
  } catch {
    await input.diagnostic?.record('data-designer returned invalid JSON');
    throw new DataDesignerError('Data Designer returned invalid JSON.');
  }
  if (!Array.isArray(result.documents) || !result.documents.length) {
    await input.diagnostic?.record(`data-designer returned no documents errors=${result.errors?.length ?? 0}`);
    throw new DataDesignerError(result.errors?.join(' ') || 'Data Designer returned no documents.');
  }
  return { ...result, documents: result.documents };
}
