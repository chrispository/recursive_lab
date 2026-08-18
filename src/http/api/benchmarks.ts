import { Elysia } from 'elysia';
import * as benchmarks from '../../domain/benchmarks/service.ts';

const message = (error: unknown) => (error instanceof Error ? error.message : 'Unexpected error.');

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

type PreviewBody = { url?: unknown; ref?: unknown };
type CommitBody = { preview?: unknown; plan?: unknown; replace?: unknown };

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
      return reply(status(error), { error: message(error) });
    }
  })
  /**
   * Phase one: resolve, download and inspect. Writes nothing to the database,
   * so a wrong URL costs a download and nothing else.
   */
  .post('/api/v1/benchmark-imports/preview', async ({ body, status: reply }) => {
    const { url, ref } = (body ?? {}) as PreviewBody;
    if (typeof url !== 'string' || !url.trim()) {
      return reply(400, { error: 'Provide a benchmark source URL.' });
    }
    try {
      return await benchmarks.preview(url, typeof ref === 'string' ? ref : '');
    } catch (error) {
      return reply(status(error), { error: message(error) });
    }
  })
  /**
   * Phase two: persist the previewed snapshot. Takes the preview back rather
   * than re-resolving, so what is committed is exactly what was shown.
   */
  .post('/api/v1/benchmark-imports', async ({ body, status: reply }) => {
    const { preview, plan, replace } = (body ?? {}) as CommitBody;
    if (!preview || typeof preview !== 'object') {
      return reply(400, { error: 'Send the preview returned by /preview.' });
    }
    try {
      const tally = await benchmarks.commit(
        preview as benchmarks.ImportPreview,
        (plan ?? {}) as Partial<benchmarks.ImportPlan>,
        { replace: replace === true },
      );
      return reply(201, tally);
    } catch (error) {
      return reply(status(error), { error: message(error) });
    }
  });
