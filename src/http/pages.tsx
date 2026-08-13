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
import * as dataForge from '../domain/data_forge/service.ts';
import * as environments from '../domain/environments/service.ts';
import * as benchmarks from '../domain/benchmarks/service.ts';
import * as jobs from '../domain/jobs/service.ts';
import * as settings from '../gym/settings.ts';
import { Benchmarks } from '../views/tabs/Benchmarks.tsx';
import { EnvLab } from '../views/tabs/EnvLab.tsx';
import { Failures } from '../views/tabs/Failures.tsx';
import { DataForge } from '../views/tabs/DataForge.tsx';
import { Results } from '../views/tabs/Results.tsx';
import { Settings } from '../views/tabs/Settings.tsx';

export const pages = new Elysia({ name: 'pages' })
  .get('/', ({ redirect }) => redirect('/benchmarks', 302))
  .get('/:tab', async ({ params, request, status }) => {
    if (!isTab(params.tab)) return status(404, 'Not found');

    const current = await progress.currentWithRail();
    const benchmarkRun = current.progress ? await runs.byBenchmarkRunId(current.progress.benchmarkRunId) : null;
    const benchmarkRunJobs = current.progress ? await jobs.listByBenchmarkRun(current.progress.benchmarkRunId) : [];
    let body: JSX.Element;

    switch (params.tab) {
      case 'benchmarks':
        body = (
          <Benchmarks
            benchmarkRun={benchmarkRun}
            jobs={benchmarkRunJobs}
            catalogs={await benchmarks.list()}
            settings={await settings.read()}
          />
        );
        break;
      case 'results':
        {
          const availableRuns = await runs.list();
          const requestedRunId = Number(new URL(request.url).searchParams.get('run'));
          const selectedRun = Number.isInteger(requestedRunId) && requestedRunId > 0
            ? availableRuns.find((run) => run.benchmarkRunId === requestedRunId) ?? null
            : null;
          const resultRun = selectedRun ?? benchmarkRun ?? availableRuns[0] ?? null;
          const resultJobs = resultRun ? await jobs.listByBenchmarkRun(resultRun.benchmarkRunId) : [];
          const resultCriteria = resultRun ? await runs.criteriaByBenchmarkRun(resultRun.benchmarkRunId) : [];
          body = (
            <Results
              benchmarkRun={resultRun}
              jobs={resultJobs}
              criteria={resultCriteria}
              availableRuns={availableRuns}
            />
          );
        }
        break;
      case 'failures': {
        const failureMapId = current.progress?.failureMapId;
        body = (
          <Failures
            progress={current.progress}
            topics={failureMapId ? await topics.listByFailureMap(failureMapId) : []}
            uncategorised={failureMapId ? await topics.countUncategorised(failureMapId) : 0}
          />
        );
        break;
      }
      case 'forge': {
        const dataForgeRun = current.progress ? await dataForge.byBenchmarkRun(current.progress.benchmarkRunId) : null;
        body = <DataForge dataForge={dataForgeRun} documents={dataForgeRun ? await dataForge.documents(dataForgeRun.dataForgeCode) : []} />;
        break;
      }
      case 'env-lab':
        body = (
          <EnvLab
            environments={current.progress ? await environments.listByBenchmarkRun(current.progress.benchmarkRunId) : []}
            evaluation={current.progress ? await environments.latestEvaluation(current.progress.benchmarkRunId) : null}
          />
        );
        break;
      case 'settings':
        body = <Settings settings={await settings.read()} />;
        break;
    }

    return page(request, params.tab, current.rail, body);
  });

export { TABS };
