/**
 * Migration runner.
 *
 * Applies every `NNNN_*.sql` in `migrations/` that hasn't run yet, in filename
 * order, each inside a transaction. Migrations are append-only — never edit a
 * file that has already been applied.
 */
import { Glob } from 'bun';
import { basename } from 'node:path';
import { db, now } from './client.ts';

const DIR = new URL('./migrations/', import.meta.url).pathname;

async function appliedVersions(): Promise<Set<number>> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )`);
  const result = await db.execute('SELECT version FROM schema_migrations');
  return new Set(result.rows.map((row) => Number(row.version)));
}

/** `0003_add_thing.sql` → 3. Files that don't match are a hard error. */
function versionOf(file: string): number {
  const match = /^(\d+)_/.exec(basename(file));
  if (!match?.[1]) throw new Error(`Migration filename must start with digits: ${file}`);
  return Number(match[1]);
}

export async function migrate(): Promise<{ applied: string[] }> {
  const done = await appliedVersions();
  const files = [...new Glob('*.sql').scanSync(DIR)].sort();
  const applied: string[] = [];

  for (const file of files) {
    const version = versionOf(file);
    if (done.has(version)) continue;

    const sql = await Bun.file(DIR + file).text();

    // executeMultiple runs the file through SQLite's own script parser, so
    // comments and multi-statement DDL work as written. The explicit
    // transaction means a statement failing halfway leaves the schema
    // untouched rather than half-migrated.
    await db.executeMultiple(
      [
        'BEGIN',
        sql,
        `INSERT INTO schema_migrations (version, name, applied_at)
           VALUES (${version}, '${file}', '${now()}')`,
        'COMMIT',
      ].join(';\n'),
    );
    applied.push(file);
  }

  return { applied };
}
