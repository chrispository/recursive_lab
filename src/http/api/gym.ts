/**
 * JSON surface for the gym: registry health plus the lifecycle and storage
 * controls. Deletion and lifecycle rules live in `gym/lifecycle.ts` and
 * `gym/storage.ts`; these handlers only translate errors to status codes.
 */
import { Elysia } from 'elysia';
import * as head from '../../gym/head.ts';
import * as gymLifecycle from '../../gym/lifecycle.ts';
import * as gymStorage from '../../gym/storage.ts';

const message = (error: unknown) => (error instanceof Error ? error.message : 'Unexpected error.');

export const gymApi = new Elysia({ name: 'gym-api' })
  .get('/api/v1/gym/health', () => head.health())
  .get('/api/v1/gym/servers/:processName', async ({ params, status }) => {
    const url = await head.serverUrl(params.processName);
    if (!url) return status(404, { error: `${params.processName} is not running.` });
    return { processName: params.processName, url };
  })
  .get('/api/v1/gym/lifecycle', async () => ({
    health: await head.health(),
    process: await gymLifecycle.status(),
  }))
  .post('/api/v1/gym/lifecycle/start', async ({ body, status }) => {
    const source = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const resourcesServer = typeof source.resourcesServer === 'string' ? source.resourcesServer.trim() : '';
    const modelType = typeof source.modelType === 'string' ? source.modelType.trim() : '';
    try {
      return await gymLifecycle.start({ resourcesServer, modelType: modelType || undefined });
    } catch (error) {
      return status(409, { error: message(error) });
    }
  })
  .post('/api/v1/gym/lifecycle/stop', async ({ status }) => {
    try {
      return await gymLifecycle.stop();
    } catch (error) {
      return status(500, { error: message(error) });
    }
  })
  .get('/api/v1/gym/storage', async () => ({ buckets: await gymStorage.usage() }))
  .post('/api/v1/gym/storage/clear', async ({ body, status }) => {
    const source = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const bucket = typeof source.bucket === 'string' ? source.bucket.trim() : '';
    const target = typeof source.target === 'string' && source.target.trim() ? source.target.trim() : undefined;
    try {
      return await gymStorage.clear(bucket, target);
    } catch (error) {
      return status(400, { error: message(error) });
    }
  });
