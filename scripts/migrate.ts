#!/usr/bin/env bun
/** `bun run db:migrate` — apply any pending migrations and report what ran. */
import { migrate } from '../src/db/migrate.ts';

const { applied } = await migrate();

if (applied.length === 0) console.log('✓ schema up to date');
else for (const file of applied) console.log(`✓ applied ${file}`);

process.exit(0);
