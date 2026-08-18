import type { Detection } from '../../lib/formats.ts';
import type { GymPin } from '../../gym/pins.ts';

/** The editable half of an import — what the user confirms before committing. */
export type ImportPlan = {
  name: string;
  lab: string;
  description: string;
  /**
   * Process name of the gym resources server that executes this catalog.
   * Empty until bind time: a benchmark can be catalogued without being
   * runnable. `benchmarks.runnable` records that difference.
   */
  adapter: string;
};

/** The immutable half — resolved from the source, not up for editing. */
export type ImportSource = {
  kind: 'github' | 'huggingface';
  identifier: string;
  url: string;
  /** Always a commit sha, never a branch. An import is of one revision. */
  revision: string;
  pinnedUrl: string;
};

export type ImportPreview = {
  /** Opaque handle for the staged snapshot; pass it back to commit. */
  token: string;
  source: ImportSource;
  detection: Detection;
  plan: ImportPlan;
  snapshot: { scanned: number; files: number; bytes: number; cached: boolean };
  /** Set when this exact revision is already in the catalog. */
  existing: { benchmarkId: number; benchmarkCode: string } | null;
  /** A few real tasks, so the user can see what they are about to import. */
  sampleTasks: { taskId: string; name: string; criteria: number }[];
};

/** What an import wrote, counted back out of the database. */
export type ImportTally = {
  benchmarkId: number;
  benchmarkCode: string;
  benchmarks: number;
  benchmarkTasks: number;
  benchmarkTaskCriteria: number;
  jobCode: string;
};

/** Row shape for writing one task and its criteria. */
export type TaskWrite = {
  dataset: string;
  taskId: string;
  name: string;
  sourcePath: string;
  position: number;
  metadata: Record<string, unknown>;
  criteria: {
    criterionId: string;
    title: string;
    matchCriteria: string;
    position: number;
    source: Record<string, unknown>;
  }[];
};

/** Everything needed to open a `benchmarks` row. */
export type BenchmarkHeader = ImportSource &
  ImportPlan & {
    detectedFormat: string;
    snapshotPath: string;
  };

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
  taskCount: number;
  criterionCount: number;
  tasks: BenchmarkTask[];
};

/**
 * One catalog against the gym's own benchmark pin: which commit each copy is
 * frozen at, and how many of the catalog's tasks the gym can actually run.
 */
export type CatalogAlignment = {
  benchmarkCode: string;
  name: string;
  sourceIdentifier: string;
  catalogRevision: string;
  gymRevision: string;
  sameSource: boolean;
  aligned: boolean;
  taskCount: number;
  runnableCount: number;
  missingCount: number;
  /** Task families (the id before the first `__`) with no runnable tasks. */
  missingFamilies: string[];
};

/** The full report the Settings page renders: gym pin plus per-catalog rows. */
export type AlignmentReport = { gym: GymPin; catalogs: CatalogAlignment[] };
