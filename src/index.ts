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
import { gymApi } from './http/api/gym.ts';
import { settingsApi } from './http/api/settings.ts';
import { pages } from './http/pages.tsx';
import { benchmarksUi } from './http/ui/benchmarks.tsx';
import { jobsUi } from './http/ui/jobs.tsx';
import { settingsUi } from './http/ui/settings.tsx';
import { schemaDocument } from './http/schema.ts';
import { autostartGym, autostopGym } from './boot.ts';

const staticFiles = await staticPlugin({
  assets: `${ROOT}/public`,
  prefix: '/',
  alwaysStatic: process.env.NODE_ENV === 'production',
});

const app = new Elysia()
  .use(html())
  .use(staticFiles)
  .use(settingsApi)
  .use(gymApi)
  .use(benchmarksApi)
  .use(benchmarksUi)
  .use(jobsUi)
  .use(settingsUi)
  .use(pages)
  .get('/schema.html', schemaDocument)
  .listen({ hostname: config.host, port: config.port });

console.log(`recursive( ) lab → http://${config.host}:${config.port}`);
autostartGym();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    autostopGym();
  });
}

export type App = typeof app;
