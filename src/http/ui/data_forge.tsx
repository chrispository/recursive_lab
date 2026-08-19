import { Elysia } from 'elysia';
import * as dataForge from '../../domain/data_forge/service.ts';
import * as jobs from '../../domain/jobs/service.ts';
import * as progress from '../../domain/progress/service.ts';
import * as prompts from '../../domain/prompts/service.ts';
import { Badge } from '../../views/ui/Badge.tsx';
import { DataForgeStatus, PromptCard } from '../../views/tabs/DataForge.tsx';

const message = (error: unknown) => (error instanceof Error ? error.message : 'Unexpected error.');

function runIdOf(body: unknown): number {
  const source = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const raw = source.benchmark_run_id ?? source.run_id;
  return typeof raw === 'number' ? raw : Number(raw);
}

function inputOf(body: unknown): Parameters<typeof dataForge.start>[0] {
  const source = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const rawPrompt = source.prompt_revision_id;
  const rawDocs = source.docs_per_topic;
  const rawThreshold = source.novelty_threshold;
  return {
    benchmarkRunId: runIdOf(body),
    promptRevisionId: typeof rawPrompt === 'number' ? rawPrompt : Number(rawPrompt),
    backend: source.backend === 'frontier' ? 'frontier' : 'data_designer',
    providerModel: typeof source.provider_model === 'string' ? source.provider_model.trim() : undefined,
    docsPerTopic: typeof rawDocs === 'number' ? rawDocs : Number(rawDocs),
    noveltyThreshold: typeof rawThreshold === 'number' ? rawThreshold : Number(rawThreshold),
    autoApprove: source.auto_approve === 'on' || source.auto_approve === 'true' || source.auto_approve === true,
  };
}

function errorStatus(text: string) {
  return <div id="data-forge-status" class="m-analysis-status"><Badge state="failed">unable to start</Badge><span>{text}</span></div>;
}

async function latestJob(runId: number) {
  const rows = await jobs.listByBenchmarkRun(runId);
  return [...rows].reverse().find((job) => job.kind === 'data_forge_run') ?? null;
}

async function promptCard(runId: number, requestedRevisionId?: number, notice = '', noticeKind: 'success' | 'error' = 'success') {
  const current = Number.isInteger(runId) && runId > 0 ? await dataForge.byBenchmarkRun(runId) : null;
  const revisions = await prompts.list('document-generation');
  const pinnedRevisionId = current?.promptRevisionId ?? null;
  const selectedRevisionId = pinnedRevisionId ?? requestedRevisionId;
  let prompt = selectedRevisionId
    ? await prompts.byId('document-generation', selectedRevisionId)
    : await prompts.active('document-generation');
  if (!prompt && !pinnedRevisionId) prompt = await prompts.active('document-generation');
  return (
    <PromptCard
      prompt={prompt}
      revisions={revisions}
      benchmarkRunId={Number.isInteger(runId) && runId > 0 ? runId : null}
      promptRevisionLocked={Boolean(pinnedRevisionId)}
      notice={notice}
      noticeKind={noticeKind}
    />
  );
}

export const dataForgeUi = new Elysia({ name: 'data-forge-ui' })
  .post('/ui/data-forge/start', async ({ body }) => {
    const benchmarkRunId = runIdOf(body);
    try {
      await dataForge.start(inputOf(body));
      return <DataForgeStatus runId={benchmarkRunId} job={await latestJob(benchmarkRunId)} progress={await progress.byBenchmarkRun(benchmarkRunId)} />;
    } catch (error) {
      return errorStatus(message(error));
    }
  })
  .get('/ui/data-forge/status', async ({ query }) => {
    const benchmarkRunId = Number(query.run);
    if (!Number.isInteger(benchmarkRunId) || benchmarkRunId < 1) return errorStatus('Select a benchmark run.');
    return (
      <DataForgeStatus
        runId={benchmarkRunId}
        job={await latestJob(benchmarkRunId)}
        progress={await progress.byBenchmarkRun(benchmarkRunId)}
        refreshWhenReady
      />
    );
  })
  .get('/ui/data-forge/prompt', async ({ query }) => {
    const runId = Number(query.run);
    const revisionId = Number(query.prompt_revision_id);
    return promptCard(runId, Number.isInteger(revisionId) && revisionId > 0 ? revisionId : undefined);
  })
  .post('/ui/data-forge/prompt/revisions', async ({ body }) => {
    const source = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const runId = Number(source.benchmark_run_id);
    const current = await promptCard(runId, Number(source.prompt_revision_id));
    try {
      const revision = await prompts.saveAsNewRevision({
        promptKey: 'document-generation',
        body: typeof source.body === 'string' ? source.body : '',
        modelHint: typeof source.model_hint === 'string' ? source.model_hint : '',
      });
      return promptCard(runId, revision.promptRevisionId, `Saved REV-${String(revision.revisionNumber).padStart(5, '0')} as the active revision.`);
    } catch (error) {
      return promptCard(runId, Number(source.prompt_revision_id), message(error), 'error');
    }
  });
