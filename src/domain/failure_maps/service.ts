import { code } from '../../db/ids.ts';
import * as settings from '../../gym/settings.ts';
import * as audit from '../audit/service.ts';
import * as jobRows from '../jobs/service.ts';
import { isLive } from '../jobs/model.ts';
import * as jobTrace from '../jobs/trace.ts';
import * as prompts from '../prompts/service.ts';
import * as repo from './repo.ts';
import type { FailureCandidate, FailureMapOutput, FailureMapStart, FailureTopicDraft } from './model.ts';

export type { FailureCandidate, FailureMapOutput, FailureMapStart } from './model.ts';

export class FailureMapError extends Error {}

type CompletionEnvelope = {
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: Record<string, unknown>;
};

const ANALYSIS_PROMPT = 'failure-analysis';
const MAX_OUTPUT_TOKENS = 8192;

export const byBenchmarkRun = repo.findByRun;

/** Open the ledger job; the provider call and all writes happen in the background. */
export async function start(input: { benchmarkRunId: number; providerModel?: string }): Promise<FailureMapStart> {
  if (!Number.isInteger(input.benchmarkRunId) || input.benchmarkRunId < 1) {
    throw new FailureMapError('Select a benchmark run.');
  }

  const existing = await repo.findByRun(input.benchmarkRunId);
  if (existing) throw new FailureMapError('This benchmark run already has a failure map.');

  const running = (await jobRows.listByBenchmarkRun(input.benchmarkRunId))
    .find((job) => job.kind === 'failure_map' && isLive(job));
  if (running) throw new FailureMapError('Failure-map analysis is already running for this benchmark run.');

  const resultId = await repo.benchmarkResultIdForRun(input.benchmarkRunId);
  if (!resultId) throw new FailureMapError('This benchmark run has no benchmark result yet.');

  const candidates = await repo.listCandidates(input.benchmarkRunId);
  if (!candidates.length) throw new FailureMapError('This benchmark run has no failed criteria to analyse.');

  const prompt = await prompts.active(ANALYSIS_PROMPT);
  if (!prompt) throw new FailureMapError('The active failure-analysis prompt is missing.');

  const provider = await settings.analysisProvider(input.providerModel ?? '');
  if (!provider.apiKey) throw new FailureMapError('Configure an analysis or judge API key in Settings.');
  if (!provider.model) throw new FailureMapError('Configure an analysis or judge model in Settings.');

  const trace = await jobTrace.start('failure_map', 'benchmark_runs', input.benchmarkRunId, {
    step: 'collecting failed criteria',
    params: {
      benchmarkRunId: input.benchmarkRunId,
      failedCriteria: candidates.length,
      promptRevisionId: prompt.promptRevisionId,
      providerModel: provider.model,
    },
  });
  await trace.log(`failed criteria       ${candidates.length}`);
  await trace.log(`prompt revision       REV-${String(prompt.promptRevisionId).padStart(5, '0')}`);
  await trace.log(`analyst model         ${provider.model}`);

  void execute({
    benchmarkRunId: input.benchmarkRunId,
    benchmarkResultId: resultId,
    candidates,
    prompt,
    provider,
    trace,
  }).catch(async (error) => {
    try {
      await trace.fail(error);
    } catch (closeError) {
      console.error(closeError);
    }
  });

  return {
    benchmarkRunId: input.benchmarkRunId,
    benchmarkRunCode: code('benchmark_runs', input.benchmarkRunId),
    jobId: trace.jobId,
    jobCode: trace.jobCode,
  };
}

async function execute(input: {
  benchmarkRunId: number;
  benchmarkResultId: number;
  candidates: FailureCandidate[];
  prompt: { promptRevisionId: number; body: string };
  provider: settings.ProviderConfig;
  trace: jobTrace.Trace;
}): Promise<void> {
  const { trace } = input;
  await trace.step('asking the failure analyst', 0.18);
  const completion = await complete(input.provider, input.prompt.body, input.candidates);
  await trace.log(`provider response     ${completion.content.length} characters`);

  await trace.step('validating topic coverage', 0.72);
  const output = parseOutput(completion.content, input.candidates);
  await trace.log(`topics returned       ${output.topics.length}`);
  await trace.log(`failures assigned     ${input.candidates.length}`);

  await trace.step('writing failure map', 0.9);
  const saved = await repo.saveAnalysis({
    benchmarkResultId: input.benchmarkResultId,
    promptRevisionId: input.prompt.promptRevisionId,
    providerModel: input.provider.model,
    usage: completion.usage,
    rawOutput: { content: completion.content, parsed: output },
    candidates: input.candidates,
    output,
  });
  await audit.audit('failure_maps', saved.failureMapId, 'create', {
    benchmarkResultId: input.benchmarkResultId,
    benchmarkRunId: input.benchmarkRunId,
    promptRevisionId: input.prompt.promptRevisionId,
    providerModel: input.provider.model,
    failedCriteria: input.candidates.length,
    topics: output.topics.length,
  });
  await trace.succeed(
    {
      failureMapId: code('failure_maps', saved.failureMapId),
      failedCriteria: input.candidates.length,
      topics: output.topics.length,
    },
    'Failure map ready',
  );
}

async function complete(
  provider: settings.ProviderConfig,
  prompt: string,
  candidates: FailureCandidate[],
): Promise<{ content: string; usage: Record<string, unknown> }> {
  const response = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: provider.model,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: JSON.stringify({ failures: candidates.map(analysisInput) }) },
      ],
      temperature: 0,
      max_tokens: MAX_OUTPUT_TOKENS,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  if (!response.ok) throw new FailureMapError(`Analysis provider returned HTTP ${response.status}.`);

  let envelope: CompletionEnvelope;
  try {
    envelope = JSON.parse(text) as CompletionEnvelope;
  } catch {
    throw new FailureMapError('Analysis provider returned invalid JSON.');
  }
  const content = contentOf(envelope.choices?.[0]?.message?.content);
  if (!content) throw new FailureMapError('Analysis provider returned no completion content.');
  return { content, usage: envelope.usage ?? {} };
}

function analysisInput(candidate: FailureCandidate) {
  return {
    failure_id: code('criterion_results', candidate.criterionResultId),
    criterion_title: candidate.criterionTitle,
    judge_reasoning: candidate.reasoning,
  };
}

function contentOf(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!Array.isArray(value)) return '';
  return value
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
        return (part as { text: string }).text;
      }
      return '';
    })
    .join('')
    .trim();
}

function parseOutput(raw: string, candidates: FailureCandidate[]): FailureMapOutput {
  const json = jsonObjectOf(raw);
  if (!json || typeof json !== 'object' || !Array.isArray((json as { topics?: unknown }).topics)) {
    throw new FailureMapError('Failure analyst output must be a JSON object with a topics array.');
  }

  const expected = new Set(candidates.map((candidate) => code('criterion_results', candidate.criterionResultId)));
  const assigned = new Set<string>();
  const slugs = new Set<string>();
  const topics: FailureTopicDraft[] = [];
  for (const [index, rawTopic] of ((json as { topics: unknown[] }).topics).entries()) {
    if (!rawTopic || typeof rawTopic !== 'object') throw new FailureMapError(`Topic ${index + 1} is not an object.`);
    const topic = rawTopic as Record<string, unknown>;
    const name = textField(topic, 'name');
    const description = textField(topic, 'description');
    const verifierStrategy = textField(topic, 'verifier_strategy');
    const failureIds = topic.failure_ids;
    if (!name || !description || !verifierStrategy || !Array.isArray(failureIds) || !failureIds.length) {
      throw new FailureMapError(`Topic ${index + 1} is missing name, description, verifier_strategy, or failure_ids.`);
    }
    const slug = slugOf(name);
    if (!slug || slugs.has(slug)) throw new FailureMapError(`Topic names must be unique: ${name}.`);
    slugs.add(slug);
    const ids = failureIds.map(String);
    for (const failureId of ids) {
      if (!expected.has(failureId)) throw new FailureMapError(`Failure analyst returned unknown ${failureId}.`);
      if (assigned.has(failureId)) throw new FailureMapError(`Failure ${failureId} was assigned more than once.`);
      assigned.add(failureId);
    }
    topics.push({ name, slug, description, verifierStrategy, failureIds: ids });
  }

  const missing = [...expected].filter((failureId) => !assigned.has(failureId));
  if (missing.length) throw new FailureMapError(`Failure analyst omitted ${missing.length} criterion failure(s).`);
  if (!topics.length) throw new FailureMapError('Failure analyst returned no topics.');
  return { topics };
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

function textField(value: Record<string, unknown>, key: string): string {
  return typeof value[key] === 'string' ? value[key]!.trim() : '';
}

function slugOf(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}
