import { Elysia, t } from 'elysia';
import * as benchmarks from '../../domain/benchmarks/service.ts';
import { errorMessage } from '../request.ts';

/**
 * Expected failures are the user's problem to fix — a bad URL, an unsupported
 * layout, a revision that does not exist — so they come back as 400 with the
 * reason. Anything else is ours and stays a 500.
 */
const status = (error: unknown) =>
  error instanceof benchmarks.SourceError ||
  error instanceof benchmarks.ArchiveError ||
  error instanceof benchmarks.ImportError ||
  error instanceof benchmarks.RepinError
    ? 400
    : 500;

export const benchmarksApi = new Elysia({ name: 'benchmarks-api' })
  .get('/api/v1/benchmarks', () => benchmarks.list())
  .get('/api/v1/benchmarks/:id/tasks', async ({ params, query }) =>
    benchmarks.tasks(Number(params.id), Number(query.limit ?? 50), Number(query.offset ?? 0)),
  )
  /**
   * Re-pin the gym's prepared copy of an imported Harbor benchmark to the
   * catalog's revision: rewrite the pin, clear the caches, restart if running.
   */
  .post('/api/v1/benchmarks/:id/gym-sync', async ({ params, status: reply }) => {
    try {
      return await benchmarks.syncGym(Number(params.id));
    } catch (error) {
      return reply(status(error), { error: errorMessage(error) });
    }
  })
  /**
   * Phase one: resolve, download and inspect. Writes nothing to the database,
   * so a wrong URL costs a download and nothing else.
   */
  .post('/api/v1/benchmark-imports/preview', async ({ body, status: reply }) => {
    const url = body.url?.trim() ?? '';
    if (!url) return reply(400, { error: 'Provide a benchmark source URL.' });
    try {
      return await benchmarks.preview(url, body.ref ?? '');
    } catch (error) {
      return reply(status(error), { error: errorMessage(error) });
    }
  }, {
    body: t.Object({ url: t.Optional(t.String()), ref: t.Optional(t.String()) }),
  })
  /**
   * Phase two: persist the previewed snapshot. Takes the preview back rather
   * than re-resolving, so what is committed is exactly what was shown.
   */
  .post('/api/v1/benchmark-imports', async ({ body, status: reply }) => {
    try {
      const tally = await benchmarks.commit(
        body.preview as benchmarks.ImportPreview,
        (body.plan ?? {}) as Partial<benchmarks.ImportPlan>,
        { replace: body.replace === true },
      );
      return reply(201, tally);
    } catch (error) {
      return reply(status(error), { error: errorMessage(error) });
    }
  }, {
    body: t.Object({
      preview: t.Record(t.String(), t.Unknown()),
      plan: t.Optional(t.Record(t.String(), t.Unknown())),
      replace: t.Optional(t.Boolean()),
    }),
  });
