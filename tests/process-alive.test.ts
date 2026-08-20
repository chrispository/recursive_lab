/**
 * The pid liveness probe that boot and shutdown both rely on.
 *
 * `kill(pid, 0)` must distinguish "exists" from "gone" without signalling, and
 * must treat a reaped child as gone.
 */
import { expect, test } from 'bun:test';
import { isProcessAlive } from '../src/gym/lifecycle.ts';

test('sees the current process as alive', () => {
  expect(isProcessAlive(process.pid)).toBe(true);
});

test('sees an exited child as gone', async () => {
  const child = Bun.spawn(['true']);
  await child.exited;
  expect(isProcessAlive(child.pid)).toBe(false);
});
