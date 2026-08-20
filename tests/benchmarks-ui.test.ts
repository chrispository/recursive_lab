import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { benchmarksUi } from '../src/http/ui/benchmarks.tsx';
import { db } from '../src/db/client.ts';
/**
 * Seeds its own catalog row rather than assuming whatever the live database
 * happens to hold — the handler must render any benchmark it is asked for.
 */
const NAME = 'ui-test-catalog';
let benchmarkId = 0;

beforeAll(async () => {
  const now = new Date().toISOString();
  const result = await db.execute(
    `INSERT INTO benchmarks (name, lab, source_url, source_kind, source_identifier, revision,
       detected_format, adapter, status, runnable, description, created_at, updated_at)
     VALUES (?, 'ui', 'https://github.com/ui/test', 'github', 'ui/test', '${'a'.repeat(40)}',
       'harbor', '', 'ready', 0, '', ?, ?)`,
    [NAME, now, now],
  );
  benchmarkId = Number(result.lastInsertRowid);
  await db.execute(
    `INSERT INTO benchmark_tasks (benchmark_id, dataset, task_id, name, position)
     VALUES (?, 'validation', 'ui-test-family__tasks__001', 'UI test task', 0)`,
    [benchmarkId],
  );
});

afterAll(async () => {
  if (benchmarkId) await db.execute(`DELETE FROM benchmarks WHERE id = ?`, [benchmarkId]);
});

describe('benchmarksUi /ui/benchmarks/tasks', () => {
  it('loads tasks and oob elements for the seeded catalog', async () => {
    const res = await benchmarksUi.handle(
      new Request(`http://localhost/ui/benchmarks/tasks?benchmark_id=${benchmarkId}`),
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="benchmarks-tasks"');
    expect(html).toContain('id="benchmark-select"');
    expect(html).toContain('id="task-count"');
    expect(html).toContain('data-task-total="1"');
    expect(html).toContain('ui-test-family__tasks__001');
  });
});
