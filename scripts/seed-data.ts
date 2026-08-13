/**
 * Fixture content for `bun run db:seed`.
 *
 * Shaped after a real run of the legal agent benchmark so the UI has honest
 * proportions to render: 1 run → 16 failed criteria → 6 capability topics →
 * 12 forged documents → 6 environments. Kept separate from seed.ts so the
 * insert logic stays readable.
 */

export const RUN = {
  label: 'harvey_001',
  model: 'glm-5.2',
  benchmark: {
    name: 'Legal Agent Bench',
    lab: 'Harvey',
    adapter: 'legal_agent_bench',
    description: 'Long-horizon legal research and drafting tasks, judged criterion by criterion.',
  },
  settings: {
    repeats: 1,
    concurrency: 1,
    temperature: 1.0,
    top_p: 0.95,
    judge_parallelism: 6,
    reward_mode: 'criteria_pass_rate',
  },
  metrics: {
    rollouts: 1,
    criteria_total: 69,
    criteria_passed: 53,
    pass_rate: 0.768,
    mean_reward: 0.768,
    input_tokens: 742312,
    output_tokens: 38754,
  },
} as const;

/** The task these failures came from. One task, many criteria. */
export const TASK_ID =
  'trusts-estates-private-client__extract-distribution-requirements-from-trust-agreement';

/**
 * The taxonomy the analyst model produced, with the failed criteria it grouped
 * under each topic. `reward` is what local validation later measured — one
 * topic sits below its pass threshold, which is what makes the table
 * interesting to look at.
 */
export const TOPICS = [
  {
    name: 'Provision Substance and Obligation Extraction',
    slug: 'provision-substance-and-obligation-extraction',
    description: 'Extract operative language, not a heading.',
    verifier_strategy:
      'The response must quote or paraphrase the operative obligation, not merely name the section it appears in.',
    reward: 1.0,
    failures: [
      ['C-014', 'Identifies the distribution standard', 'Named the article but not the operative "health, education, maintenance and support" standard it contains.'],
      ['C-022', 'States the trustee obligation', 'Described the trustee as "responsible for distributions" without extracting the mandatory-versus-discretionary language.'],
      ['C-031', 'Quotes the controlling sentence', 'Summarised the provision instead of quoting the sentence that creates the duty.'],
      ['C-047', 'Distinguishes mandatory from discretionary', 'Treated a discretionary distribution as mandatory; the word "may" was not surfaced.'],
    ],
  },
  {
    name: 'Provision-Fact Matching and Governing Section',
    slug: 'provision-fact-matching-and-governing-section',
    description: 'Match facts to the provision that governs.',
    verifier_strategy:
      'Given a fact pattern, the response must cite the specific provision that governs it rather than the nearest topical heading.',
    reward: 1.0,
    failures: [
      ['C-008', 'Cites the governing provision', 'Cited the general distributions article when the specific successor-trustee clause governed.'],
      ['C-019', 'Applies facts to the right clause', 'Applied the wrong clause to the beneficiary\'s stated circumstances.'],
      ['C-052', 'Excludes inapplicable provisions', 'Listed three provisions without saying which one actually controls.'],
    ],
  },
  {
    name: 'Prudent Actionable Next Steps',
    slug: 'prudent-actionable-next-steps',
    description: 'Recommend steps instead of a definitive conclusion.',
    verifier_strategy:
      'Where the document is ambiguous, the response must recommend a concrete next step rather than assert a conclusion the text does not support.',
    reward: 0.746,
    failures: [
      ['C-003', 'Recommends a next step', 'Asserted a definitive answer where the trust instrument was silent.'],
      ['C-027', 'Flags the need for further review', 'Did not note that the amendment history was incomplete.'],
      ['C-061', 'Avoids unsupported conclusions', 'Concluded the distribution was permitted without the governing amendment in evidence.'],
    ],
  },
  {
    name: 'Static Reference Ambiguity Flagging',
    slug: 'static-reference-ambiguity-flagging',
    description: 'External standard frozen as of a date.',
    verifier_strategy:
      'When a document incorporates an external standard, the response must flag whether the reference is static (as of a date) or ambulatory.',
    reward: 1.0,
    failures: [
      ['C-011', 'Flags static incorporation', 'Read an "as in effect on the date hereof" reference as tracking current law.'],
      ['C-038', 'Identifies the reference date', 'Did not surface the date the external standard was frozen to.'],
    ],
  },
  {
    name: 'Conflict of Interest Detection',
    slug: 'conflict-of-interest-detection',
    description: 'Successor fiduciary affiliated with the firm.',
    verifier_strategy:
      'The response must surface any fiduciary appointment where the appointee is affiliated with the drafting firm or a beneficiary.',
    reward: 1.0,
    failures: [
      ['C-016', 'Detects the affiliation', 'Missed that the named successor trustee is a partner at the drafting firm.'],
      ['C-044', 'Notes the disclosure requirement', 'Did not mention that the affiliation requires disclosure to beneficiaries.'],
    ],
  },
  {
    name: 'Indexed Value Computation',
    slug: 'indexed-value-computation',
    description: 'Show the arithmetic behind an indexed figure.',
    verifier_strategy:
      'Where a figure is indexed or adjusted, the response must show the computation, not just the result.',
    reward: 1.0,
    failures: [
      ['C-025', 'Shows the computation', 'Gave an adjusted figure with no arithmetic.'],
      ['C-058', 'Uses the correct index base', 'Applied the wrong base year to the adjustment.'],
    ],
  },
] as const;

export type SeedTopic = (typeof TOPICS)[number];

/** Two forged documents per topic, matching the 12 the real run produced. */
export const DOCUMENT_TYPES = ['memo', 'trust_agreement', 'letter', 'record'] as const;

export const ANALYSIS_PROMPT = `You are grouping criterion-level benchmark failures into capability topics.

Return a taxonomy of abstract capabilities. Each topic needs a name, a description, and an observable verifier strategy — a rule an automated judge could apply to a fresh document.

Do not reference the specific task, document, or answer. A topic must describe a capability, not an incident.`;

export const GENERATION_PROMPT = `You are writing a novel source document and a task that exercises one capability.

You will be given only a capability topic: its name, its description, and the verifier strategy that will judge the response. You will not be shown the original benchmark task, its documents, or its answer.

Write a realistic source document, a task instruction, a reference answer, and the list of targets a verifier should check.`;
