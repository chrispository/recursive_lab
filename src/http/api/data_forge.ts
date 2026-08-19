import { Elysia } from 'elysia';
import * as dataForge from '../../domain/data_forge/service.ts';

const message = (error: unknown) => (error instanceof Error ? error.message : 'Unexpected error.');

function inputOf(value: unknown): Parameters<typeof dataForge.start>[0] {
  const body = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const rawRun = body.benchmark_run_id ?? body.run_id;
  const rawPrompt = body.prompt_revision_id;
  const backend = body.backend === 'frontier' ? 'frontier' : body.backend === 'data_designer' ? 'data_designer' : undefined;
  const rawDocs = body.docs_per_topic;
  const rawThreshold = body.novelty_threshold;
  return {
    benchmarkRunId: typeof rawRun === 'number' ? rawRun : Number(rawRun),
    promptRevisionId: typeof rawPrompt === 'number' ? rawPrompt : Number(rawPrompt),
    backend,
    providerModel: typeof body.provider_model === 'string' ? body.provider_model.trim() : undefined,
    docsPerTopic: typeof rawDocs === 'number' ? rawDocs : Number(rawDocs),
    noveltyThreshold: typeof rawThreshold === 'number' ? rawThreshold : Number(rawThreshold),
    autoApprove: body.auto_approve === true || body.auto_approve === 'on' || body.auto_approve === 'true',
  };
}

export const dataForgeApi = new Elysia({ name: 'data-forge-api' })
  .post('/api/v1/data-forge-runs', async ({ body, status }) => {
    try {
      return status(202, { ok: true, started: await dataForge.start(inputOf(body)) });
    } catch (error) {
      return status(error instanceof dataForge.DataForgeError ? 400 : 500, { error: message(error) });
    }
  })
  .post('/api/v1/documents/:code/review', async ({ params, body, status }) => {
    const source = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const reviewStatus: 'approved' | 'rejected' | null = source.status === 'approved' || source.status === 'rejected' ? source.status : null;
    if (!reviewStatus) return status(400, { error: 'Choose approve or reject.' });
    try {
      return { ok: true, document: await dataForge.review(params.code, reviewStatus) };
    } catch (error) {
      return status(error instanceof dataForge.DataForgeNotFoundError ? 404 : error instanceof dataForge.DataForgeError ? 400 : 500, { error: message(error) });
    }
  });
