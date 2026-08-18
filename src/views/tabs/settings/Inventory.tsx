/**
 * "What you have right now" — the inventory panel.
 *
 * Rendered inside the `#settings-gym` fragment rather than as its own region:
 * every number here moves for the same reasons that region already redraws
 * (a run finished, a folder was cleared, the gym came up), and a second region
 * polling the same directories would double the cost of saying the same thing.
 *
 * Each row states four things in the same order, including the one usually left
 * out — what the thing does *not* contain.
 */
import type { Holding } from '../../../domain/inventory/model.ts';
import { HOLDING_GROUPS } from '../../../domain/inventory/model.ts';
import { Badge } from '../../ui/Badge.tsx';
import { Panel } from '../../ui/Panel.tsx';

/** Badges are one word everywhere else in the app; a phrase in the 9px chip
 *  voice is unreadable next to a sentence, so the sentence carries the detail. */
const STATE_WORD = { have: 'have', partial: 'partly', none: 'none' } as const;
const STATE_BADGE = { have: 'ready', partial: 'pending', none: 'idle' } as const;

function Row({ holding }: { holding: Holding }) {
  // "Contains" would be a lie above an empty table, and "does not contain" is
  // the wrong heading for a row whose whole story is why the thing is absent.
  const contains = holding.state === 'none' ? 'Would contain' : 'Contains';
  const missing = holding.contains ? 'Does not contain' : 'Why you have none';
  return (
    <div class="m-hold">
      <div class="m-hold-head">
        <span class="m-hold-label">{holding.label}</span>
        <Badge state={STATE_BADGE[holding.state]}>{STATE_WORD[holding.state]}</Badge>
      </div>
      <span class="m-hold-also">called {holding.alsoCalled} everywhere else</span>
      <span class="m-hold-amount">{holding.amount}</span>
      {holding.where
        ? holding.where.split('\n').map((path) => <code class="m-storage-path">{path}</code>)
        : null}
      {holding.contains ? <p class="m-hold-line"><span>{contains}</span> {holding.contains}</p> : null}
      <p class="m-hold-line is-missing"><span>{missing}</span> {holding.missing}</p>
    </div>
  );
}

export function Inventory({ holdings }: { holdings: Holding[] }) {
  return (
    <Panel id="settings-inventory" class="m-prose" title="What you have right now" code="measured, not assumed">
      <p class="m-note">
        Counted from the database and from the folders on disk each time this page loads. A row saying “you have
        none” means the table really is empty — not that something failed to load.
      </p>
      {HOLDING_GROUPS.map((group) => {
        const rows = holdings.filter((holding) => holding.group === group.id);
        if (rows.length === 0) return null;
        return (
          <section class="m-hold-group">
            <h4>{group.title}</h4>
            <p class="m-note">{group.blurb}</p>
            {rows.map((holding) => <Row holding={holding} />)}
          </section>
        );
      })}
    </Panel>
  );
}
