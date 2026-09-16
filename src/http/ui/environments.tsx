/**
 * Env lab fragments — build packages and run local proof. Cluster preparation
 * owns a separate page/region so the Env Lab remains focused on evidence.
 */
import { Elysia } from 'elysia';
import * as environments from '../../domain/environments/service.ts';
import * as jobRows from '../../domain/jobs/service.ts';
import * as progress from '../../domain/progress/service.ts';
import * as runs from '../../domain/runs/service.ts';
import * as settings from '../../gym/settings.ts';
import { piInstalled } from '../../gym/pi.ts';
import { Badge } from '../../views/ui/Badge.tsx';
import { EnvLabBody, EnvLabStatus, type EnvLabSettings } from '../../views/tabs/EnvLab.tsx';
import { ClusterHandoffBody } from '../../views/tabs/ClusterHandoff.tsx';
import { EnvironmentInbox } from '../../views/tabs/env-lab/EnvironmentInbox.tsx';
import { Handoff } from '../../views/layout/Handoff.tsx';
import { JobLog } from '../../views/jobs/Log.tsx';
import { benchmarkRunIdOf, errorMessage, recordBody } from '../request.ts';

function errorStatus(text: string, oob = false) {
  return <div id="env-lab-status" class="m-analysis-status" hx-swap-oob={oob ? 'true' : undefined}><Badge state="failed">unable to start</Badge><span>{text}</span></div>;
}

async function latestJobs(runId: number) {
  const rows = await jobRows.listByBenchmarkRun(runId);
  return {
    buildJob: [...rows].reverse().find((job) => job.kind === 'env_build') ?? null,
    evalJob: [...rows].reverse().find((job) => job.kind === 'env_eval') ?? null,
  };
}

function displayJob(buildJob: Awaited<ReturnType<typeof latestJobs>>['buildJob'], evalJob: Awaited<ReturnType<typeof latestJobs>>['evalJob']) {
  return jobRows.isLive(evalJob) ? evalJob : jobRows.isLive(buildJob) ? buildJob : evalJob ?? buildJob;
}

async function statusResponse(runId: number, refreshWhenReady = false, includeLog = true) {
  const latest = await latestJobs(runId);
  const job = displayJob(latest.buildJob, latest.evalJob);
  const [rlTest, validation] = await Promise.all([
    environments.latestEvaluationOfKind(runId, 'rl_test'),
    environments.latestEvaluationOfKind(runId, 'validation'),
  ]);
  return (
    <>
      <EnvLabStatus runId={runId} refreshWhenReady={refreshWhenReady} rlTest={rlTest} validation={validation} {...latest} />
      {includeLog ? <JobLog job={job} lines={job ? await jobRows.linesAfter(job.jobId, 0) : []} oob /> : null}
      {job && job.kind === 'env_eval' && jobRows.isLive(job) ? (
        <EnvironmentInbox
          environments={await environments.listByBenchmarkRun(runId)}
          buildJob={latest.buildJob}
          evalJob={latest.evalJob}
          oob
        />
      ) : null}
    </>
  );
}

async function labSettings(): Promise<EnvLabSettings> {
  const saved = await settings.read();
  return {
    policyModel: saved.policy_model_name,
    policyConfigured: saved.has_policy_key && Boolean(saved.policy_model_name),
    judgeModel: saved.judge_model_name,
    judgeConfigured: saved.has_judge_key && Boolean(saved.judge_model_name),
    primeInstalled: piInstalled(),
  };
}

async function body(runId: number, oob = false) {
  const selectedProgress = await progress.byBenchmarkRun(runId);
  const latest = await latestJobs(runId);
  const job = displayJob(latest.buildJob, latest.evalJob);
  return (
    <>
    <EnvLabBody
      benchmarkRun={selectedProgress ? await runs.byBenchmarkRunId(runId) : null}
      progress={selectedProgress}
      environments={selectedProgress ? await environments.listByBenchmarkRun(runId) : []}
      rlTest={selectedProgress ? await environments.latestEvaluationOfKind(runId, 'rl_test') : null}
      validation={selectedProgress ? await environments.latestEvaluationOfKind(runId, 'validation') : null}
      {...latest}
      jobLog={{ job, lines: job ? await jobRows.linesAfter(job.jobId, 0) : [] }}
      settings={await labSettings()}
      oob={oob}
    />
    <Handoff stage="env-lab" benchmarkRun={selectedProgress ? await runs.byBenchmarkRunId(runId) : null} progress={selectedProgress} oob />
    </>
  );
}

async function clusterBody(runId: number, notice?: string) {
  const selectedProgress = await progress.byBenchmarkRun(runId);
  return (
    <>
    <ClusterHandoffBody
      benchmarkRun={selectedProgress ? await runs.byBenchmarkRunId(runId) : null}
      environments={selectedProgress ? await environments.listByBenchmarkRun(runId) : []}
      validation={selectedProgress ? await environments.latestEvaluationOfKind(runId, 'validation') : null}
      notice={notice}
    />
    <Handoff stage="cluster" benchmarkRun={selectedProgress ? await runs.byBenchmarkRunId(runId) : null} progress={selectedProgress} oob />
    </>
  );
}

export const environmentsUi = new Elysia({ name: 'environments-ui' })
  .post('/ui/env-lab/build', async ({ body: payload }) => {
    const runId = benchmarkRunIdOf(payload);
    try {
      await environments.build(runId);
      return await body(runId);
    } catch (error) {
      return <>{await body(runId)}{errorStatus(errorMessage(error), true)}</>;
    }
  })
  .post('/ui/env-lab/start', async ({ body: payload }) => {
    const source = recordBody(payload);
    const runId = benchmarkRunIdOf(payload);
    const kind = source.kind === 'validation' ? 'validation' : 'rl_test';
    try {
      await environments.startEval({
        benchmarkRunId: runId,
        kind,
        model: typeof source.model === 'string' && source.model.trim() ? source.model.trim() : undefined,
        rolloutsPerExample: Number.isFinite(Number(source.rollouts_per_example)) ? Number(source.rollouts_per_example) : undefined,
        maxConcurrent: Number.isFinite(Number(source.max_concurrent)) ? Number(source.max_concurrent) : undefined,
      });
      return await body(runId, true);
    } catch (error) {
      return errorStatus(errorMessage(error), true);
    }
  })
  .get('/ui/env-lab/body', async ({ query }) => body(Number(query.run)))
  .get('/ui/env-lab/status', async ({ query }) => {
    const runId = Number(query.run);
    if (!Number.isInteger(runId) || runId < 1) return errorStatus('Select a benchmark run.');
    return await statusResponse(runId, true, false);
  })
  .post('/ui/env-lab/cancel', async ({ body: payload }) => {
    const runId = benchmarkRunIdOf(payload);
    try {
      const latest = await latestJobs(runId);
      const job = displayJob(latest.buildJob, latest.evalJob);
      if (!job || !jobRows.isLive(job)) throw new Error('No local environment job is running.');
      await jobRows.cancel(job.jobId);
      return await body(runId, true);
    } catch (error) {
      return errorStatus(errorMessage(error), true);
    }
  })
  .post('/ui/env-lab/prepare', async ({ body: payload }) => {
    const source = recordBody(payload);
    const runId = benchmarkRunIdOf(payload);
    const environmentCode = typeof source.environment_code === 'string' ? source.environment_code.trim() : '';
    try {
      await environments.prepareCluster(runId, environmentCode || undefined,
        typeof source.training_model === 'string' ? source.training_model : '', source.checkpoint_confirmed === 'on');
      return await clusterBody(runId);
    } catch (error) {
      return await clusterBody(runId, errorMessage(error));
    }
  });
