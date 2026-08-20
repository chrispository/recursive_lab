/**
 * Surface A — pages. One route per tab, each returning a full HTML document
 * (or the bare workspace region under HTMX; see respond.tsx).
 *
 * These handlers only gather data and pick a view. Business rules belong in
 * domain/*\/service.ts.
 */
import { Elysia } from 'elysia';
import { page } from './respond.tsx';
import { isTab, TABS } from '../views/layout/tabs.ts';
import * as progress from '../domain/progress/service.ts';
import * as topics from '../domain/topics/service.ts';
import * as runs from '../domain/runs/service.ts';
import * as failureMaps from '../domain/failure_maps/service.ts';
import * as dataForge from '../domain/data_forge/service.ts';

import * as prompts from '../domain/prompts/service.ts';
import * as environments from '../domain/environments/service.ts';
import * as benchmarks from '../domain/benchmarks/service.ts';
import * as jobs from '../domain/jobs/service.ts';
import * as settings from '../gym/settings.ts';
import { panelData } from './ui/settings.tsx';
import { GymPanel } from '../views/tabs/settings/GymPanel.tsx';
import { Benchmarks } from '../views/tabs/Benchmarks.tsx';
import { EnvLab } from '../views/tabs/EnvLab.tsx';
import { Failures } from '../views/tabs/Failures.tsx';
import { DataForge } from '../views/tabs/DataForge.tsx';
import { DataForgeReview } from '../views/tabs/DataForgeReview.tsx';
import { Results } from '../views/tabs/Results.tsx';
import { ClusterHandoffPage } from '../views/tabs/ClusterHandoff.tsx';
import { Settings } from '../views/tabs/Settings.tsx';

export const pages = new Elysia({ name: 'pages' })
  .get('/', ({ redirect }) => redirect('/benchmarks', 302))
  .get('/:tab', async ({ params, request, status }) => {
    if (!isTab(params.tab)) return status(404, 'Not found');

    const currentProgress = await progress.current();
    const requestedRunId = Number(new URL(request.url).searchParams.get('run'));
    const requestedProgress = Number.isInteger(requestedRunId) && requestedRunId > 0
      ? await progress.byBenchmarkRun(requestedRunId)
      : null;
    const selectedProgress = requestedProgress ?? currentProgress;
    const rail = progress.railState(selectedProgress);
    const benchmarkRun = selectedProgress ? await runs.byBenchmarkRunId(selectedProgress.benchmarkRunId) : null;
    const benchmarkRunJobs = selectedProgress ? await jobs.listByBenchmarkRun(selectedProgress.benchmarkRunId) : [];
    let body: JSX.Element;

    switch (params.tab) {
      case 'benchmarks': {
        // Headers for the dropdown, then tasks for the selected one only.
        const catalogs = await benchmarks.list();
        const preferred = catalogs.find((item) => item.benchmarkCode === benchmarkRun?.benchmarkCode);
        body = (
          <Benchmarks
            benchmarkRun={benchmarkRun}
            progress={selectedProgress}
            runs={await runs.list()}
            jobs={benchmarkRunJobs}
            catalogs={catalogs}
            catalog={await benchmarks.withTasks(benchmarks.select(catalogs, preferred?.benchmarkId)?.benchmarkId)}
            settings={await settings.read()}
          />
        );
        break;
      }
      case 'results':
        {
          const availableRuns = await runs.list();
          const resultRun = benchmarkRun ?? availableRuns[0] ?? null;
          const resultTasks = resultRun ? await runs.criteriaByTask(resultRun.benchmarkRunId) : [];
          body = (
            <Results
              benchmarkRun={resultRun}
              progress={selectedProgress}
              tasks={resultTasks}
              availableRuns={availableRuns}
            />
          );
        }
        break;
      case 'failures': {
        const availableRuns = await runs.list();
        const failureRun = benchmarkRun ?? availableRuns[0] ?? null;
        const failureProgress = failureRun
          ? await progress.byBenchmarkRun(failureRun.benchmarkRunId)
          : null;
        const failureMapId = failureProgress?.failureMapId;
        const failureJobs = failureRun ? await jobs.listByBenchmarkRun(failureRun.benchmarkRunId) : [];
        const analysisJob = [...failureJobs].reverse().find((job) => job.kind === 'failure_map') ?? null;
        const analysisSettings = await settings.read();
        const requestedPromptRevisionId = Number(new URL(request.url).searchParams.get('prompt_revision_id'));
        const promptRevisions = await prompts.list('failure-analysis');
        const existingMap = failureRun ? await failureMaps.byBenchmarkRun(failureRun.benchmarkRunId) : null;
        const selectedPromptRevisionId = existingMap?.prompt_revision_id
          ?? (Number.isInteger(requestedPromptRevisionId) && requestedPromptRevisionId > 0 ? requestedPromptRevisionId : undefined);
        const prompt = selectedPromptRevisionId
          ? await prompts.byId('failure-analysis', selectedPromptRevisionId)
          : await prompts.active('failure-analysis');
        body = (
          <Failures
            progress={failureProgress}
            benchmarkRun={failureRun}
            availableRuns={availableRuns}
            analysisJob={analysisJob}
            tasks={failureRun ? await runs.criteriaByTask(failureRun.benchmarkRunId) : []}
            topics={failureMapId ? await topics.listByFailureMap(failureMapId) : []}
            uncategorised={failureMapId ? await topics.countUncategorised(failureMapId) : 0}
            prompt={prompt}
            promptRevisions={promptRevisions}
            analystModel={analysisSettings.analysis_model_name || analysisSettings.judge_model_name}
            hasApiKey={analysisSettings.has_analysis_key || analysisSettings.has_judge_key}
          />
        );
        break;
      }

      case 'forge': {
        const availableRuns = await runs.list();
        const dataForgeRun = selectedProgress ? await dataForge.byBenchmarkRun(selectedProgress.benchmarkRunId) : null;
        const forgeTopics = selectedProgress?.failureMapId
          ? await topics.listByFailureMap(selectedProgress.failureMapId)
          : [];
        const forgeJobs = selectedProgress ? await jobs.listByBenchmarkRun(selectedProgress.benchmarkRunId) : [];
        const forgeJob = [...forgeJobs].reverse().find((job) => job.kind === 'data_forge_run') ?? null;
        const generationSettings = await settings.read();
        const requestedPromptRevisionId = Number(new URL(request.url).searchParams.get('prompt_revision_id'));
        const promptRevisions = await prompts.list('document-generation');
        const selectedPromptRevisionId = dataForgeRun?.promptRevisionId
          ?? (Number.isInteger(requestedPromptRevisionId) && requestedPromptRevisionId > 0 ? requestedPromptRevisionId : undefined);
        const prompt = selectedPromptRevisionId
          ? await prompts.byId('document-generation', selectedPromptRevisionId)
          : await prompts.active('document-generation');
        body = (
          <DataForge
            benchmarkRun={benchmarkRun}
            progress={selectedProgress}
            availableRuns={availableRuns}
            dataForge={dataForgeRun}
            documents={dataForgeRun ? await dataForge.documents(dataForgeRun.dataForgeCode) : []}
            topics={forgeTopics}
            forgeJob={forgeJob}
            generationBackend={generationSettings.generation_backend}
            generationModel={generationSettings.generation_model_name}
            generationConfigured={generationSettings.has_generation_key && Boolean(generationSettings.generation_model_name)}
            prompt={prompt}
            promptRevisions={promptRevisions}
          />
        );
        break;
      }
      case 'forge-review': {
        const availableRuns = await runs.list();
        const reviewDataForge = selectedProgress ? await dataForge.byBenchmarkRun(selectedProgress.benchmarkRunId) : null;
        body = (
          <DataForgeReview
            benchmarkRun={benchmarkRun}
            progress={selectedProgress}
            availableRuns={availableRuns}
            dataForge={reviewDataForge}
            documents={reviewDataForge ? await dataForge.documents(reviewDataForge.dataForgeCode) : []}
          />
        );
        break;
      }
      case 'env-lab': {
        const availableRuns = await runs.list();
        const envJobs = selectedProgress ? await jobs.listByBenchmarkRun(selectedProgress.benchmarkRunId) : [];
        const envBuildJob = [...envJobs].reverse().find((job) => job.kind === 'env_build') ?? null;
        const envEvalJob = [...envJobs].reverse().find((job) => job.kind === 'env_eval') ?? null;
        const envLogJob = jobs.isLive(envEvalJob) ? envEvalJob : jobs.isLive(envBuildJob) ? envBuildJob : envEvalJob ?? envBuildJob;
        const savedSettings = await settings.read();
        body = (
          <EnvLab
            benchmarkRun={benchmarkRun}
            progress={selectedProgress}
            availableRuns={availableRuns}
            environments={selectedProgress ? await environments.listByBenchmarkRun(selectedProgress.benchmarkRunId) : []}
            rlTest={selectedProgress ? await environments.latestEvaluationOfKind(selectedProgress.benchmarkRunId, 'rl_test') : null}
            validation={selectedProgress ? await environments.latestEvaluationOfKind(selectedProgress.benchmarkRunId, 'validation') : null}
            buildJob={envBuildJob}
            evalJob={envEvalJob}
            jobLog={{ job: envLogJob, lines: envLogJob ? await jobs.linesAfter(envLogJob.jobId, 0) : [] }}
            settings={{
              policyModel: savedSettings.policy_model_name,
              policyConfigured: savedSettings.has_policy_key && Boolean(savedSettings.policy_model_name),
              judgeModel: savedSettings.judge_model_name,
              judgeConfigured: savedSettings.has_judge_key && Boolean(savedSettings.judge_model_name),
              primeInstalled: savedSettings.status.prime_cli === 'ready',
            }}
          />
        );
        break;
      }
      case 'cluster': {
        const availableRuns = await runs.list();
        body = (
          <ClusterHandoffPage
            benchmarkRun={benchmarkRun}
            progress={selectedProgress}
            availableRuns={availableRuns}
            environments={selectedProgress ? await environments.listByBenchmarkRun(selectedProgress.benchmarkRunId) : []}
            validation={selectedProgress ? await environments.latestEvaluationOfKind(selectedProgress.benchmarkRunId, 'validation') : null}
          />
        );
        break;
      }
      case 'settings': {
        const gym = await panelData();
        const saved = await settings.read();
        body = (
          <Settings settings={saved}>
            <GymPanel {...gym} />
          </Settings>
        );
        break;
      }
    }

    return page(request, params.tab, rail, body);
  });

export { TABS };
