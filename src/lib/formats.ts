/**
 * The benchmark format registry.
 *
 * A benchmark source is any GitHub or HuggingFace repository, and they are not
 * laid out alike. Rather than teach the importer every layout, each layout is a
 * module implementing `BenchmarkFormat`, and this file is the only place that
 * knows the list. Supporting a new one means adding a sibling module and one
 * line in `FORMATS` — no change to staging, the domain, or the routes.
 *
 * Detection runs against an already-staged snapshot, but staging has to happen
 * first, so `KEEP_ANY` is the union of every format's file filter. It is still a
 * tiny slice of a repository that is mostly binary documents.
 */
import * as harbor from './harbor.ts';
import * as tabular from './tabular.ts';

/** One grading criterion belonging to a task definition. */
export type ImportedCriterion = {
  criterionId: string;
  title: string;
  matchCriteria: string;
  position: number;
  source: Record<string, unknown>;
};

/** One task, in the shape the benchmarks domain persists. */
export type ImportedTask = {
  taskId: string;
  name: string;
  /** Path relative to the snapshot root, for provenance. */
  sourcePath: string;
  /** Exact source bytes represented by this task, retained only for hashing. */
  sourceContent: string;
  position: number;
  metadata: Record<string, unknown>;
  criteria: ImportedCriterion[];
};

export type Detection = {
  detected: boolean;
  /** Registry id of the format that matched, or '' when none did. */
  format: string;
  label: string;
  taskCount: number;
  criterionCount: number;
  /** Tasks with no criteria — importable, but nothing can grade them. */
  tasksWithoutCriteria: number;
  /** Why detection failed, or a caveat about what did match. */
  reason: string;
};

export type ReadOptions = {
  /**
   * Stop after this many tasks. A preview shows a handful of real tasks to
   * prove the mapping is right; without this it re-parses the whole benchmark
   * to display five rows, which on a 19k-task source is not a free operation.
   */
  limit?: number;
};

export type BenchmarkFormat = {
  id: string;
  label: string;
  /** Which files this format needs staged out of the archive. */
  keep: (path: string) => boolean;
  detect: (root: string) => Promise<Detection>;
  read: (root: string, options?: ReadOptions) => Promise<ImportedTask[]>;
};

/**
 * Order matters: the first format that matches wins.
 *
 * Harbor is first because it is the most specific — a repository with a
 * `tasks/**‍/task.json` tree is unambiguous. Tabular is the fallback, since
 * loose `.jsonl` files are a much weaker signal.
 */
export const FORMATS: BenchmarkFormat[] = [harbor.format, tabular.format];

/** Union of every format's filter, applied while the archive streams past. */
export const KEEP_ANY = (path: string) => FORMATS.some((format) => format.keep(path));

/** Human list of what we can import, for error messages. */
export const supported = () => FORMATS.map((format) => format.label).join(', ');

/**
 * Identify a staged snapshot.
 *
 * Returns the first matching format. When nothing matches, the reason names
 * every format that was tried and why each declined, because "unsupported
 * source" alone tells the user nothing about what to fix.
 */
export async function detectFormat(root: string): Promise<{ detection: Detection; format: BenchmarkFormat | null }> {
  const declined: string[] = [];
  for (const format of FORMATS) {
    const detection = await format.detect(root);
    if (detection.detected) return { detection, format };
    declined.push(`${format.label}: ${detection.reason || 'no match'}`);
  }
  return {
    format: null,
    detection: {
      detected: false,
      format: '',
      label: '',
      taskCount: 0,
      criterionCount: 0,
      tasksWithoutCriteria: 0,
      reason: declined.join(' · '),
    },
  };
}

/** Look a format up by registry id, for a commit replaying a preview. */
export const formatById = (id: string) => FORMATS.find((format) => format.id === id) ?? null;
