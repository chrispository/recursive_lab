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
import { settingsApi } from './http/api/settings.ts';
import { pages } from './http/pages.tsx';
import { schemaDocument } from './http/schema.ts';

const staticFiles = await staticPlugin({ assets: `${ROOT}/public`, prefix: '/', alwaysStatic: true });

const app = new Elysia()
  .use(html())
  .use(staticFiles)
  .use(settingsApi)
  .use(pages)
  .get('/schema.html', schemaDocument)
  .listen({ hostname: config.host, port: config.port });

console.log(`recursive( ) lab → http://${config.host}:${config.port}`);

export type App = typeof app;
