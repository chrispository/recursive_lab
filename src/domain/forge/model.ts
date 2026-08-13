export type ForgeSummary = {
  forgeCode: string;
  failureMapCode: string;
  taxonomyCode: string;
  taxonomyName: string;
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
};
