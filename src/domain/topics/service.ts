/** Topic rules. */
import type { TopicRow } from './model.ts';
import { hottest } from './model.ts';
import * as repo from './repo.ts';

export type { TopicRow } from './model.ts';
export { isBelowThreshold } from './model.ts';

export const listByTaxonomy = repo.listByTaxonomy;
export const countUncategorised = repo.countUncategorised;

/** The counts the taxonomy table's caption shows. */
export type TopicTally = {
  topics: number;
  failures: number;
  uncategorised: number;
  documents: number;
  /** Slug of the topic carrying the most failures, for the `hot` highlight. */
  hottestSlug: string | null;
};

export function tally(topics: TopicRow[], uncategorised: number): TopicTally {
  return {
    topics: topics.length,
    failures: topics.reduce((sum, topic) => sum + topic.failureCount, 0),
    uncategorised,
    documents: topics.reduce((sum, topic) => sum + topic.documentCount, 0),
    hottestSlug: hottest(topics)?.slug ?? null,
  };
}
