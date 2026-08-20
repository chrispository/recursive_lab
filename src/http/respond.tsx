/**
 * The one place that decides "full document or bare region?".
 *
 * A page URL like /failures serves two audiences: a browser doing a cold load
 * (needs the whole document) and HTMX doing a navigation (needs only the
 * workspace region, plus a refreshed rail). Both come from the same handler.
 */
import { Document } from '../views/layout/Document.tsx';
import { Rail, type RailState } from '../views/layout/Rail.tsx';
import { titleOf, type Tab } from '../views/layout/tabs.ts';

const isHtmx = (request: Request) => request.headers.get('HX-Request') === 'true';

/**
 * Renders a page. Under HTMX, returns the workspace body plus an out-of-band
 * rail so the active stripe and gate readout stay in sync without a second
 * request; otherwise the full document.
 */
export function page(
  request: Request,
  tab: Tab,
  rail: RailState,
  body: JSX.Element,
): JSX.Element {
  if (isHtmx(request)) {
    return (
      <>
        {body}
        <Rail tab={tab} state={rail} oob />
      </>
    );
  }
  return (
    <Document tab={tab} title={titleOf(tab)} rail={rail}>
      {body}
    </Document>
  );
}
