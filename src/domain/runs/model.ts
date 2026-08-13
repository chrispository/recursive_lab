import type { InValue } from '@libsql/client';

export type JsonObject = Record<string, InValue>;

export type BenchmarkCriterionResult = {
  criterionId: string;
  title: string;
  verdict: 'pass' | 'fail' | 'error';
  reasoning: string;
  matchCriteria: string;
  judgeModel: string;
  judgeError: boolean;
  errorType: string | null;
};

export type BenchmarkRunSummary = {
  benchmarkRunId: number;
  benchmarkRunCode: string;
  benchmarkCode: string;
  benchmarkName: string;
  lab: string;
  adapter: string;
  benchmarkStatus: 'importing' | 'ready' | 'failed';
  runnable: boolean;
  label: string;
  model: string;
  taskCount: number;
  settings: JsonObject;
  metrics: JsonObject;
  outputPath: string | null;
  resultOutcome: 'passed' | 'failed' | 'error' | 'skipped' | null;
  resultCriteriaTotal: number | null;
  resultCriteriaPassed: number | null;
  resultCriteriaFailed: number | null;
};
