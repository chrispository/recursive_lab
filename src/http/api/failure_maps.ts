import { Elysia } from 'elysia';
import * as failureMaps from '../../domain/failure_maps/service.ts';

const message = (error: unknown) => (error instanceof Error ? error.message : 'Unexpected error.');

function bodyOf(value: unknown): { benchmarkRunId: number; providerModel: string } {
  const body = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const rawRun = body.benchmark_run_id ?? body.run_id;
  return {
    benchmarkRunId: typeof rawRun === 'number' ? rawRun : Number(rawRun),
    providerModel: typeof body.provider_model === 'string' ? body.provider_model.trim() : '',
  };
}

export const failureMapsApi = new Elysia({ name: 'failure-maps-api' })
  .post('/api/v1/failure-maps', async ({ body, status: reply }) => {
    try {
      const started = await failureMaps.start(bodyOf(body));
      return reply(202, { ok: true, started });
    } catch (error) {
      return reply(error instanceof failureMaps.FailureMapError ? 400 : 500, { error: message(error) });
    }
  });
