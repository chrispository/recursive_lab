import { describe, expect, it } from 'bun:test';
import { benchmarksUi } from '../src/http/ui/benchmarks.tsx';

describe('benchmarksUi /ui/benchmarks/tasks', () => {
  it('loads tasks and oob elements for benchmark 1', async () => {
    const res = await benchmarksUi.handle(new Request('http://localhost/ui/benchmarks/tasks?benchmark_id=1'));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="benchmarks-tasks"');
    expect(html).toContain('id="benchmark-select"');
    expect(html).toContain('id="task-count"');
    expect(html).toContain('data-task-total="2010"');
    expect(html).toContain('firm-knowledge__tasks__012');
  });
});
