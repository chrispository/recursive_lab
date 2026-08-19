import { Elysia } from 'elysia';
import * as failureMaps from '../../domain/failure_maps/service.ts';
import * as jobs from '../../domain/jobs/service.ts';
import * as progress from '../../domain/progress/service.ts';
import * as prompts from '../../domain/prompts/service.ts';
import { Badge } from '../../views/ui/Badge.tsx';
import { PromptCard } from '../../views/ui/PromptCard.tsx';
import { FailureAnalysisStatus } from '../../views/tabs/Failures.tsx';
import { benchmarkRunIdOf, errorMessage, recordBody } from '../request.ts';

function errorStatus(text: string) {
  return <div id="failure-analysis-status" class="m-analysis-status"><Badge state="failed">unable to start</Badge><span>{text}</span></div>;
}

async function failurePromptCard(runId: number, requestedRevisionId?: number, notice = '', noticeKind: 'success' | 'error' = 'success') {
  const current = Number.isInteger(runId) && runId > 0 ? await failureMaps.byBenchmarkRun(runId) : null;
  const revisions = await prompts.list('failure-analysis');
  const pinnedRevisionId = current?.prompt_revision_id ?? null;
  const selectedRevisionId = pinnedRevisionId ?? requestedRevisionId;
  let prompt = selectedRevisionId
    ? await prompts.byId('failure-analysis', selectedRevisionId)
    : await prompts.active('failure-analysis');
  if (!prompt && !pinnedRevisionId) prompt = await prompts.active('failure-analysis');
  return (
    <PromptCard
      prompt={prompt}
      revisions={revisions}
      benchmarkRunId={Number.isInteger(runId) && runId > 0 ? runId : null}
      promptRevisionLocked={false}
      notice={notice}
      noticeKind={noticeKind}
      promptKey="failure-analysis"
      title="Failure analysis prompt"
      dialogId="failure-analysis-prompt-editor"
      cardId="failure-prompt-card"
      targetInputId="failure-prompt-revision"
      promptUrl="/ui/failures/prompt"
      revisionsUrl="/ui/failures/prompt/revisions"
    />
  );
}

export const failuresUi = new Elysia({ name: 'failures-ui' })
  .post('/ui/failures/map', async ({ body }) => {
    const benchmarkRunId = benchmarkRunIdOf(body);
    const source = recordBody(body);
    const promptRevisionId = Number(source.prompt_revision_id);
    try {
      const started = await failureMaps.start({
        benchmarkRunId,
        promptRevisionId: Number.isInteger(promptRevisionId) && promptRevisionId > 0 ? promptRevisionId : undefined,
      });
      const job = await jobs.get(started.jobId);
      return <FailureAnalysisStatus runId={benchmarkRunId} job={job} progress={await progress.byBenchmarkRun(benchmarkRunId)} />;
    } catch (error) {
      return errorStatus(errorMessage(error));
    }
  })
  .get('/ui/failures/status', async ({ query }) => {
    const benchmarkRunId = Number(query.run);
    if (!Number.isInteger(benchmarkRunId) || benchmarkRunId < 1) return errorStatus('Select a benchmark run.');
    const rows = await jobs.listByBenchmarkRun(benchmarkRunId);
    const job = [...rows].reverse().find((item) => item.kind === 'failure_map') ?? null;
    return (
      <FailureAnalysisStatus
        runId={benchmarkRunId}
        job={job}
        progress={await progress.byBenchmarkRun(benchmarkRunId)}
        refreshWhenReady
      />
    );
  })
  .get('/ui/failures/prompt', async ({ query }) => {
    const runId = Number(query.run);
    const revisionId = Number(query.prompt_revision_id);
    return failurePromptCard(runId, Number.isInteger(revisionId) && revisionId > 0 ? revisionId : undefined);
  })
  .post('/ui/failures/prompt/revisions', async ({ body }) => {
    const source = recordBody(body);
    const runId = Number(source.benchmark_run_id);
    try {
      const revision = await prompts.saveAsNewRevision({
        promptKey: 'failure-analysis',
        body: typeof source.body === 'string' ? source.body : '',
        modelHint: typeof source.model_hint === 'string' ? source.model_hint : '',
      });
      return failurePromptCard(runId, revision.promptRevisionId, `Saved REV-${String(revision.revisionNumber).padStart(5, '0')} as the active revision.`);
    } catch (error) {
      return failurePromptCard(runId, Number(source.prompt_revision_id), errorMessage(error), 'error');
    }
  });

