#!/usr/bin/env bun
/**
 * Assert the pipeline chain is wired, link by link.
 *
 *   bun scripts/check-chain.ts
 *
 * The research pipeline is only trustworthy if every stage can be traced back
 * to the benchmark criterion that produced it. That traceability is nothing
 * more than a path of foreign keys — so this script reads the live database's
 * FK graph and fails if any link in the chain is missing or points somewhere
 * new. It is a schema check: it passes on an empty database.
 */
import { all, value } from '../src/db/client.ts';

/** Each link is `child --(column)--> parent`, in pipeline order. */
const CHAIN: { from: string; column: string; to: string; why: string }[] = [
  { from: 'benchmark_tasks', column: 'benchmark_id', to: 'benchmarks', why: 'a task belongs to a benchmark' },
  { from: 'benchmark_task_criteria', column: 'task_id', to: 'benchmark_tasks', why: 'criteria belong to a task definition' },
  { from: 'benchmark_runs', column: 'benchmark_id', to: 'benchmarks', why: 'a run executes one benchmark' },
  { from: 'benchmark_run_tasks', column: 'benchmark_run_id', to: 'benchmark_runs', why: 'a run selects the tasks it will execute' },
  { from: 'benchmark_run_tasks', column: 'task_id', to: 'benchmark_tasks', why: 'that selection points at catalog tasks' },
  { from: 'benchmark_results', column: 'benchmark_run_id', to: 'benchmark_runs', why: 'one aggregate result per run' },
  { from: 'task_results', column: 'benchmark_result_id', to: 'benchmark_results', why: 'task results roll up into the benchmark result' },
  { from: 'task_results', column: 'task_id', to: 'benchmark_tasks', why: 'a task result names the task it ran' },
  { from: 'criterion_results', column: 'task_result_id', to: 'task_results', why: 'criterion results belong to one task result' },
  { from: 'criterion_results', column: 'benchmark_task_criterion_id', to: 'benchmark_task_criteria', why: 'each criterion result judges one static criterion' },
  { from: 'criterion_results', column: 'task_id', to: 'task_results', why: 'the criterion result and its task result must agree on the task' },
  { from: 'criterion_results', column: 'task_id', to: 'benchmark_task_criteria', why: 'the criterion result and its criterion must agree on the task' },
  { from: 'failure_maps', column: 'benchmark_result_id', to: 'benchmark_results', why: 'a failure map analyses one result' },
  { from: 'topics', column: 'failure_map_id', to: 'failure_maps', why: 'topics are scoped to their failure map' },
  { from: 'failure_items', column: 'failure_map_id', to: 'failure_maps', why: 'items belong to their failure map' },
  { from: 'failure_items', column: 'criterion_result_id', to: 'criterion_results', why: 'every item is one failed criterion result' },
  { from: 'failure_items', column: 'topic_id', to: 'topics', why: 'items are grouped under a topic' },
  { from: 'data_forge_runs', column: 'failure_map_id', to: 'failure_maps', why: 'a forge run addresses one failure map' },
  { from: 'documents', column: 'failure_item_id', to: 'failure_items', why: 'a document targets one failure item' },
];

type FkRow = { table: string; from: string; to: string };

const edges = new Set<string>();
for (const { table } of await all<{ table: string }>(
  `SELECT name AS "table" FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
)) {
  for (const fk of await all<FkRow>(`PRAGMA foreign_key_list("${table}")`)) {
    edges.add(`${table}.${fk.from}->${fk.table}`);
  }
}

let failed = 0;
console.log(`${'link'.padEnd(64)}  status`);
console.log('-'.repeat(76));
for (const link of CHAIN) {
  const label = `${link.from}.${link.column} -> ${link.to}`;
  const present = edges.has(`${link.from}.${link.column}->${link.to}`);
  if (!present) failed += 1;
  console.log(`${label.padEnd(64)}  ${present ? 'ok' : 'MISSING'}`);
  if (!present) console.log(`${' '.repeat(66)}${link.why}`);
}

const orphans = await value<number>(`SELECT COUNT(*) FROM pragma_foreign_key_check`);
if (orphans) {
  failed += 1;
  console.log(`\n${orphans} row(s) violate a foreign key — run PRAGMA foreign_key_check for detail.`);
}

if (failed) {
  console.log(`\n✗ ${failed} broken link(s) in the pipeline chain`);
  process.exit(1);
}
console.log(`\n✓ all ${CHAIN.length} links present, no orphaned rows`);
