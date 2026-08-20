/**
 * Surface B — Settings tab fragments for the gym environment and storage.
 *
 * One region (`#settings-gym`), returned by GET and by every POST below, so
 * each action redraws exactly what changed and nothing else.
 */
import { Elysia } from 'elysia';
import * as benchmarks from '../../domain/benchmarks/service.ts';
import * as head from '../../gym/head.ts';
import * as gymLifecycle from '../../gym/lifecycle.ts';
import * as storage from '../../gym/storage.ts';
import { GymPanel } from '../../views/tabs/settings/GymPanel.tsx';
import { errorMessage, recordBody } from '../request.ts';

export type GymPanelData = Awaited<ReturnType<typeof panelData>>;

/** Everything the panel renders, in one shape the page and fragments share. */
export async function panelData(notice = '') {
  const [health, processStatus, buckets, catalogs] = await Promise.all([
    head.health(),
    gymLifecycle.status(),
    storage.usage(),
    benchmarks.list().catch(() => []),
  ]);
  // The bound adapter of a catalog is the resources server a start would want;
  // the model type comes from the running set when there is one to read.
  const bound = catalogs.find((item) => item.adapter);
  const runningModel = health.servers.find((server) => server.serverType === 'responses_api_models' && server.healthy);
  return {
    health,
    headPid: processStatus.headPid,
    buckets,
    defaultResourcesServer: bound?.adapter ?? '',
    defaultModelType: runningModel?.name ?? '',
    notice,
  };
}

function field(body: unknown, key: string): string {
  const value = recordBody(body)[key];
  return typeof value === 'string' ? value.trim() : '';
}

export const settingsUi = new Elysia({ name: 'settings-ui' })
  .get('/ui/settings/gym', async () => <GymPanel {...await panelData()} />)
  .post('/ui/settings/gym/start', async ({ body }) => {
    let notice: string;
    try {
      const { pid } = await gymLifecycle.start({
        resourcesServer: field(body, 'resourcesServer'),
        modelType: field(body, 'modelType') || undefined,
      });
      notice = `Starting gym head server (pid ${pid}). Child servers take a minute to report healthy.`;
    } catch (error) {
      notice = errorMessage(error);
    }
    return <GymPanel {...await panelData(notice)} />;
  })
  .post('/ui/settings/gym/stop', async () => {
    let notice: string;
    try {
      const { stopped, killed } = await gymLifecycle.stop();
      notice = killed.length
        ? `Stopped ${stopped.length + killed.length} processes; ${killed.length} needed SIGKILL.`
        : `Stopped ${stopped.length} gym processes.`;
    } catch (error) {
      notice = errorMessage(error);
    }
    return <GymPanel {...await panelData(notice)} />;
  })
  .post('/ui/settings/gym/clear', async ({ body }) => {
    let notice: string;
    try {
      const { removed } = await storage.clear(field(body, 'bucket'), field(body, 'target') || undefined);
      notice = `Deleted ${removed}.`;
    } catch (error) {
      notice = errorMessage(error);
    }
    return <GymPanel {...await panelData(notice)} />;
  });
