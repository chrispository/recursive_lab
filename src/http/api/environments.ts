import { Elysia } from 'elysia';
import * as environments from '../../domain/environments/service.ts';
import * as jobRows from '../../domain/jobs/service.ts';
import type { JobRow } from '../../domain/jobs/model.ts';
import { benchmarkRunIdOf, errorMessage, recordBody } from '../request.ts';

function evalKindOf(value: unknown): 'rl_test' | 'validation' {
  if (value === 'rl_test' || value === 'validation') return value;
  throw new environments.EnvironmentError('kind must be rl_test or validation.');
}

function latestJob(rows: JobRow[], kind: string): JobRow | null {
  return [...rows].reverse().find((job) => job.kind === kind) ?? null;
}

async function snapshot(benchmarkRunId: number) {
  const [list, rlTest, validation, rows] = await Promise.all([
    environments.listByBenchmarkRun(benchmarkRunId),
    environments.latestEvaluationOfKind(benchmarkRunId, 'rl_test'),
    environments.latestEvaluationOfKind(benchmarkRunId, 'validation'),
    jobRows.listByBenchmarkRun(benchmarkRunId),
  ]);
  return {
    benchmarkRunId,
    environments: list,
    evaluations: { rlTest, validation },
    jobs: {
      build: latestJob(rows, 'env_build'),
      eval: latestJob(rows, 'env_eval'),
    },
  };
}

export const environmentsApi = new Elysia({ name: 'environments-api' })
  .get('/api/v1/environments', async ({ query, status }) => {
    const runId = Number(query.benchmark_run_id ?? query.run);
    if (!Number.isInteger(runId) || runId < 1) {
      return status(400, { error: 'Provide a valid benchmark_run_id.' });
    }
    try {
      return { ok: true, ...await snapshot(runId) };
    } catch (error) {
      return status(500, { error: errorMessage(error) });
    }
  })
  .get('/api/v1/environments/evaluations', async ({ query, status }) => {
    const runId = Number(query.benchmark_run_id ?? query.run);
    if (!Number.isInteger(runId) || runId < 1) {
      return status(400, { error: 'Provide a valid benchmark_run_id.' });
    }
    try {
      const [rlTest, validation] = await Promise.all([
        environments.latestEvaluationOfKind(runId, 'rl_test'),
        environments.latestEvaluationOfKind(runId, 'validation'),
      ]);
      return { ok: true, benchmarkRunId: runId, evaluations: { rlTest, validation } };
    } catch (error) {
      return status(500, { error: errorMessage(error) });
    }
  })
  .post('/api/v1/environments/build', async ({ body, status }) => {
    try {
      const runId = benchmarkRunIdOf(body);
      const result = await environments.build(runId);
      return status(202, { ok: true, ...result });
    } catch (error) {
      return status(error instanceof environments.EnvironmentError ? 400 : 500, { error: errorMessage(error) });
    }
  })
  .post('/api/v1/environments/eval', async ({ body, status }) => {
    try {
      const source = recordBody(body);
      const runId = benchmarkRunIdOf(body);
      const kind = evalKindOf(source.kind);
      const result = await environments.startEval({
        benchmarkRunId: runId,
        kind,
        model: typeof source.model === 'string' && source.model.trim() ? source.model.trim() : undefined,
        rolloutsPerExample: Number.isFinite(Number(source.rollouts_per_example)) ? Number(source.rollouts_per_example) : undefined,
        maxConcurrent: Number.isFinite(Number(source.max_concurrent)) ? Number(source.max_concurrent) : undefined,
      });
      return status(202, { ok: true, ...result });
    } catch (error) {
      return status(error instanceof environments.EnvironmentError ? 400 : 500, { error: errorMessage(error) });
    }
  })
  .post('/api/v1/environments/prepare-cluster', async ({ body, status }) => {
    try {
      const source = recordBody(body);
      const runId = benchmarkRunIdOf(body);
      const environmentCode = typeof source.environment_code === 'string' ? source.environment_code.trim() : undefined;
      const result = await environments.prepareCluster(runId, environmentCode);
      return { ok: true, ...result };
    } catch (error) {
      return status(error instanceof environments.EnvironmentError ? 400 : 500, { error: errorMessage(error) });
    }
  });
