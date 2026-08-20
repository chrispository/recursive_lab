export type DataForgeSummary = {
  dataForgeCode: string;
  failureMapCode: string;
  promptRevisionId: number;
  topicCount: number;
  backend: 'data_designer' | 'frontier';
  providerModel: string;
  docsPerTopic: number;
  noveltyThreshold: number;
  autoApprove: boolean;
  requestedDocuments: number;
  createdDocuments: number;
  novelDocuments: number;
  pendingReview: number;
  rejectedDocuments: number;
  inputTokens: number;
  outputTokens: number;
};

export type DocumentRow = {
  documentCode: string;
  topicCode: string;
  topicName: string;
  title: string;
  documentType: string;
  noveltyStatus: 'passed' | 'rejected' | 'review';
  reviewStatus: 'pending' | 'approved' | 'rejected';
  role: 'train' | 'canary' | 'heldout' | 'excluded';
  wordCount: number;
  maxSimilarity: number;
  content: string;
  taskInstruction: string;
  referenceAnswer: string;
  verifierTargets: string[];
};

export type ForgeTopicInput = {
  topicId: number;
  topicCode: string;
  name: string;
  description: string;
  verifierStrategy: string;
  remaining: number;
};

export type DataForgeStart = {
  benchmarkRunId: number;
  dataForgeRunCode: string;
  failureMapCode: string;
  jobId: number;
  jobCode: string;
  requestedDocuments: number;
};
