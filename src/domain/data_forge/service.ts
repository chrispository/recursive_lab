import { resolve } from 'node:path';
import { code, parse } from '../../db/ids.ts';
import { benchmarkRunDir, config } from '../../config.ts';
import { fetchTextWithDiagnostic, providerHost, recordError, startDiagnostic, type Diagnostic } from '../../gym/diagnostics.ts';
import * as audit from '../audit/service.ts';
import * as jobRows from '../jobs/service.ts';
import { isLive } from '../jobs/model.ts';
import * as jobTrace from '../jobs/trace.ts';
import * as prompts from '../prompts/service.ts';
import * as settings from '../../gym/settings.ts';
import * as dataDesigner from '../../gym/data_designer.ts';
import { fingerprintOf } from '../../lib/fingerprint.ts';
import * as repo from './repo.ts';
import type { DataForgeStart, ForgeTopicInput } from './model.ts';

export type { DataForgeSummary, DataForgeStart, DocumentRow, ForgeTopicInput } from './model.ts';

export const byBenchmarkRun = repo.findByBenchmarkRun;
export const documents = repo.listDocuments;

export async function review(
  documentCode: string,
  reviewStatus: 'approved' | 'rejected',
): Promise<{ documentCode: string; dataForgeRunId: number; noveltyStatus: 'passed' | 'rejected' | 'review' }> {
  const parsed = parse(documentCode);
  if (!parsed || parsed.entity !== 'documents') throw new DataForgeError('Select a valid document.');
  if (reviewStatus !== 'approved' && reviewStatus !== 'rejected') throw new DataForgeError('Choose approve or reject.');
  const state = await repo.reviewState(parsed.id);
  if (!state) throw new DataForgeNotFoundError('Document not found.');
  if (state.noveltyStatus === 'rejected') throw new DataForgeError('A rejected novelty result cannot be reviewed or approved.');
  if (reviewStatus === 'approved' && state.noveltyStatus !== 'passed') {
    throw new DataForgeError('Only documents that pass the novelty gate can be approved.');
  }
  const result = await repo.reviewDocument(parsed.id, reviewStatus);
  if (!result) throw new DataForgeNotFoundError('Document not found.');
  await audit.audit('documents', parsed.id, reviewStatus, { reviewStatus });
  return { documentCode, ...result };
}

export class DataForgeError extends Error {}
export class DataForgeNotFoundError extends DataForgeError {}

type CompletionEnvelope = {
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: Record<string, unknown>;
};

type GeneratedDocument = {
  topicName: string;
  title: string;
  documentType: string;
  content: string;
  taskInstruction: string;
  referenceAnswer: string;
  verifierTargets: string[];
};

const GENERATION_PROMPT = 'document-generation';
const MAX_OUTPUT_TOKENS = 24_000;
const DEFAULT_DOCS_PER_TOPIC = 3;
const DEFAULT_NOVELTY_THRESHOLD = 0.22;

/** Start or resume the one forge run attached to the selected failure map. */
export async function start(input: {
  benchmarkRunId: number;
  promptRevisionId?: number;
  backend?: 'data_designer' | 'frontier';
  providerModel?: string;
  docsPerTopic?: number;
  noveltyThreshold?: number;
  autoApprove?: boolean;
}): Promise<DataForgeStart> {
  if (!Number.isInteger(input.benchmarkRunId) || input.benchmarkRunId < 1) {
    throw new DataForgeError('Select a benchmark run.');
  }

  const context = await repo.forgeContext(input.benchmarkRunId);
  if (!context) throw new DataForgeError('Create a failure map before sending this run to Data forge.');

  const existingJob = (await jobRows.listByBenchmarkRun(input.benchmarkRunId))
    .find((job) => job.kind === 'data_forge_run' && isLive(job));
  if (existingJob) throw new DataForgeError('Data forge generation is already running for this benchmark run.');

  const existing = context.dataForgeRunId !== null;
  const backend = existing ? context.backend : input.backend ?? 'data_designer';
  const providerModel = existing ? context.providerModel : (input.providerModel ?? '').trim();
  const docsPerTopic = existing ? context.docsPerTopic : boundedInteger(input.docsPerTopic, DEFAULT_DOCS_PER_TOPIC, 1, 100);
  const noveltyThreshold = existing
    ? context.noveltyThreshold
    : boundedNumber(input.noveltyThreshold, DEFAULT_NOVELTY_THRESHOLD, 0.001, 0.999);
  const autoApprove = existing ? context.autoApprove : input.autoApprove === true;

  const prompt = existing
    ? context.promptRevisionId
      ? await prompts.byId(GENERATION_PROMPT, context.promptRevisionId)
      : null
    : input.promptRevisionId
      ? await prompts.byId(GENERATION_PROMPT, input.promptRevisionId)
      : await prompts.active(GENERATION_PROMPT);
  if (!prompt) throw new DataForgeError('The active document-generation prompt is missing.');
  const provider = await settings.generationProvider(providerModel);
  if (!provider.apiKey) throw new DataForgeError('Configure a generation API key in Settings.');
  if (!provider.model) throw new DataForgeError('Configure a generation model in Settings.');

  const topics = await repo.topicsForRun(
    input.benchmarkRunId,
    context.dataForgeRunId,
    existing ? undefined : docsPerTopic,
  );
  const remaining = topics.filter((topic) => topic.remaining > 0);
  if (!remaining.length) throw new DataForgeError('Every requested document slot for this failure map is filled.');

  let dataForgeRunId = context.dataForgeRunId;
  if (dataForgeRunId === null) {
    dataForgeRunId = await repo.createRun({
      failureMapId: context.failureMapId,
      promptRevisionId: prompt.promptRevisionId,
      backend,
      providerModel: provider.model,
      docsPerTopic,
      noveltyThreshold,
      autoApprove,
      requestedDocuments: topics.length * docsPerTopic,
    });
  }

  const trace = await jobTrace.start('data_forge_run', 'data_forge_runs', dataForgeRunId, {
    step: 'collecting capability topics',
    params: {
      benchmarkRunId: input.benchmarkRunId,
      failureMapId: context.failureMapId,
      promptRevisionId: prompt.promptRevisionId,
      providerModel: provider.model,
      backend,
      requestedDocuments: remaining.reduce((sum, topic) => sum + topic.remaining, 0),
    },
  });
  const diagnostic = await startDiagnostic({
    directory: resolve(benchmarkRunDir(code('benchmark_runs', input.benchmarkRunId)), 'diagnostics'),
    name: `${trace.jobCode}-data-forge`,
    metadata: {
      kind: 'data_forge',
      benchmark_run: code('benchmark_runs', input.benchmarkRunId),
      backend,
      model: provider.model,
      provider_host: providerHost(provider.baseUrl),
      timeout_ms: 180_000,
    },
  });
  await trace.log(`topics to address     ${remaining.length}`);
  await trace.log(`documents requested    ${remaining.reduce((sum, topic) => sum + topic.remaining, 0)}`);
  await trace.log(`prompt revision        REV-${String(prompt.promptRevisionId).padStart(5, '0')}`);
  await trace.log(`generator model        ${provider.model}`);
  await trace.log(`diagnostics           ${diagnostic.path}`);

  void execute({
    benchmarkRunId: input.benchmarkRunId,
    dataForgeRunId,
    failureMapId: context.failureMapId,
    topics: remaining,
    prompt,
    provider,
    backend,
    noveltyThreshold,
    autoApprove,
    trace,
    diagnostic,
  }).catch(async (error) => {
    try {
      await recordError(diagnostic, 'data-forge job', error);
      await trace.fail(error);
    } catch (closeError) {
      console.error(closeError);
    }
  });

  return {
    benchmarkRunId: input.benchmarkRunId,
    dataForgeRunCode: code('data_forge_runs', dataForgeRunId),
    failureMapCode: code('failure_maps', context.failureMapId),
    jobId: trace.jobId,
    jobCode: trace.jobCode,
    requestedDocuments: remaining.reduce((sum, topic) => sum + topic.remaining, 0),
  };
}

async function execute(input: {
  benchmarkRunId: number;
  dataForgeRunId: number;
  failureMapId: number;
  topics: ForgeTopicInput[];
  prompt: { promptRevisionId: number; body: string };
  provider: settings.ProviderConfig;
  backend: 'data_designer' | 'frontier';
  noveltyThreshold: number;
  autoApprove: boolean;
  trace: jobTrace.Trace;
  diagnostic: Diagnostic;
}): Promise<void> {
  const { trace } = input;
  await trace.step('asking the document generator', 0.18);
  const completion = input.backend === 'data_designer'
    ? await dataDesigner.generate({
        provider: input.provider,
        prompt: input.prompt.body,
        topics: input.topics,
        artifactPath: resolve(config.gym.root, 'results/lab/data-forge', code('data_forge_runs', input.dataForgeRunId)),
        diagnostic: input.diagnostic,
      })
    : await complete(input.provider, input.prompt.body, input.topics, input.diagnostic);
  await trace.log(`provider response      ${completion.content.length} characters`);
  if (input.backend === 'data_designer' && typeof completion.usage.attempts === 'number') {
    await trace.log(`data designer attempts ${completion.usage.attempts}`);
  }

  await trace.step('validating document slots', 0.52);
  const output = parseOutput(completion.content, input.topics);
  await trace.log(`documents returned     ${output.length}`);

  const sources = await repo.sourceFingerprints(input.benchmarkRunId);
  const failureItems = await repo.failureItemsByTopic(input.failureMapId);
  const usage = completion.usage;
  let written = 0;

  await trace.step('checking novelty and writing documents', 0.72);
  for (const document of output) {
    const topic = input.topics.find((candidate) => candidate.name === document.topicName);
    if (!topic) throw new DataForgeError(`Generated document references unknown topic '${document.topicName}'.`);
    const failureItemId = failureItems.get(topic.topicId);
    if (!failureItemId) throw new DataForgeError(`Topic '${topic.name}' has no failure item to anchor a document.`);
    const fingerprint = fingerprintOf(document.content);
    const novelty = noveltyOf(fingerprint, sources);
    const ordinal = await repo.nextOrdinal(input.dataForgeRunId, topic.topicId);
    await repo.insertDocument({
      dataForgeRunId: input.dataForgeRunId,
      failureItemId,
      topicId: topic.topicId,
      ordinal,
      title: document.title,
      documentType: document.documentType,
      content: document.content,
      taskInstruction: document.taskInstruction,
      referenceAnswer: document.referenceAnswer,
      verifierTargets: document.verifierTargets,
      contentSha256: fingerprint.contentSha256,
      normalizedSha256: fingerprint.normalizedSha256,
      shingles: fingerprint.shingles,
      wordCount: fingerprint.wordCount,
      maxSimilarity: novelty.maxSimilarity,
      nearestSource: novelty.nearestSource,
      noveltyThreshold: input.noveltyThreshold,
      noveltyStatus: novelty.maxSimilarity >= input.noveltyThreshold ? 'rejected' : 'passed',
      autoApprove: input.autoApprove,
    });
    written += 1;
  }

  await repo.updateUsage(input.dataForgeRunId, usage);
  await audit.audit('data_forge_runs', input.dataForgeRunId, 'generate', {
    benchmarkRunId: input.benchmarkRunId,
    failureMapId: input.failureMapId,
    promptRevisionId: input.prompt.promptRevisionId,
    providerModel: input.provider.model,
    documents: written,
    topics: input.topics.length,
  });
  await trace.succeed(
    {
      dataForgeRunId: code('data_forge_runs', input.dataForgeRunId),
      documents: written,
    },
    'Data forge ready for review',
  );
}

async function complete(
  provider: settings.ProviderConfig,
  prompt: string,
  topics: ForgeTopicInput[],
  diagnostic: Diagnostic,
): Promise<{ content: string; usage: Record<string, unknown> }> {
  const response = await fetchTextWithDiagnostic({
    diagnostic,
    label: 'data-forge generation',
    url: `${provider.baseUrl.replace(/\/$/, '')}/chat/completions`,
    timeoutMs: 180_000,
    init: {
      method: 'POST',
      headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: 'system', content: prompt },
          {
            role: 'user',
            content: JSON.stringify({
              topics: topics.map((topic) => ({
                name: topic.name,
                description: topic.description,
                verifier_strategy: topic.verifierStrategy,
                requested_count: topic.remaining,
              })),
            }),
          },
        ],
        temperature: 0.7,
        max_tokens: MAX_OUTPUT_TOKENS,
      }),
      signal: AbortSignal.timeout(180_000),
    },
  });
  const text = response.text;
  if (!response.ok) throw new DataForgeError(`Generation provider returned HTTP ${response.status}. Diagnostics: ${diagnostic.path}.`);
  let envelope: CompletionEnvelope;
  try {
    envelope = JSON.parse(text) as CompletionEnvelope;
  } catch {
    await recordError(diagnostic, 'data-forge invalid JSON', new Error('Generation provider returned invalid JSON.'));
    throw new DataForgeError(`Generation provider returned invalid JSON. Diagnostics: ${diagnostic.path}.`);
  }
  const content = contentOf(envelope.choices?.[0]?.message?.content);
  if (!content) {
    await recordError(diagnostic, 'data-forge empty completion', new Error('Generation provider returned no completion content.'));
    throw new DataForgeError(`Generation provider returned no completion content. Diagnostics: ${diagnostic.path}.`);
  }
  return { content, usage: envelope.usage ?? {} };
}

function parseOutput(raw: string, topics: ForgeTopicInput[]): GeneratedDocument[] {
  const value = jsonObjectOf(raw);
  if (!value || typeof value !== 'object' || !Array.isArray((value as { documents?: unknown }).documents)) {
    throw new DataForgeError('Document generator output must be a JSON object with a documents array.');
  }
  const expected = new Map(topics.map((topic) => [topic.name, topic.remaining]));
  const seen = new Map<string, number>();
  const documents: GeneratedDocument[] = [];
  for (const [index, rawDocument] of ((value as { documents: unknown[] }).documents).entries()) {
    if (!rawDocument || typeof rawDocument !== 'object') throw new DataForgeError(`Document ${index + 1} is not an object.`);
    const document = rawDocument as Record<string, unknown>;
    const topicName = textField(document, 'topic_name');
    const title = textField(document, 'title');
    const documentType = textField(document, 'document_type');
    const content = textField(document, 'content');
    const taskInstruction = textField(document, 'task_instruction');
    const referenceAnswer = textField(document, 'reference_answer');
    const targets = document.verifier_targets;
    const verifierTargets = Array.isArray(targets) ? targets.map(String).map((item) => item.trim()).filter(Boolean) : [];
    if (!topicName || !title || !documentType || !content || !taskInstruction || !referenceAnswer || !verifierTargets.length) {
      throw new DataForgeError(`Document ${index + 1} is missing a required field.`);
    }
    if (!expected.has(topicName)) throw new DataForgeError(`Document ${index + 1} references unknown topic '${topicName}'.`);
    const count = (seen.get(topicName) ?? 0) + 1;
    seen.set(topicName, count);
    if (count > expected.get(topicName)!) throw new DataForgeError(`Topic '${topicName}' received too many documents.`);
    documents.push({
      topicName,
      title,
      documentType,
      content,
      taskInstruction,
      referenceAnswer,
      verifierTargets,
    });
  }
  for (const [topicName, count] of expected) {
    if ((seen.get(topicName) ?? 0) !== count) {
      throw new DataForgeError(`Topic '${topicName}' received ${seen.get(topicName) ?? 0} of ${count} requested documents.`);
    }
  }
  if (!documents.length) throw new DataForgeError('Document generator returned no documents.');
  return documents;
}

function noveltyOf(
  fingerprint: ReturnType<typeof fingerprintOf>,
  sources: Array<{ contentSha256: string; normalizedSha256: string; shingles: string[] }>,
) {
  let maxSimilarity = 0;
  let nearestSource: string | null = null;
  for (const source of sources) {
    const similarity = source.contentSha256 === fingerprint.contentSha256 || source.normalizedSha256 === fingerprint.normalizedSha256
      ? 1
      : jaccard(fingerprint.shingles, source.shingles);
    if (similarity > maxSimilarity) {
      maxSimilarity = similarity;
      nearestSource = source.contentSha256;
    }
  }
  return { maxSimilarity, nearestSource };
}

function jaccard(left: string[], right: string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection / new Set([...a, ...b]).size;
}

function jsonObjectOf(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  if (!candidate || !candidate.startsWith('{')) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function contentOf(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!Array.isArray(value)) return '';
  return value.map((part) => {
    if (typeof part === 'string') return part;
    if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') return (part as { text: string }).text;
    return '';
  }).join('').trim();
}

function textField(value: Record<string, unknown>, key: string): string {
  return typeof value[key] === 'string' ? value[key]!.trim() : '';
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  const candidate = Number.isFinite(value) ? Math.trunc(value!) : fallback;
  if (candidate < min || candidate > max) throw new DataForgeError(`Documents per topic must be between ${min} and ${max}.`);
  return candidate;
}

function boundedNumber(value: number | undefined, fallback: number, min: number, max: number): number {
  const candidate = Number.isFinite(value) ? value! : fallback;
  if (candidate <= min || candidate >= max) throw new DataForgeError(`Novelty threshold must be greater than ${min} and less than ${max}.`);
  return candidate;
}
