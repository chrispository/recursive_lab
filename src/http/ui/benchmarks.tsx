/**
 * Surface B — Benchmarks tab fragments.
 *
 * The browser never posts to /api/v1. Import and run both go through domain
 * services; this file only gathers the form and renders the region.
 */
import { Elysia } from 'elysia';
import * as benchmarks from '../../domain/benchmarks/service.ts';
import * as jobs from '../../domain/jobs/service.ts';
import * as progress from '../../domain/progress/service.ts';
import * as runs from '../../domain/runs/service.ts';
import { Rail } from '../../views/layout/Rail.tsx';
import { ImportForm, ImportOob, RunnableStatus } from '../../views/tabs/benchmarks/ImportForm.tsx';
import { RunLedger } from '../../views/tabs/benchmarks/RunLedger.tsx';

const message = (error: unknown) => (error instanceof Error ? error.message : 'Unexpected error.');

function urlOf(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const url = (body as Record<string, unknown>).url;
  return typeof url === 'string' ? url.trim() : '';
}

function field(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === 'string' ? value.trim() : '';
}

function numbers(body: Record<string, unknown>, key: string): number | undefined {
  const value = field(body, key);
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function taskIdsOf(body: Record<string, unknown>): string[] {
  const raw = body.task_id;
  if (Array.isArray(raw)) return raw.map(String).map((id) => id.trim()).filter(Boolean);
  if (typeof raw === 'string' && raw.trim()) return [raw.trim()];
  return [];
}

function runRequestOf(body: unknown): runs.RunRequest {
  const source = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  return {
    benchmarkId: Number(field(source, 'benchmark_id')),
    model: field(source, 'model'),
    taskIds: taskIdsOf(source),
    settings: {
      repeats: numbers(source, 'repeats') ?? 1,
      concurrency: numbers(source, 'concurrency') ?? 1,
      temperature: numbers(source, 'temperature') ?? 1,
      topP: numbers(source, 'top-p') ?? 0.95,
      outputTokenStrategy: field(source, 'output-token-strategy') === 'fixed' ? 'fixed' : 'adaptive',
      maxOutputTokens: numbers(source, 'max-output-tokens') ?? 24576,
      maxTurns: numbers(source, 'max-turns') ?? 60,
      shellTimeout: numbers(source, 'shell-timeout') ?? 60,
      agentModelTimeout: numbers(source, 'agent-model-timeout') ?? 1800,
      judgeParallelism: numbers(source, 'judge-parallelism') ?? 6,
      judgeTimeout: numbers(source, 'judge-timeout') ?? 90,
      judgeMaxTokens: numbers(source, 'judge-max-tokens') ?? 4096,
      judgeRetries: numbers(source, 'judge-retries') ?? 1,
    },
  };
}

export const benchmarksUi = new Elysia({ name: 'benchmarks-ui' })
  .get('/ui/benchmarks/import', () => <ImportForm />)
  .post('/ui/benchmarks/import', async ({ body }) => {
    const url = urlOf(body);
    if (!url) {
      return <ImportForm error="Provide a GitHub or Hugging Face URL." />;
    }
    try {
      const tally = await benchmarks.importFromUrl(url);
      const catalogs = await benchmarks.list();
      return (
        <>
          <ImportForm url={url} tally={tally} />
          <ImportOob catalogs={catalogs} selectedId={tally.benchmarkId} />
        </>
      );
    } catch (error) {
      return <ImportForm url={url} error={message(error)} />;
    }
  })
  .post('/ui/benchmarks/run', async ({ body }) => {
    try {
      const request = runRequestOf(body);
      const started = await runs.start(request);
      const current = await progress.currentWithRail();
      const benchmarkRun = await runs.byBenchmarkRunId(started.benchmarkRunId);
      const catalogs = await benchmarks.list();
      const catalog = catalogs.find((item) => item.benchmarkId === request.benchmarkId) ?? catalogs[0] ?? null;
      return (
        <>
          Started {started.benchmarkRunCode}. Gym eval is running — Harbor trials can take minutes per task.
          <RunLedger benchmarkRun={benchmarkRun} jobs={await jobs.listByBenchmarkRun(started.benchmarkRunId)} oob />
          <RunnableStatus catalog={catalog} oob />
          <Rail tab="benchmarks" state={current.rail} oob />
        </>
      );
    } catch (error) {
      return message(error);
    }
  });
