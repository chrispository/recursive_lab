/**
 * The full HTML document. Rendered only on a cold load, refresh, or deep link —
 * HTMX navigations get the bare workspace region instead (see http/respond.tsx).
 */
import type { PropsWithChildren } from '@kitajs/html';
import { Rail, type RailState } from './Rail.tsx';
import type { Tab } from './tabs.ts';

/**
 * Applies the saved theme before first paint so the page never flashes light
 * then snaps dark. Must stay inline in <head> and must stay tiny.
 */
const PREPAINT = `
(function(){
  var d=document.documentElement, t=localStorage.getItem('recursive-theme');
  d.dataset.theme = t || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  var n=localStorage.getItem('recursive-density'); if(n) d.dataset.density=n;
})();`;

export type DocumentProps = PropsWithChildren<{
  tab: Tab;
  title: string;
  rail: RailState;
}>;

export function Document({ tab, title, rail, children }: DocumentProps) {
  return (
    <>
      {'<!doctype html>'}
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>{title} · recursive( )</title>
          <script>{PREPAINT}</script>
          <link rel="stylesheet" href="/css/tokens.css" />
          <link rel="stylesheet" href="/css/base.css" />
          <link rel="stylesheet" href="/css/ledger.css?v=2" />
          <link rel="stylesheet" href="/css/settings.css?v=2" />
          <script src="/js/htmx.min.js" defer />
          <script src="/js/app.js" defer />
        </head>
        <body>
          <div class="scanlines" aria-hidden="true" />
          <div class="ledger">
            <Rail tab={tab} state={rail} />
            {/* Every HTMX page navigation swaps this element's contents. */}
            <main id="workspace" class="m-main">
              {children}
            </main>
          </div>
        </body>
      </html>
    </>
  );
}
