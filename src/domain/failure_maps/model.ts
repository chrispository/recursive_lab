import type { PromptRevision } from '../prompts/model.ts';

/** The only benchmark material allowed into failure analysis. */
export type FailureCandidate = {
  criterionResultId: number;
  benchmarkResultId: number;
  taskId: string;
  trialName: string;
  criterionId: string;
  criterionTitle: string;
  reasoning: string;
  sourceJson: string;
};

export type FailureTopicDraft = {
  name: string;
  slug: string;
  description: string;
  verifierStrategy: string;
  failureIds: string[];
};

export type FailureMapOutput = { topics: FailureTopicDraft[] };

export type FailureMapStart = {
  benchmarkRunId: number;
  benchmarkRunCode: string;
  jobId: number;
  jobCode: string;
};

export type FailureMapContext = {
  benchmarkRunId: number;
  benchmarkResultId: number;
  candidates: FailureCandidate[];
  prompt: PromptRevision;
};
