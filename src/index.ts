/**
 * Application entry point. Composition only — no routes, no logic.
 *
 * Route modules live in src/http/. See AGENTS.md § The three HTTP surfaces for
 * which module a new route belongs in.
 */
import { Elysia } from 'elysia';
import { html } from '@elysiajs/html';
import { staticPlugin } from '@elysiajs/static';
import { config, ROOT } from './config.ts';
import { benchmarksApi } from './http/api/benchmarks.ts';
import { failureMapsApi } from './http/api/failure_maps.ts';
import { dataForgeApi } from './http/api/data_forge.ts';
import { gymApi } from './http/api/gym.ts';
import { settingsApi } from './http/api/settings.ts';
import { pages } from './http/pages.tsx';
import { benchmarksUi } from './http/ui/benchmarks.tsx';
import { jobsUi } from './http/ui/jobs.tsx';
import { failuresUi } from './http/ui/failures.tsx';
import { dataForgeUi } from './http/ui/data_forge.tsx';
import { settingsUi } from './http/ui/settings.tsx';
import { ledgerOptionsDocument, schemaDocument } from './http/schema.ts';
import { acquireServerLock, autostartGym, autostopGym } from './boot.ts';

const releaseServerLock = await acquireServerLock();
process.once('exit', releaseServerLock);

const staticFiles = await staticPlugin({
  assets: `${ROOT}/public`,
  prefix: '/',
  alwaysStatic: process.env.NODE_ENV === 'production',
  // Development must show exactly what is on disk after a refresh. Production
  // cache policy belongs to a release pass, not to active UI iteration.
  etag: false,
  headers: { 'Cache-Control': 'no-store' },
});

const app = new Elysia()
  .use(html())
  .use(staticFiles)
  .use(settingsApi)
  .use(gymApi)
  .use(benchmarksApi)
  .use(failureMapsApi)
  .use(dataForgeApi)
  .use(benchmarksUi)
  .use(failuresUi)
  .use(dataForgeUi)
  .use(jobsUi)
  .use(settingsUi)
  .use(pages)
  .get('/schema.html', schemaDocument)
  .get('/ledger-options.html', ledgerOptionsDocument);

try {
  app.listen({ hostname: config.host, port: config.port });
} catch (error) {
  releaseServerLock();
  throw error;
}

console.log(`recursive( ) lab → http://${config.host}:${config.port}`);
autostartGym();

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    // First hit: wait briefly for Gym's stop ladder. Remove this handler so a
    // second Ctrl+C during that window falls through to the default immediately.
    for (const each of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.removeAllListeners(each);
    const deadline = setTimeout(() => process.exit(0), 8_500);
    void autostopGym().finally(() => {
      clearTimeout(deadline);
      releaseServerLock();
      process.exit(0);
    });
  });
}

export type App = typeof app;
