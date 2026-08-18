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
import {
  CatalogNote,
  CatalogSelect,
  CatalogStatus,
  ImportForm,
  ImportOob,
  RunnableStatus,
  TaskCount,
  TaskPicker,
} from '../../views/tabs/benchmarks/ImportForm.tsx';
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
      judgeMaxTokens: numbers(source, 'judge-max-tokens') ?? 8192,
      judgeRetries: numbers(source, 'judge-retries') ?? 1,
    },
  };
}

/** The ledger reports every run — newest first — and follows the live one. */
async function ledger() {
  const benchmarkRun = await runs.current();
  const live = benchmarkRun ? await runs.syncProgress(benchmarkRun) : null;
  const rows = benchmarkRun ? await jobs.listByBenchmarkRun(benchmarkRun.benchmarkRunId) : [];
  return <RunLedger benchmarkRun={benchmarkRun} runs={await runs.list()} jobs={rows} live={live} />;
}

export const benchmarksUi = new Elysia({ name: 'benchmarks-ui' })
  .get('/ui/benchmarks/import', () => <ImportForm />)
  .get('/ui/benchmarks/tasks', async ({ query }) => {
    const id = Number(query.benchmark_id);
    const catalogs = await benchmarks.list();
    const catalog = await benchmarks.withTasks(Number.isInteger(id) && id > 0 ? id : catalogs[0]?.benchmarkId);
    return (
      <>
        <TaskPicker catalog={catalog} />
        <CatalogSelect catalogs={catalogs} selectedId={catalog?.benchmarkId ?? null} oob />
        <CatalogNote catalog={catalog} oob />
        <TaskCount catalog={catalog} oob />
        <CatalogStatus catalog={catalog} oob />
        <RunnableStatus catalog={catalog} oob />
      </>
    );
  })
  /**
   * Polled by the region itself while its job is running, at the interval set
   * in RunLedger. The response carries the poll attributes only while the run
   * is still live, so a finished run stops the polling by rendering without
   * them — there is no timer anywhere to cancel. Gym stdout lives on
   * `/ui/jobs/:code/log`, not here.
   */
  .get('/ui/benchmarks/ledger', () => ledger())
  .post('/ui/benchmarks/import', async ({ body }) => {
    const url = urlOf(body);
    if (!url) {
      return <ImportForm error="Provide a GitHub or Hugging Face URL." />;
    }
    try {
      const tally = await benchmarks.importFromUrl(url);
      const catalogs = await benchmarks.list();
      // The benchmark just imported becomes the selection, so it is the one
      // whose tasks get loaded — the rest stay headers in the dropdown.
      const catalog = await benchmarks.withTasks(benchmarks.select(catalogs, tally.benchmarkId)?.benchmarkId);
      return (
        <>
          <ImportForm url={url} tally={tally} />
          <ImportOob catalogs={catalogs} catalog={catalog} />
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
      // Only the runnable badge is swapped here, so headers are enough.
      const catalog = benchmarks.select(await benchmarks.list(), request.benchmarkId);
      const runJobs = await jobs.listByBenchmarkRun(started.benchmarkRunId);
      return (
        <>
          <span data-run-started>Started {started.benchmarkRunCode}. Gym eval is running — Harbor trials can take minutes per task.</span>
          <RunLedger benchmarkRun={benchmarkRun} runs={await runs.list()} jobs={runJobs} oob />
          <RunnableStatus catalog={catalog} oob />
          <Rail tab="benchmarks" state={current.rail} oob />
        </>
      );
    } catch (error) {
      return message(error);
    }
  });
