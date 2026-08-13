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
    const run = current.progress ? await runs.byId(current.progress.runId) : null;
    const runJobs = current.progress ? await jobs.listByRun(current.progress.runId) : [];
    let body: JSX.Element;

    switch (params.tab) {
      case 'benchmarks':
        body = <Benchmarks run={run} jobs={runJobs} />;
        break;
      case 'results':
        body = <Results run={run} jobs={runJobs} />;
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
        const dataForgeRun = current.progress ? await dataForge.byRun(current.progress.runId) : null;
        body = <DataForge dataForge={dataForgeRun} documents={dataForgeRun ? await dataForge.documents(dataForgeRun.dataForgeCode) : []} />;
        break;
      }
      case 'env-lab':
        body = (
          <EnvLab
            environments={current.progress ? await environments.listByRun(current.progress.runId) : []}
            evaluation={current.progress ? await environments.latestEvaluation(current.progress.runId) : null}
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
