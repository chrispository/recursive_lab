/**
 * Importing a benchmark from a URL, and reading the catalog it fills.
 *
 * The import is two-phase on purpose. `preview()` resolves and downloads but
 * writes nothing to the database; `commit()` persists what the preview staged.
 * A benchmark can be thousands of tasks and six figures of criteria, so the
 * user should see what they are taking on, and a wrong URL should cost nothing
 * but a download.
 *
 * This is the first link in the pipeline chain:
 *
 *   benchmarks → benchmark_tasks → benchmark_task_criteria
 *
 * Everything downstream refers back to the task and criterion identity
 * established here, so the import is where that identity is fixed.
 */
import { mkdir, rename, rm } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { config } from '../../config.ts';
import { code } from '../../db/ids.ts';
import * as archive from '../../lib/archive.ts';
import * as formats from '../../lib/formats.ts';
import * as source from '../../lib/source.ts';
import * as head from '../../gym/head.ts';
import * as servers from '../../gym/servers.ts';
import { syncPin } from '../../gym/sync.ts';
import { audit } from '../audit/service.ts';
import type { GymSyncSummary } from './model.ts';
import * as jobs from '../jobs/trace.ts';
import type { BenchmarkCatalog as BenchmarkCatalogRow, ImportPlan, ImportPreview, ImportTally } from './model.ts';
import * as repo from './repo.ts';

export type { BenchmarkCatalog, BenchmarkTask, ImportPlan, ImportPreview, ImportTally } from './model.ts';
export { SourceError } from '../../lib/source.ts';
export { ArchiveError } from '../../lib/archive.ts';
export { RepinError } from '../../gym/repin.ts';

export const list = repo.listCatalogs;
export const tasks = repo.listTasks;
export const get = repo.get;
export const criteriaFor = repo.listCriteriaFor;

/**
 * Which catalog a benchmarks view is looking at.
 *
 * One place decides, because three call sites need the same answer and a view
 * that picks its own would pair a selector with somebody else's task list.
 */
export function select(catalogs: BenchmarkCatalogRow[], preferred?: number | null): BenchmarkCatalogRow | null {
  return catalogs.find((catalog) => catalog.benchmarkId === preferred) ?? catalogs[0] ?? null;
}

/**
 * One catalog with its task rows attached — the only way tasks are loaded.
 *
 * The picker filters client-side, so it wants the whole task list of the
 * benchmark on screen; what it must never do is carry the task lists of the
 * benchmarks that are merely options in a dropdown. See AGENTS.md § The three
 * HTTP surfaces: an endpoint never returns a field the view does not render.
 */
export async function withTasks(benchmarkId: number | null | undefined): Promise<BenchmarkCatalogRow | null> {
  if (typeof benchmarkId !== 'number' || !Number.isInteger(benchmarkId)) return null;
  const catalog = await repo.get(benchmarkId);
  if (!catalog) return null;
  return { ...catalog, tasks: await repo.listTasks(benchmarkId, catalog.taskCount) };
}

/** Tasks are written in pages so the trace shows movement on a long import. */
const PAGE = 100;

export class ImportError extends Error {}

/**
 * A staging token is derived from the source, not random.
 *
 * A pinned revision is immutable, so re-previewing the same commit can reuse
 * the snapshot already on disk instead of downloading the archive again.
 */
const tokenFor = (identifier: string, revision: string) =>
  new Bun.CryptoHasher('sha256').update(`${identifier}@${revision}`).digest('hex').slice(0, 16);

/**
 * Tokens are our own 16 hex characters, and a commit takes its preview back
 * from the request body — so the token is user input and is checked as such
 * before it is ever joined onto a path. `archive.stagingPath` guards the join
 * too; this is the layer that can say *why* it was rejected.
 */
const TOKEN = /^[0-9a-f]{16}$/;

/** Repository name to display name: `some-bench_v2` → `Some Bench V2`. */
const titleCase = (slug: string) =>
  slug.split(/[-_]/).filter(Boolean).map((word) => word[0]!.toUpperCase() + word.slice(1)).join(' ');

/**
 * Resolve, download and inspect a source without touching the database.
 *
 * Only the definition files some registered format asks for are written to
 * disk — typically a small fraction of a repository whose bulk is binary task
 * documents. Format identification happens after staging, against what landed.
 */
export async function preview(url: string, ref = ''): Promise<ImportPreview> {
  const pinned = await source.resolveSource(url, ref);
  const token = tokenFor(pinned.identifier, pinned.revision);
  const stagingDir = archive.stagingPath(config.paths.staging, token);

  await mkdir(config.paths.staging, { recursive: true });
  // A pinned revision is immutable, so a snapshot already on disk is still
  // correct and re-previewing skips the download entirely.
  const cachedHit = await formats.detectFormat(stagingDir).catch(() => null);
  const cached = Boolean(cachedHit?.detection.detected);

  const snapshot = cached
    ? { scanned: cachedHit!.detection.taskCount, files: cachedHit!.detection.taskCount, bytes: 0 }
    : await archive.stage(pinned.archiveUrl, stagingDir, { keep: formats.KEEP_ANY });

  const { detection, format } = cached ? cachedHit! : await formats.detectFormat(stagingDir);
  if (!detection.detected || !format) {
    await archive.discard(stagingDir);
    throw new ImportError(
      `No supported benchmark format was found in ${pinned.identifier}. ` +
        `Tried ${formats.supported()} — ${detection.reason}`,
    );
  }

  const [owner, repoName] = pinned.identifier.split('/');
  const sample = await format.read(stagingDir, { limit: 5 });

  return {
    token,
    source: {
      kind: pinned.kind,
      identifier: pinned.identifier,
      url: pinned.url,
      revision: pinned.revision,
      pinnedUrl: pinned.pinnedUrl,
    },
    detection,
    plan: {
      name: titleCase(repoName ?? pinned.identifier),
      lab: owner ?? '',
      description: `${detection.taskCount} tasks, ${detection.criterionCount} grading criteria, ${detection.label}.`,
      // Left empty deliberately: nothing here knows which gym resources server
      // can run this benchmark, and guessing would produce a row that claims to
      // be runnable and is not.
      adapter: '',
    },
    snapshot: { ...snapshot, cached },
    existing: await repo.findBySourceRevision(pinned.identifier, pinned.revision),
    sampleTasks: sample.map((task) => ({
      taskId: task.taskId,
      name: task.name,
      criteria: task.criteria.length,
    })),
  };
}

/**
 * Persist a previewed import, tracing every row it writes.
 *
 * The staged snapshot is moved — not copied — under the benchmark's own code, so
 * the task definitions stay available after staging is cleared.
 */
export async function commit(
  preview: ImportPreview,
  overrides: Partial<ImportPlan> = {},
  options: { replace?: boolean; echo?: boolean } = {},
): Promise<ImportTally> {
  // Ask the database, not the preview. A preview is a snapshot of the past —
  // committing the same one twice would otherwise sail past this check and fail
  // later with something far less useful.
  const existing = await repo.findBySourceRevision(preview.source.identifier, preview.source.revision);
  if (existing && !options.replace) {
    throw new ImportError(
      `${preview.source.identifier} at ${preview.source.revision.slice(0, 12)} is already imported as ` +
        `${existing.benchmarkCode}. Import a different revision, or pass replace.`,
    );
  }

  if (typeof preview.token !== 'string' || !TOKEN.test(preview.token)) {
    throw new ImportError('That preview token is not one we issued. Run the preview again.');
  }

  const stagingDir = archive.stagingPath(config.paths.staging, preview.token);
  const format = formats.formatById(preview.detection.format);
  // A committed import moves its snapshot out of staging, so a stale preview
  // points at a directory that no longer exists. One task's worth of read is
  // enough to prove it is still there and still readable — re-detecting would
  // parse the whole benchmark a second time to learn what the preview knew.
  const staged = format ? await format.read(stagingDir, { limit: 1 }).catch(() => null) : null;
  if (!format || !staged?.length) {
    throw new ImportError(
      `The staged snapshot for ${preview.source.identifier} is gone. Run the preview again before importing.`,
    );
  }
  if (existing) await repo.deleteBenchmark(existing.benchmarkId);

  const plan: ImportPlan = { ...preview.plan, ...overrides };
  const benchmarkId = await repo.insertBenchmark({
    ...preview.source,
    ...plan,
    detectedFormat: preview.detection.format,
    snapshotPath: stagingDir,
  });
  const benchmarkCode = code('benchmarks', benchmarkId);

  const trace = await jobs.start('benchmark_import', 'benchmarks', benchmarkId, {
    step: 'reading staged snapshot',
    params: { source: preview.source, plan },
    echo: options.echo,
  });

  try {
    await trace.log(`source                ${preview.source.identifier} @ ${preview.source.revision}`);
    await trace.log(`format                ${preview.detection.label} (${preview.detection.format})`);
    await trace.log(`staged snapshot       ${stagingDir}`);
    await trace.log(`benchmarks            +1  ${benchmarkCode} "${plan.name}"`);

    const parsed = await format.read(stagingDir);
    const expectedCriteria = parsed.reduce((sum, task) => sum + task.criteria.length, 0);
    await trace.log(`planned               ${parsed.length} tasks, ${expectedCriteria} criteria`);

    let written = 0;
    let criteria = 0;
    for (let start = 0; start < parsed.length; start += PAGE) {
      const page = parsed.slice(start, start + PAGE).map((task) => ({ ...task, dataset: repo.DATASET }));
      criteria += await repo.insertTasks(benchmarkId, page);
      written += page.length;
      await trace.step(`writing tasks ${written}/${parsed.length}`, written / Math.max(parsed.length, 1));
      await trace.log(
        `benchmark_tasks       +${page.length} (${written}/${parsed.length})  benchmark_task_criteria +${criteria} total`,
      );
    }

    // Count from the database, not from what we believe we sent.
    const tally: ImportTally = {
      benchmarkId,
      benchmarkCode,
      benchmarks: 1,
      benchmarkTasks: await repo.countTasks(benchmarkId),
      benchmarkTaskCriteria: await repo.countCriteria(benchmarkId),
      jobCode: trace.jobCode,
    };
    if (tally.benchmarkTasks !== parsed.length || tally.benchmarkTaskCriteria !== expectedCriteria) {
      throw new ImportError(
        `Import wrote ${tally.benchmarkTasks}/${parsed.length} tasks and ` +
          `${tally.benchmarkTaskCriteria}/${expectedCriteria} criteria.`,
      );
    }

    const kept = resolvePath(config.paths.benchmarks, benchmarkCode);
    await mkdir(config.paths.benchmarks, { recursive: true });
    await rm(kept, { recursive: true, force: true });
    await rename(stagingDir, kept);
    await repo.markReady(benchmarkId, kept);
    await trace.log(`snapshot kept at      ${kept}`);
    await trace.log(`benchmarks            ~1  status ready, runnable 0 (no gym adapter yet)`);

    // A Harbor import and the gym's prepared copy must not drift apart, so the
    // import re-pins the gym to this revision. The catalog rows above are
    // already committed and correct; a sync failure is reported, never fatal.
    if (preview.detection.format === 'harbor') {
      try {
        await trace.step('syncing the gym pin to this revision', 0.95);
        tally.gymSync = await syncPin(trace, {
          sourceUrl: preview.source.url,
          sourceIdentifier: preview.source.identifier,
          revision: preview.source.revision,
          snapshotPath: kept,
          taskCount: tally.benchmarkTasks,
        });
      } catch (error) {
        await trace.log(`gym sync failed       ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    await trace.succeed(tally);
    await audit('benchmarks', benchmarkId, 'import', { source: preview.source, ...tally });
    return tally;
  } catch (error) {
    await repo.markFailed(benchmarkId);
    await trace.fail(error);
    throw error;
  }
}

/** Preview and commit in one call, for scripts and tests. */
export async function importFromUrl(
  url: string,
  ref = '',
  options: { replace?: boolean; echo?: boolean } = {},
): Promise<ImportTally> {
  return commit(await preview(url, ref), {}, options);
}

/**
 * Point the gym's prepared copy of this benchmark at the catalog's revision.
 *
 * The heavy lifting lives in `gym/sync.ts`; this wrapper runs it as its own
 * `benchmark_import` job so the log and step readouts carry the whole operation.
 */
export async function syncGym(
  benchmarkId: number,
  options: { echo?: boolean } = {},
): Promise<GymSyncSummary> {
  const catalog = await repo.get(benchmarkId);
  if (!catalog) throw new ImportError(`Unknown benchmark ${benchmarkId}.`);
  if (catalog.status !== 'ready') throw new ImportError(`${catalog.benchmarkCode} is ${catalog.status}, not ready.`);
  if (catalog.detectedFormat !== 'harbor') {
    throw new ImportError(
      `${catalog.benchmarkCode} is ${catalog.detectedFormat || 'an unknown'} format; only Harbor benchmarks have a gym pin to sync.`,
    );
  }

  const trace = await jobs.start('benchmark_import', 'benchmarks', benchmarkId, {
    step: 'syncing the gym pin to this catalog',
    params: { sync: { identifier: catalog.sourceIdentifier, revision: catalog.revision } },
    echo: options.echo,
  });
  try {
    const summary = await syncPin(trace, {
      sourceUrl: catalog.sourceUrl,
      sourceIdentifier: catalog.sourceIdentifier,
      revision: catalog.revision,
      snapshotPath: catalog.snapshotPath,
      taskCount: await repo.countTasks(benchmarkId),
    });
    await trace.succeed(summary);
    return summary;
  } catch (error) {
    await trace.fail(error);
    throw error;
  }
}

/**
 * Attach the running gym resources server to a catalog so it can be executed.
 *
 * The adapter is the process name from `/server_instances`, not a format
 * default. Harbor is the eval profile we have; a stored adapter wins when that
 * process is healthy, otherwise the unique healthy resources server is used.
 * Health is re-checked at run time.
 */
export async function bindAdapter(benchmarkId: number): Promise<string> {
  const catalog = await repo.get(benchmarkId);
  if (!catalog) throw new ImportError(`Unknown benchmark ${benchmarkId}.`);
  if (catalog.status !== 'ready') throw new ImportError(`${catalog.benchmarkCode} is ${catalog.status}, not ready.`);
  if (catalog.detectedFormat !== 'harbor') {
    throw new ImportError(
      `${catalog.benchmarkCode} is ${catalog.detectedFormat || 'an unknown'} format; ` +
        'gym eval is wired for Harbor resources servers.',
    );
  }

  const health = await head.health();
  if (!health.reachable) {
    throw new ImportError(`NeMo Gym is not running (${health.headUrl}). Start it with gym env start.`);
  }
  try {
    const resources = servers.pickResources(health, catalog.adapter);
    servers.pickAgent(health, resources);
    servers.pickModelType(health);
    await repo.setAdapter(benchmarkId, resources.processName, true);
    return resources.processName;
  } catch (cause) {
    throw new ImportError(cause instanceof Error ? cause.message : String(cause));
  }
}
