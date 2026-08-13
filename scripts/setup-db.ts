#!/usr/bin/env bun
/** Create a clean database from the canonical schema. */
import { db } from '../src/db/client.ts';

const schema = await Bun.file(new URL('../src/db/schema.sql', import.meta.url)).text();
await db.executeMultiple(schema);
console.log('✓ database schema created');
