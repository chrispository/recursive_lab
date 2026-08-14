import type { BenchmarkCatalog, BenchmarkTask, ImportTally } from '../../../domain/benchmarks/model.ts';
import { Badge } from '../../ui/Badge.tsx';

export function TaskRow({ task }: { task: BenchmarkTask }) {
  return (
    <label class="m-task-row" data-task-row data-task-id={task.taskId.toLowerCase()}>
      <input type="checkbox" name="task_id" value={task.taskId} data-task-checkbox />
      <span>{task.name}</span>
    </label>
  );
}

export function catalogNote(catalog: BenchmarkCatalog | null) {
  if (!catalog) return 'No benchmark catalog is available.';
  return catalog.runnable
    ? `${catalog.name} · ${catalog.lab} · Runnable through the configured adapter.`
    : `${catalog.name} · ${catalog.lab} · Catalog imported; adapter configuration required.`;
}

export function CatalogSelect({
  catalogs,
  selectedId,
  oob,
}: {
  catalogs: BenchmarkCatalog[];
  selectedId: number | null;
  oob?: boolean;
}) {
  return (
    <select id="benchmark-select" name="benchmark_id" aria-label="Benchmark" hx-swap-oob={oob ? 'true' : undefined}>
      {catalogs.map((item) => (
        <option value={String(item.benchmarkId)} selected={item.benchmarkId === selectedId}>
          {item.name} · {item.taskCount.toLocaleString()} tasks
        </option>
      ))}
    </select>
  );
}

export function CatalogNote({ catalog, oob }: { catalog: BenchmarkCatalog | null; oob?: boolean }) {
  return (
    <div id="benchmarks-catalog-note" class="m-config-note" hx-swap-oob={oob ? 'true' : undefined}>
      {catalogNote(catalog)}
    </div>
  );
}

export function TaskCount({ catalog, oob }: { catalog: BenchmarkCatalog | null; oob?: boolean }) {
  const shown = catalog?.tasks.length ?? 0;
  const total = catalog?.taskCount ?? 0;
  return (
    <span
      id="task-count"
      class="m-code"
      data-task-total={String(total)}
      hx-swap-oob={oob ? 'true' : undefined}
    >
      0 selected / {shown.toLocaleString()} shown / {total.toLocaleString()} total
    </span>
  );
}

export function TaskPicker({ catalog, oob }: { catalog: BenchmarkCatalog | null; oob?: boolean }) {
  const tasks = catalog?.tasks ?? [];
  return (
    <div
      id="task-picker"
      class="m-task-picker"
      aria-label="Benchmark task selection"
      hx-swap-oob={oob ? 'true' : undefined}
    >
      {tasks.map((task) => <TaskRow task={task} />)}
    </div>
  );
}

export function CatalogStatus({ catalog, oob }: { catalog: BenchmarkCatalog | null; oob?: boolean }) {
  return (
    <div id="benchmarks-catalog-status" hx-swap-oob={oob ? 'true' : undefined}>
      <span>Benchmark catalog</span>
      <Badge state={catalog?.status ?? 'pending'}>{catalog?.status ?? 'missing'}</Badge>
    </div>
  );
}

export function RunnableStatus({ catalog, oob }: { catalog: BenchmarkCatalog | null; oob?: boolean }) {
  return (
    <div id="benchmarks-runnable-status" hx-swap-oob={oob ? 'true' : undefined}>
      <span>Runnable</span>
      <Badge state={catalog?.runnable ? 'ready' : 'pending'}>{catalog?.runnable ? 'yes' : 'no'}</Badge>
    </div>
  );
}

/**
 * The import region. POST /ui/benchmarks/import swaps this root and, on
 * success, rides the catalog select / task picker / preflight along as OOB.
 */
export function ImportForm({
  url = '',
  error,
  tally,
}: {
  url?: string;
  error?: string;
  tally?: ImportTally;
}) {
  const note = tally
    ? `Imported ${tally.benchmarkCode}: ${tally.benchmarkTasks.toLocaleString()} tasks, ${tally.benchmarkTaskCriteria.toLocaleString()} criteria.`
    : undefined;
  const status = error ? 'error' : note ? 'ok' : undefined;

  return (
    <details
      id="benchmarks-import"
      class="m-import full"
      open={Boolean(error || note) || undefined}
      hx-get="/ui/benchmarks/import"
      hx-trigger="none"
      hx-swap="outerHTML"
    >
      <summary>Import from GitHub or Hugging Face</summary>
      <form
        class="m-import-body"
        hx-post="/ui/benchmarks/import"
        hx-target="#benchmarks-import"
        hx-swap="outerHTML"
        hx-disabled-elt="find button"
      >
        <p>
          Imports are pinned and inspected from github.com or huggingface.co. Unsupported sources
          are rejected; execution still needs a compatible adapter.
        </p>
        <div class="m-import-controls">
          <input
            name="url"
            value={url}
            required
            placeholder="https://github.com/org/benchmark or https://huggingface.co/datasets/org/name"
            aria-label="Benchmark source URL"
          />
          <button class="secondary compact" type="submit">Import benchmark</button>
        </div>
        {status ? (
          <div class="m-config-note" data-status={status}>{error ?? note}</div>
        ) : (
          <div class="m-config-note">Ready for a benchmark source.</div>
        )}
        <div class="m-import-progress htmx-indicator" role="status" aria-live="polite">
          <div class="m-import-progress-label">Resolving, downloading, and inspecting…</div>
          <div class="m-import-progress-track" role="progressbar" aria-label="Import in progress">
            <span class="m-import-progress-fill" aria-hidden="true" />
          </div>
        </div>
      </form>
    </details>
  );
}

/**
 * Catalog widgets that changed because an import landed.
 *
 * `catalogs` is headers only; `catalog` is the selected one, already loaded
 * with its tasks. Keeping them separate is what stops the picker rendering
 * every benchmark's task list at once.
 */
export function ImportOob({
  catalogs,
  catalog,
}: {
  catalogs: BenchmarkCatalog[];
  catalog: BenchmarkCatalog | null;
}) {
  return (
    <>
      <CatalogSelect catalogs={catalogs} selectedId={catalog?.benchmarkId ?? null} oob />
      <CatalogNote catalog={catalog} oob />
      <TaskCount catalog={catalog} oob />
      <TaskPicker catalog={catalog} oob />
      <CatalogStatus catalog={catalog} oob />
      <RunnableStatus catalog={catalog} oob />
    </>
  );
}
