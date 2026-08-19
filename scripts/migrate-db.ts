#!/usr/bin/env bun
/** Apply safe, append-only-compatible migrations to the configured database. */
import { all, db, value } from '../src/db/client.ts';

type Column = { name: string };

const columns = await all<Column>('PRAGMA table_info(benchmark_sources)');
if (!columns.length) {
  console.log('✓ benchmark_sources does not exist; run db:setup for a new database');
  process.exit(0);
}

if (columns.some((column) => column.name === 'benchmark_id')) {
  console.log('✓ benchmark_sources already has benchmark_id');
  process.exit(0);
}

const count = await value<number>('SELECT COUNT(*) FROM benchmark_sources');
if (count !== 0) {
  throw new Error(
    `Refusing to rebuild benchmark_sources because it contains ${count} rows. ` +
    'Reconcile those source rows before applying this migration.',
  );
}

await db.execute('BEGIN');
try {
  await db.execute(`
    CREATE TABLE benchmark_sources_new (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      benchmark_id      INTEGER NOT NULL REFERENCES benchmarks(id) ON DELETE CASCADE,
      task_id           TEXT    NOT NULL,
      relative_path     TEXT    NOT NULL,
      content_sha256    TEXT    NOT NULL,
      normalized_sha256 TEXT    NOT NULL,
      word_count        INTEGER NOT NULL CHECK (word_count >= 0),
      shingles_json     TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(shingles_json)),
      created_at        TEXT    NOT NULL,
      UNIQUE (benchmark_id, task_id, relative_path)
    )
  `);
  await db.execute('DROP TABLE benchmark_sources');
  await db.execute('ALTER TABLE benchmark_sources_new RENAME TO benchmark_sources');
  await db.execute('CREATE INDEX idx_sources_benchmark_task ON benchmark_sources(benchmark_id, task_id)');
  await db.execute('COMMIT');
} catch (error) {
  await db.execute('ROLLBACK').catch(() => undefined);
  throw error;
}

console.log('✓ benchmark_sources migrated; existing source rows were not repopulated');
