/**
 * Surface B — Settings tab fragments for the gym environment and storage.
 *
 * One region (`#settings-gym`), returned by GET and by every POST below, so
 * each action redraws exactly what changed and nothing else.
 */
import { Elysia } from 'elysia';
import * as benchmarks from '../../domain/benchmarks/service.ts';
import * as inventory from '../../domain/inventory/service.ts';
import * as head from '../../gym/head.ts';
import * as gymLifecycle from '../../gym/lifecycle.ts';
import * as storage from '../../gym/storage.ts';
import { GymPanel } from '../../views/tabs/settings/GymPanel.tsx';

const message = (error: unknown) => (error instanceof Error ? error.message : 'Unexpected error.');

export type GymPanelData = Awaited<ReturnType<typeof panelData>>;

/** Everything the panel renders, in one shape the page and fragments share. */
export async function panelData(notice = '') {
  const [health, processStatus, buckets, catalogs, alignment] = await Promise.all([
    head.health(),
    gymLifecycle.status(),
    storage.usage(),
    benchmarks.list().catch(() => []),
    benchmarks.alignment().catch(() => null),
  ]);
  // The bound adapter of a catalog is the resources server a start would want;
  // the model type comes from the running set when there is one to read.
  const bound = catalogs.find((item) => item.adapter);
  const runningModel = health.servers.find((server) => server.serverType === 'responses_api_models' && server.healthy);
  const report = alignment ?? {
    gym: { resolved: false, reason: '', repository: '', revision: '', taskCount: 0, runnableTaskIds: [] },
    catalogs: [],
  };
  return {
    health,
    headPid: processStatus.headPid,
    buckets,
    catalogs,
    defaultResourcesServer: bound?.adapter ?? '',
    defaultModelType: runningModel?.name ?? '',
    notice,
    alignment: report,
    // Storage is handed over rather than re-measured: walking the gym checkout
    // a second time per page load would cost seconds to restate what the
    // buckets above already know.
    holdings: await inventory.report(buckets, report).catch(() => []),
  };
}

function field(body: unknown, key: string): string {
  if (!body || typeof body !== 'object') return '';
  const value = (body as Record<string, unknown>)[key];
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
      notice = message(error);
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
      notice = message(error);
    }
    return <GymPanel {...await panelData(notice)} />;
  })
  .post('/ui/settings/gym/clear', async ({ body }) => {
    let notice: string;
    try {
      const { removed } = await storage.clear(field(body, 'bucket'), field(body, 'target') || undefined);
      notice = `Deleted ${removed}.`;
    } catch (error) {
      notice = message(error);
    }
    return <GymPanel {...await panelData(notice)} />;
  });
