import { resolve } from 'node:path';
import { config } from '../config.ts';
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
}): Promise<{ content: string; usage: Record<string, unknown> }> {
  const pending = input.topics.map((topic) => ({ ...topic }));
  const documents: Array<Record<string, unknown>> = [];
  const diagnostics: string[] = [];
  const requested = pending.reduce((sum, topic) => sum + topic.remaining, 0);
  let attemptsUsed = 0;

  for (let attempt = 1; attempt <= 3 && pending.length > 0; attempt += 1) {
    attemptsUsed = attempt;
    const result = await runOnce({
      ...input,
      topics: pending,
      artifactPath: resolve(input.artifactPath, `attempt-${attempt}`),
    }).catch((error: unknown) => {
      diagnostics.push(error instanceof Error ? error.message : String(error));
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
      `Missing: ${missing}.${detail ? ` Diagnostics: ${detail}` : ''}`,
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
  child.stdin.write(payload);
  child.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    const detail = stderr.trim().slice(-2_000);
    throw new DataDesignerError(detail || `Data Designer exited with code ${exitCode}.`);
  }

  let result: DataDesignerResponse;
  try {
    result = JSON.parse(stdout) as DataDesignerResponse;
  } catch {
    throw new DataDesignerError('Data Designer returned invalid JSON.');
  }
  if (!Array.isArray(result.documents) || !result.documents.length) {
    throw new DataDesignerError(result.errors?.join(' ') || 'Data Designer returned no documents.');
  }
  return { ...result, documents: result.documents };
}
