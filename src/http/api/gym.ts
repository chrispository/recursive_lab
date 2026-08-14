import { Elysia } from 'elysia';
import * as head from '../../gym/head.ts';

/**
 * Read-only view of the NeMo Gym head server registry.
 *
 * `health()` never throws, so there is no error branch here: an unreachable
 * head server comes back as `reachable: false` with the reason attached.
 */
export const gymApi = new Elysia({ name: 'gym-api' })
  .get('/api/v1/gym/health', () => head.health())
  .get('/api/v1/gym/servers/:processName', async ({ params, status }) => {
    const url = await head.serverUrl(params.processName);
    if (!url) return status(404, { error: `${params.processName} is not running.` });
    return { processName: params.processName, url };
  });
