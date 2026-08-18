import { ROOT } from '../config.ts';

/** Standalone interactive schema map; kept outside the tab page router. */
export const schemaDocument = () => new Response(Bun.file(`${ROOT}/public/schema.html`), {
  headers: { 'content-type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
});

/** Standalone visual study for the proposed benchmark run ledger. */
export const ledgerOptionsDocument = () => new Response(Bun.file(`${ROOT}/public/ledger-options.html`), {
  headers: { 'content-type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
});
