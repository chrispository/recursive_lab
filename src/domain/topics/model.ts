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

/** A topic as the taxonomy table renders it, counts included. */
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
  /** Documents forged for it. */
  documentCount: t.Integer(),
  /** Mean reward local validation measured, or null if never proved. */
  reward: t.Union([t.Number(), t.Null()]),
  /** The verifier's pass threshold, so the bar can show where the line is. */
  passThreshold: t.Union([t.Number(), t.Null()]),
});

export type TopicRow = Static<typeof TopicRow>;

/** Is this topic's measured reward below the bar its verifier sets? */
export const isBelowThreshold = (topic: TopicRow): boolean =>
  topic.reward !== null && topic.passThreshold !== null && topic.reward < topic.passThreshold;

/**
 * The topic carrying the most unaddressed failures — the one the tally
 * highlights, because it is where the next forge run should aim.
 */
export function hottest(topics: TopicRow[]): TopicRow | null {
  let best: TopicRow | null = null;
  for (const topic of topics) {
    if (!best || topic.failureCount > best.failureCount) best = topic;
  }
  return best;
}
