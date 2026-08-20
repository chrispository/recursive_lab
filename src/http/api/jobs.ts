import { Elysia } from 'elysia';
import { parse } from '../../db/ids.ts';
import * as jobs from '../../domain/jobs/service.ts';

export const jobsApi = new Elysia({ name: 'jobs-api' })
  .get('/api/v1/jobs/:code/log', async ({ params, query, status }) => {
    const parsed = parse(params.code);
    if (!parsed || parsed.entity !== 'jobs') return status(400, { error: 'Provide a valid job code.' });
    const job = await jobs.get(parsed.id);
    if (!job) return status(404, { error: 'Job not found.' });
    const rawAfter = Number(query.after ?? 0);
    const rawLimit = Number(query.limit ?? 120);
    if (!Number.isFinite(rawAfter) || rawAfter < 0 || !Number.isFinite(rawLimit) || rawLimit < 1) {
      return status(400, { error: 'after must be ≥ 0 and limit must be positive.' });
    }
    const lines = await jobs.linesAfter(parsed.id, Math.floor(rawAfter), Math.min(500, Math.floor(rawLimit)));
    return {
      ok: true,
      job,
      lines,
      nextAfter: lines[lines.length - 1]?.seq ?? Math.floor(rawAfter),
    };
  })
  .get('/api/v1/jobs/:code', async ({ params, status }) => {
    const parsed = parse(params.code);
    if (!parsed || parsed.entity !== 'jobs') return status(400, { error: 'Provide a valid job code.' });
    const job = await jobs.get(parsed.id);
    return job ? { ok: true, job } : status(404, { error: 'Job not found.' });
  })
  .post('/api/v1/jobs/:code/cancel', async ({ params, status }) => {
    const parsed = parse(params.code);
    if (!parsed || parsed.entity !== 'jobs') return status(400, { error: 'Provide a valid job code.' });
    const job = await jobs.get(parsed.id);
    if (!job) return status(404, { error: 'Job not found.' });
    if (!jobs.isLive(job)) return status(409, { error: `Job is already ${job.status}.` });
    const cancelled = await jobs.cancel(parsed.id);
    return { ok: true, job: cancelled };
  });
