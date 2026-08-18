/**
 * Download a pinned source snapshot and unpack it, treating it as hostile.
 *
 * A benchmark source is a stranger's repository. We download it, read data
 * files out of it, and never execute anything from it. The two things that can
 * hurt us are size and paths, so both are checked here rather than trusted to a
 * library:
 *
 *   * **Paths** — an entry named `../../etc/whatever` must not escape staging.
 *   * **Size** — benchmark repositories are routinely hundreds of megabytes,
 *     mostly binary task documents. So the tar is parsed as it decompresses,
 *     never held whole, and `keep` decides what reaches the disk. A catalog
 *     import writes only the small definition files it can actually read.
 *
 * `tar.gz` is used for every host: GitHub and HuggingFace both serve it and Bun
 * decompresses gzip natively, so this file has no dependencies.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, normalize, resolve, sep } from 'node:path';

/** Ceiling on what we *write*, not on what we stream past. */
const MAX_WRITTEN_BYTES = 256 * 1024 * 1024;
/** Any single file larger than this is not benchmark data we can use. */
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const BLOCK = 512;

export class ArchiveError extends Error {}

export type StageOptions = {
  /** Return true to write this entry. Paths are relative, root folder stripped. */
  keep?: (path: string) => boolean;
  timeoutMs?: number;
};

export type StagedSnapshot = {
  /** Absolute path of the staged tree, with the archive's root folder stripped. */
  root: string;
  /** Entries seen in the archive. */
  scanned: number;
  /** Entries actually written. */
  files: number;
  /** Bytes actually written. */
  bytes: number;
  /** sha256 of the downloaded archive itself, compressed form. */
  archiveSha256: string;
};

/** Sidecar name holding `archiveSha256`, so a cached preview remembers it. */
export const SHA_SIDECAR = '.archive-sha256';

const decoder = new TextDecoder();
const field = (block: Uint8Array, start: number, length: number) =>
  decoder.decode(block.subarray(start, start + length)).replace(/\0.*$/, '').trim();

/**
 * Reject anything that would write outside `base`.
 *
 * Covers absolute paths, `..` traversal, and backslash separators. The check is
 * on the *resolved* path, and the trailing separator matters — a plain prefix
 * test would accept a sibling directory called `<base>-evil`.
 */
function safeJoin(base: string, entryName: string): string {
  const cleaned = entryName.replaceAll('\\', '/').replace(/^\/+/, '');
  const target = resolve(base, normalize(cleaned));
  if (target !== base && !target.startsWith(base + sep)) {
    throw new ArchiveError(`Archive entry '${entryName}' escapes the staging directory.`);
  }
  return target;
}

/** Regular-file type flags. Directories, symlinks and metadata are skipped. */
const isFile = (type: string) => type === '0' || type === '' || type === '\0';

/**
 * A pax extended header (`type=x`) carries the real path of the entry that
 * follows it. Git emits one for any path longer than tar's 100-byte name field,
 * so a parser that ignores them silently loses exactly the deepest-nested
 * files, and loses them without any error.
 *
 * Records are `<length> <key>=<value>\n`, concatenated.
 */
function paxPath(body: Uint8Array): string | null {
  const match = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(decoder.decode(body));
  return match?.[1] ?? null;
}

/**
 * Fetch the snapshot and unpack the entries `keep` selects into `destination`,
 * which is replaced. Everything else is streamed past without being stored.
 */
export async function stage(
  archiveUrl: string,
  destination: string,
  options: StageOptions = {},
): Promise<StagedSnapshot> {
  const keep = options.keep ?? (() => true);
  const response = await fetch(archiveUrl, {
    signal: AbortSignal.timeout(options.timeoutMs ?? 600_000),
    headers: { accept: 'application/gzip, application/x-gzip, application/octet-stream' },
  });
  if (!response.ok) throw new ArchiveError(`Downloading the snapshot failed: HTTP ${response.status}.`);
  if (!response.body) throw new ArchiveError('The snapshot response had no body.');

  const base = resolve(destination);
  await rm(base, { recursive: true, force: true });
  await mkdir(base, { recursive: true });

  const snapshot: StagedSnapshot = { root: base, scanned: 0, files: 0, bytes: 0, archiveSha256: '' };
  const hasher = new Bun.CryptoHasher('sha256');
  /**
   * Both hosts wrap everything in one folder named for the repo and revision.
   * Stripping it keeps stored paths stable across revisions — otherwise every
   * task's `source_path` would change on re-import. Learned from entry one, so
   * this stays a single pass.
   */
  let strip: string | null = null;
  let buffer = new Uint8Array(0);
  /** Bytes of a rejected entry still to be discarded from the incoming stream. */
  let discarding = 0;
  /** Path from a pax header, owed to the next entry. */
  let paxOverride: string | null = null;
  let done = false;

  const stream = (response.body as unknown as ReadableStream<Uint8Array>)
    .pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          hasher.update(chunk);
          controller.enqueue(chunk);
        },
      }),
    )
    .pipeThrough(new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>);
  for await (const rawChunk of stream as unknown as AsyncIterable<Uint8Array>) {
    if (done) break;
    let chunk = rawChunk;

    // Drop the tail of a skipped body before it ever reaches the buffer.
    if (discarding > 0) {
      const drop = Math.min(discarding, chunk.length);
      discarding -= drop;
      chunk = chunk.subarray(drop);
      if (chunk.length === 0) continue;
    }

    const merged = new Uint8Array(buffer.length + chunk.length);
    merged.set(buffer);
    merged.set(chunk, buffer.length);
    buffer = merged;

    while (buffer.length >= BLOCK) {
      const name = field(buffer, 0, 100);
      if (!name) { done = true; break; } // two zero blocks end the archive

      // Needed to frame the stream even for entries we discard, so it is
      // validated here — but the size *limit* applies only to what we write.
      const size = Number.parseInt(field(buffer, 124, 12) || '0', 8);
      if (!Number.isFinite(size) || size < 0) {
        throw new ArchiveError(`Archive entry '${name}' declares an invalid size.`);
      }
      const type = field(buffer, 156, 1);
      const prefix = field(buffer, 345, 155);
      const full = BLOCK + Math.ceil(size / BLOCK) * BLOCK;

      // Resolve a long path before anything else decides about this entry.
      if (type === 'x') {
        if (buffer.length < full) break; // its body is the path; wait for it
        paxOverride = paxPath(buffer.subarray(BLOCK, BLOCK + size)) ?? paxOverride;
        buffer = buffer.slice(full);
        continue;
      }
      // Read but do not consume: this header gets re-parsed if the entry's body
      // has not fully arrived, and clearing the override early would lose the
      // long path on that second pass.
      const path = paxOverride ?? (prefix ? `${prefix}/${name}` : name);

      // Learn the root from the first real file. Git tarballs open with a
      // `pax_global_header` pseudo-entry that has no slash in it; letting that
      // teach the root would set it to "" and strip nothing.
      const meta = !isFile(type) || path.startsWith('pax_global_header');
      if (strip === null && !meta) strip = path.includes('/') ? (path.split('/')[0] ?? '') : '';

      const relative = strip && path.startsWith(`${strip}/`) ? path.slice(strip.length + 1) : path;
      const wanted = !meta && relative !== '' && keep(relative);

      if (!wanted) {
        snapshot.scanned += isFile(type) ? 1 : 0;
        paxOverride = null;
        if (buffer.length >= full) {
          buffer = buffer.slice(full);
        } else {
          discarding = full - buffer.length;
          buffer = new Uint8Array(0);
          break;
        }
        continue;
      }

      // Only now, having decided we want this file, does its size matter. A
      // repository full of huge binaries is normal and streams past for free;
      // a huge *definition* file is not something a format can read.
      if (size > MAX_ENTRY_BYTES) {
        throw new ArchiveError(`Archive entry '${name}' exceeds the ${MAX_ENTRY_BYTES} byte limit.`);
      }

      // A kept entry needs its whole body in hand; wait for more of the stream.
      if (buffer.length < full) break;
      paxOverride = null;

      snapshot.bytes += size;
      if (snapshot.bytes > MAX_WRITTEN_BYTES) {
        throw new ArchiveError(`The selected files exceed the ${MAX_WRITTEN_BYTES} byte limit.`);
      }
      const target = safeJoin(base, relative);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, buffer.subarray(BLOCK, BLOCK + size));
      snapshot.scanned += 1;
      snapshot.files += 1;
      buffer = buffer.slice(full);
    }
  }

  if (snapshot.scanned === 0) throw new ArchiveError('The snapshot contains no files.');
  snapshot.archiveSha256 = hasher.digest('hex');
  await writeFile(resolve(base, SHA_SIDECAR), `${snapshot.archiveSha256}\n`);
  return snapshot;
}

/**
 * sha256 of a remote archive, streamed and never stored.
 *
 * The gym's prepare step verifies its download against a pinned checksum, so a
 * re-pin needs the digest of exactly the bytes that URL serves — hashed from
 * the same stream rather than a second download kept on disk.
 */
export async function hashOf(
  archiveUrl: string,
  onProgress?: (bytes: number) => void,
  timeoutMs = 600_000,
): Promise<string> {
  const response = await fetch(archiveUrl, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: 'application/gzip, application/x-gzip, application/octet-stream' },
  });
  if (!response.ok || !response.body) throw new ArchiveError(`Fetching ${archiveUrl} failed: HTTP ${response.status}.`);
  const hasher = new Bun.CryptoHasher('sha256');
  let bytes = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    hasher.update(chunk);
    bytes += chunk.length;
    onProgress?.(bytes);
  }
  return hasher.digest('hex');
}

/** Delete a staged tree. Safe to call on a path that no longer exists. */
export const discard = (path: string) => rm(resolve(path), { recursive: true, force: true });

/** Absolute path of a file inside a staged tree, guarded the same way. */
export const stagedFile = (root: string, relative: string) => safeJoin(resolve(root), relative);

/**
 * Where a preview stages its snapshot, keyed by an opaque token.
 *
 * Guarded like every other path here: the token reaches this function from a
 * request body on the commit endpoint, and a bare `join` would happily resolve
 * `../../..` to somewhere the import then *renames*.
 */
export const stagingPath = (workspace: string, token: string) => safeJoin(resolve(workspace), token);
