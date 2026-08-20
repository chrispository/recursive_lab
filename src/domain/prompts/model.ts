/** One immutable prompt revision selected for an LLM-backed job. */
export type PromptRevision = {
  promptRevisionId: number;
  promptKey: string;
  revisionNumber: number;
  body: string;
  modelHint: string;
};
