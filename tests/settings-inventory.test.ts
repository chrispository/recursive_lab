/**
 * The inventory is an explanation, so its failure mode is being confidently
 * wrong rather than throwing. These check the two claims a reader would act on:
 * that a count reflects the real table, and that absence is reported as absence
 * rather than as a resolution failure.
 */
import { describe, expect, it } from 'bun:test';
import { report } from '../src/domain/inventory/service.ts';
import type { AlignmentReport } from '../src/domain/benchmarks/model.ts';
import type { BucketUsage } from '../src/gym/storage.ts';
import { value } from '../src/db/client.ts';

const alignment: AlignmentReport = {
  gym: { resolved: true, reason: '', repository: 'https://github.com/o/r', revision: 'abc123', taskCount: 9, runnableTaskIds: [] },
  catalogs: [
    {
      benchmarkCode: 'BMS-00001',
      name: 'Test set',
      sourceIdentifier: 'o/r',
      catalogRevision: 'def456',
      gymRevision: 'abc123',
      sameSource: true,
      aligned: false,
      taskCount: 10,
      runnableCount: 9,
      missingCount: 1,
      missingFamilies: ['alpha'],
    },
  ],
};

const bucket = (id: string, over: Partial<BucketUsage> = {}): BucketUsage => ({
  id,
  label: id,
  path: `/tmp/${id}`,
  owner: 'gym',
  note: '',
  resolved: true,
  bytes: 0,
  entries: [],
  ...over,
});

const buckets = ['snapshots', 'run-artifacts', 'harbor-jobs', 'prepared-assets'].map((id) => bucket(id));

const find = (rows: Awaited<ReturnType<typeof report>>, id: string) => rows.find((row) => row.id === id)!;

describe('inventory report', () => {
  it('states the runnable gap in the amount, not just the badge', async () => {
    const rows = await report(buckets, alignment);
    const runnable = find(rows, 'runnable');
    expect(runnable.state).toBe('partial');
    expect(runnable.amount).toContain('9 of your 10');
    expect(runnable.amount).toContain('1 cannot run');
  });

  it('counts imports from the database rather than from the alignment report', async () => {
    const rows = await report(buckets, alignment);
    const tasks = await value<number>('SELECT COUNT(*) FROM benchmark_tasks');
    const imports = find(rows, 'benchmarks');
    if (tasks) expect(imports.amount).toContain(tasks.toLocaleString('en-US'));
    else expect(imports.amount).toBe('none yet');
  });

  it('never claims a checkpoint, and says why rather than what is missing', async () => {
    const rows = await report(buckets, alignment);
    const checkpoints = find(rows, 'checkpoints');
    expect(checkpoints.state).toBe('none');
    expect(checkpoints.contains).toBe('');
    expect(checkpoints.missing).toContain('NeMo-RL');
  });

  it('reports an unresolved gym directory as unreadable, not as empty', async () => {
    const unresolved = buckets.map((row) => (row.id === 'harbor-jobs' ? bucket('harbor-jobs', { resolved: false, path: '' }) : row));
    const rows = await report(unresolved, alignment);
    expect(find(rows, 'transcripts').amount).toContain('not readable');
  });

  it('gives every row a "does not contain" line', async () => {
    const rows = await report(buckets, alignment);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.missing.length).toBeGreaterThan(20);
  });
});
