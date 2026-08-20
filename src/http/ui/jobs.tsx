/**
 * Surface B — job fragments. Logs are their own lazy endpoint so the
 * polling ledger never grows a transcript.
 */
import { Elysia } from 'elysia';
import { parse } from '../../db/ids.ts';
import * as jobs from '../../domain/jobs/service.ts';
import { LogChunk, LogPoll } from '../../views/jobs/Log.tsx';

export const jobsUi = new Elysia({ name: 'jobs-ui' })
  .get('/ui/jobs/:code/log', async ({ params, query }) => {
    const parsed = parse(params.code);
    if (!parsed || parsed.entity !== 'jobs') return '';
    const after = Math.max(0, Number(query.after ?? 0) || 0);
    const job = await jobs.get(parsed.id);
    if (!job) return '';
    const lines = await jobs.linesAfter(parsed.id, after);
    if (lines.length) return <LogChunk job={job} lines={lines} />;
    // Nothing new — still replace the sentinel so `after` and liveness
    // stay current without duplicating lines already on the page.
    return jobs.isLive(job) ? <LogPoll jobCode={job.jobCode} after={after} /> : '';
  });
