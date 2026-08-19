/**
 * TP — a capability topic.
 *
 * A topic is an abstract capability the model failed at, not an incident. Its
 * `verifierStrategy` is the observable rule a judge applies, and — together
 * with the name and description — it is the *only* thing the document
 * generator is allowed to see. See AGENTS.md § Domain rules (anti-benchmax).
 */
import { t, type Static } from 'elysia';

export const TopicStatus = t.Union([t.Literal('active'), t.Literal('archived')]);

/** A topic as the failure-map table renders it, counts included. */
export const TopicRow = t.Object({
  id: t.Integer(),
  code: t.String(),
  name: t.String(),
  slug: t.String(),
  description: t.String(),
  verifierStrategy: t.String(),
  status: TopicStatus,
  /** Failed criteria grouped under this topic. */
  failureCount: t.Integer(),
  /** Documents generated for it by the data-forge stage. */
  documentCount: t.Integer(),
});

export type TopicRow = Static<typeof TopicRow>;

/**
 * The topic carrying the most unaddressed failures — the one the tally
 * highlights, because it is where the next data-forge run should aim.
 */
export function hottest(topics: TopicRow[]): TopicRow | null {
  let best: TopicRow | null = null;
  for (const topic of topics) {
    if (!best || topic.failureCount > best.failureCount) best = topic;
  }
  return best;
}
