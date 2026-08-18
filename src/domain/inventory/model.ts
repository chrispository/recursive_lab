/**
 * The shape of a plain-language inventory row.
 *
 * The Settings tab has to answer four questions about every kind of thing this
 * lab can hold: do I have any, how much, where does it sit, and — the one that
 * is normally left unsaid — what is *not* in it. A row that answers three of
 * those and stays quiet about the fourth is how someone comes to believe a
 * transcript is stored in the database, or that a score implies a recording.
 *
 * So `missing` is a required field, not an optional note.
 */

/** Which chapter of the story a holding belongs to. */
export type HoldingGroup = 'questions' | 'attempts' | 'lessons' | 'training';

export type Holding = {
  id: string;
  group: HoldingGroup;
  /** What it is, in words that assume nothing. */
  label: string;
  /** The word the gym, the docs and the rest of this app use for it. */
  alsoCalled: string;
  /** `partial` means it exists but is incomplete or stranded. */
  state: 'have' | 'none' | 'partial';
  /** How much of it there is, in words: `1 run`, `none yet`. */
  amount: string;
  /** Where it sits. Empty when the thing does not exist anywhere. */
  where: string;
  contains: string;
  missing: string;
};

export const HOLDING_GROUPS: { id: HoldingGroup; title: string; blurb: string }[] = [
  {
    id: 'questions',
    title: 'The questions',
    blurb: 'What you can ask a model to do. Imported from a public repository; no model has seen these yet.',
  },
  {
    id: 'attempts',
    title: 'The attempts',
    blurb: 'What happened when a model was actually asked. Every score in the app traces back to one of these.',
  },
  {
    id: 'lessons',
    title: 'The lessons',
    blurb: 'Mistakes sorted into topics, and practice material written for the weak ones. This is the point of the app.',
  },
  {
    id: 'training',
    title: 'Training and saved models',
    blurb: 'Things people mean by "checkpoint". None of it is made here, and knowing that removes most of the confusion.',
  },
];
