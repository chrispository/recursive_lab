import type { InValue } from '@libsql/client';

export type JsonObject = Record<string, InValue>;

export type RunSummary = {
  runId: number;
  runCode: string;
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
};
