export type EnvironmentRow = {
  environmentCode: string;
  topicName: string;
  topicCode: string;
  status: 'draft' | 'built' | 'ready' | 'failed';
  baseModel: string;
  inferenceModel: string;
  verifierName: string;
  passThreshold: number;
  localPath: string | null;
  scaleReady: boolean;
};

export type EvaluationSummary = {
  evaluationCode: string;
  kind: 'rl_test' | 'validation';
  model: string;
  endpointLabel: string;
  rolloutsPerExample: number;
  maxConcurrent: number;
  meanReward: number | null;
  aboveThreshold: number;
  tasksScored: number;
  withinTaskStd: number | null;
  saturatedFraction: number | null;
  trainableSignal: number | null;
};
