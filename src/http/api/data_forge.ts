import { Elysia } from 'elysia';
import * as dataForge from '../../domain/data_forge/service.ts';
import { dataForgeInput, errorMessage, recordBody } from '../request.ts';

export const dataForgeApi = new Elysia({ name: 'data-forge-api' })
  .post('/api/v1/data-forge-runs', async ({ body, status }) => {
    try {
      return status(202, { ok: true, started: await dataForge.start(dataForgeInput(body)) });
    } catch (error) {
      return status(error instanceof dataForge.DataForgeError ? 400 : 500, { error: errorMessage(error) });
    }
  })
  .post('/api/v1/documents/:code/review', async ({ params, body, status }) => {
    const source = recordBody(body);
    const reviewStatus: 'approved' | 'rejected' | null = source.status === 'approved' || source.status === 'rejected' ? source.status : null;
    if (!reviewStatus) return status(400, { error: 'Choose approve or reject.' });
    try {
      return { ok: true, document: await dataForge.review(params.code, reviewStatus) };
    } catch (error) {
      return status(error instanceof dataForge.DataForgeNotFoundError ? 404 : error instanceof dataForge.DataForgeError ? 400 : 500, { error: errorMessage(error) });
    }
  });
