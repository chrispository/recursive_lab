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
import * as lineage from '../domain/lineage/service.ts';
import * as topics from '../domain/topics/service.ts';
import * as runs from '../domain/runs/service.ts';
import * as forge from '../domain/forge/service.ts';
import * as environments from '../domain/environments/service.ts';
import * as jobs from '../domain/jobs/service.ts';
import * as settings from '../gym/settings.ts';
import { Benchmarks } from '../views/tabs/Benchmarks.tsx';
import { EnvLab } from '../views/tabs/EnvLab.tsx';
import { Failures } from '../views/tabs/Failures.tsx';
import { Forge } from '../views/tabs/Forge.tsx';
import { Results } from '../views/tabs/Results.tsx';
import { Settings } from '../views/tabs/Settings.tsx';

export const pages = new Elysia({ name: 'pages' })
  .get('/', ({ redirect }) => redirect('/benchmarks', 302))
  .get('/:tab', async ({ params, request, status }) => {
    if (!isTab(params.tab)) return status(404, 'Not found');

    const current = await lineage.currentWithRail();
    const run = current.lineage ? await runs.byId(current.lineage.runId) : null;
    const runJobs = current.lineage ? await jobs.listByRun(current.lineage.runId) : [];
    let body: JSX.Element;

    switch (params.tab) {
      case 'benchmarks':
        body = <Benchmarks run={run} jobs={runJobs} />;
        break;
      case 'results':
        body = <Results run={run} jobs={runJobs} />;
        break;
      case 'failures': {
        const taxonomyId = current.lineage?.taxonomyId;
        body = (
          <Failures
            lineage={current.lineage}
            topics={taxonomyId ? await topics.listByTaxonomy(taxonomyId) : []}
            uncategorised={taxonomyId ? await topics.countUncategorised(taxonomyId) : 0}
          />
        );
        break;
      }
      case 'forge': {
        const forgeRun = current.lineage ? await forge.byRun(current.lineage.runId) : null;
        body = <Forge forge={forgeRun} documents={forgeRun ? await forge.documents(forgeRun.forgeCode) : []} />;
        break;
      }
      case 'env-lab':
        body = (
          <EnvLab
            environments={current.lineage ? await environments.listByRun(current.lineage.runId) : []}
            evaluation={current.lineage ? await environments.latestEvaluation(current.lineage.runId) : null}
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
