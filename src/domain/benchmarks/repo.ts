import { all, type Row } from '../../db/client.ts';
import { code } from '../../db/ids.ts';
import type { BenchmarkCatalog, BenchmarkTask } from './model.ts';

type CatalogDbRow = Row & {
  benchmark_id: number;
  benchmark_name: string;
  lab: string;
  source_url: string;
  source_kind: BenchmarkCatalog['sourceKind'];
  source_identifier: string;
  revision: string;
  detected_format: string;
  adapter: string;
  status: BenchmarkCatalog['status'];
  runnable: number;
  description: string;
  dataset: string | null;
  task_id: string | null;
  task_name: string | null;
  source_path: string | null;
  position: number | null;
};

export async function listCatalogs(): Promise<BenchmarkCatalog[]> {
  const rows = await all<CatalogDbRow>(`
    SELECT b.id AS benchmark_id, b.name AS benchmark_name, b.lab, b.source_url,
           b.source_kind, b.source_identifier, b.revision, b.detected_format,
           b.adapter, b.status, b.runnable, b.description,
           t.dataset, t.task_id, t.name AS task_name, t.source_path, t.position
      FROM benchmarks b
      LEFT JOIN benchmark_tasks t ON t.benchmark_id = b.id
     ORDER BY b.created_at ASC, b.id ASC, t.dataset ASC, t.position ASC, t.task_id ASC
  `);

  const catalogs = new Map<number, BenchmarkCatalog>();
  for (const row of rows) {
    let catalog = catalogs.get(row.benchmark_id);
    if (!catalog) {
      catalog = {
        benchmarkId: row.benchmark_id,
        benchmarkCode: code('benchmarks', row.benchmark_id),
        name: row.benchmark_name,
        lab: row.lab,
        sourceUrl: row.source_url,
        sourceKind: row.source_kind,
        sourceIdentifier: row.source_identifier,
        revision: row.revision,
        detectedFormat: row.detected_format,
        adapter: row.adapter,
        status: row.status,
        runnable: row.runnable === 1,
        description: row.description,
        tasks: [],
      };
      catalogs.set(row.benchmark_id, catalog);
    }

    if (row.dataset && row.task_id && row.task_name) {
      catalog.tasks.push({
        dataset: row.dataset,
        taskId: row.task_id,
        name: row.task_name,
        sourcePath: row.source_path ?? '',
        position: row.position ?? 0,
      });
    }
  }
  return [...catalogs.values()];
}
