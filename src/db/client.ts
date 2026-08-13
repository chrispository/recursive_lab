/**
 * The libSQL connection and the four query helpers every repo uses.
 *
 * Repos write SQL directly — there is no ORM and no query builder. These
 * helpers exist only to turn libSQL's `ResultSet` into plain typed rows and to
 * make the common shapes (one row, many rows, an insert) read as one line.
 */
import { createClient, type Client, type InArgs, type InValue } from '@libsql/client';
import { config } from '../config.ts';

export const db: Client = createClient({
  url: config.db.url,
  ...(config.db.syncUrl ? { syncUrl: config.db.syncUrl } : {}),
  ...(config.db.authToken ? { authToken: config.db.authToken } : {}),
});

/** SQLite enforces foreign keys only when asked, and it is asked per connection. */
await db.execute('PRAGMA foreign_keys = ON');

/** Every row we read back is a flat record of SQLite's scalar types. */
export type Row = Record<string, InValue>;

/** All matching rows, cast to the caller's row type. */
export async function all<T extends Row>(sql: string, args: InArgs = []): Promise<T[]> {
  const result = await db.execute({ sql, args });
  return result.rows as unknown as T[];
}

/** The first matching row, or null. Use for lookups by primary key. */
export async function one<T extends Row>(sql: string, args: InArgs = []): Promise<T | null> {
  const rows = await all<T>(sql, args);
  return rows[0] ?? null;
}

/** A single scalar — counts, sums, existence checks. */
export async function value<T extends InValue>(sql: string, args: InArgs = []): Promise<T | null> {
  const row = await one(sql, args);
  if (!row) return null;
  return (Object.values(row)[0] ?? null) as T | null;
}

/** Runs an INSERT and returns the new integer primary key. */
export async function insert(sql: string, args: InArgs = []): Promise<number> {
  const result = await db.execute({ sql, args });
  if (result.lastInsertRowid === undefined) {
    throw new Error(`insert() used on a statement that produced no rowid: ${sql.slice(0, 80)}`);
  }
  return Number(result.lastInsertRowid);
}

/** Runs a statement for its effect. Returns rows affected. */
export async function run(sql: string, args: InArgs = []): Promise<number> {
  const result = await db.execute({ sql, args });
  return result.rowsAffected;
}

/** ISO-8601 UTC — the only timestamp format stored anywhere. See AGENTS.md. */
export const now = (): string => new Date().toISOString();

/** Parse a `*_json` column. Repos should map these at their boundary, not leak them. */
export const json = <T>(raw: InValue, fallback: T): T => {
  if (typeof raw !== 'string' || raw === '') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};
