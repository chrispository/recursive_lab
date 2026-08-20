/**
 * Re-point the gym's prepared benchmark copy at a catalog revision.
 *
 * The gym downloads a benchmark at a pin hard-coded in its own `prepare.py`,
 * so an import at a newer commit leaves the gym unable to run the new tasks.
 * This rewrites the pin to the imported revision, drops the prepared caches,
 * and — if the gym was up — restarts it so the rebuild begins immediately. The
 * rebuild itself is gym work: its first start after a re-pin re-downloads the
 * source and re-hydrates every task, which takes minutes and is visible in the
 * environment panel and the gym log, not in the caller's job.
 */
import { resolve as resolvePath } from 'node:path';
import type { GymSyncSummary } from '../domain/benchmarks/model.ts';
import type { Trace } from '../domain/jobs/trace.ts';
import * as archive from '../lib/archive.ts';
import * as source from '../lib/source.ts';
import * as head from './head.ts';
import * as lifecycle from './lifecycle.ts';
import * as pins from './pins.ts';
import * as repin from './repin.ts';
import * as servers from './servers.ts';

export async function syncPin(
  trace: Trace,
  input: { sourceUrl: string; sourceIdentifier: string; revision: string; snapshotPath: string | null; taskCount: number },
): Promise<GymSyncSummary> {
  const pin = await pins.resolvePin();
  const repository =
    pin.repository && pin.repository.endsWith(input.sourceIdentifier)
      ? pin.repository
      : `https://github.com/${input.sourceIdentifier}`;

  await trace.step('locating the gym resources server', 0.05);
  await trace.log(`gym pin               ${pin.resolved ? `${pin.repository} @ ${pin.revision.slice(0, 10)} (${pin.taskCount} tasks)` : 'nothing prepared yet'}`);

  // The archive checksum the gym verifies against. It was captured while the
  // import streamed the archive; a snapshot from before that sidecar existed
  // costs one deliberate pass to hash.
  let archiveSha256 = '';
  const sidecar = input.snapshotPath ? resolvePath(input.snapshotPath, archive.SHA_SIDECAR) : null;
  if (sidecar) archiveSha256 = (await Bun.file(sidecar).text().catch(() => '')).trim();
  if (!/^[0-9a-f]{64}$/.test(archiveSha256)) {
    await trace.step('hashing the source archive', 0.15);
    const pinned = await source.resolveSource(input.sourceUrl, input.revision);
    let last = 0;
    archiveSha256 = await archive.hashOf(pinned.archiveUrl, (bytes) => {
      if (bytes - last >= 256 * 1024 * 1024) {
        last = bytes;
        void trace.log(`hashing               ${(bytes / 1024 / 1024).toFixed(0)} MiB`);
      }
    });
    await trace.log(`archive sha256        ${archiveSha256} (hashed from ${pinned.archiveUrl})`);
  } else {
    await trace.log(`archive sha256        ${archiveSha256} (captured at import)`);
  }
  // Remember a hash computed the slow way, so the next sync of this catalog
  // starts at the patch instead of another full download pass.
  if (sidecar && input.snapshotPath) {
    await Bun.write(sidecar, `${archiveSha256}\n`).catch(() => undefined);
  }

  await trace.step('re-pinning prepare.py', 0.45);
  const report = await repin.apply({ repository, revision: input.revision, archiveSha256, taskCount: input.taskCount });
  await trace.log(
    `gym pin               ${report.fromRevision.slice(0, 10)} (${report.fromTaskCount} tasks) → ${report.toRevision.slice(0, 10)} (${report.toTaskCount} tasks) in ${report.server}`,
  );

  await trace.step('clearing prepared caches', 0.55);
  const cleared = await repin.clearPrepared(report.server);
  for (const dir of cleared) await trace.log(`cleared               ${dir}`);

  let restarted = false;
  const health = await head.health();
  if (health.reachable) {
    await trace.step('restarting the gym at the new pin', 0.65);
    const modelType = servers.pickModelType(health);
    await lifecycle.stop();
    await lifecycle.start({ resourcesServer: report.server, modelType });
    restarted = true;
    await trace.log(`gym restarted         resources ${report.server}, model ${modelType} — re-preparing now`);
  } else {
    await trace.log('gym is down           it will download and prepare at the new pin on its next start');
  }
  return {
    server: report.server,
    revision: report.toRevision,
    taskCount: report.toTaskCount,
    restarted,
    note: restarted
      ? 'Gym restarting at the imported revision — first start re-downloads and re-prepares.'
      : 'Gym will prepare the imported revision on its next start.',
  };
}
