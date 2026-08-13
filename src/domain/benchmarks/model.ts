export type BenchmarkTask = {
  dataset: string;
  taskId: string;
  name: string;
  sourcePath: string;
  position: number;
};

export type BenchmarkCatalog = {
  benchmarkId: number;
  benchmarkCode: string;
  name: string;
  lab: string;
  sourceUrl: string;
  sourceKind: 'github' | 'huggingface' | 'builtin';
  sourceIdentifier: string;
  revision: string;
  detectedFormat: string;
  adapter: string;
  status: 'importing' | 'ready' | 'failed';
  runnable: boolean;
  description: string;
  tasks: BenchmarkTask[];
};
