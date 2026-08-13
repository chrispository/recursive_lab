/**
 * Surface A — pages. One route per tab, each returning a full HTML document
 * (or the bare workspace region under HTMX; see respond.tsx).
 *
 * These handlers only gather data and pick a view. Business rules belong in
 * domain/*\/service.ts.
 */
import { Elysia } from 'elysia';
import { page } from './respond.tsx';
import { EMPTY_RAIL } from '../views/layout/Rail.tsx';
import { isTab, TABS, titleOf, type Tab } from '../views/layout/tabs.ts';

/** Placeholder body until each tab's views land in phase 2. */
const Stub = ({ tab }: { tab: Tab }) => (
  <>
    <div class="m-title">
      <h2>{titleOf(tab)}</h2>
      <p>This stage has no view yet — see PLAN.md phase 2.</p>
    </div>
    <div class="m-tablebox">
      <div class="m-cap">
        <h3>{tab}</h3>
        <span class="m-code">stub</span>
      </div>
      <div class="m-body" style="padding:var(--s4)">
        <p class="m-note">Nothing here yet.</p>
      </div>
    </div>
  </>
);

export const pages = new Elysia({ name: 'pages' })
  .get('/', ({ redirect }) => redirect('/benchmarks', 302))
  .get('/:tab', ({ params, request, status }) => {
    if (!isTab(params.tab)) return status(404, 'Not found');
    return page(request, params.tab, EMPTY_RAIL, <Stub tab={params.tab} />);
  });

export { TABS };
