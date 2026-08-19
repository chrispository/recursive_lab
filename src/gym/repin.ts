/**
 * Re-pin the gym's prepared benchmark assets to a revision the lab imported.
 *
 * The gym's resources server downloads benchmark source at a commit hard-coded
 * in its own `prepare.py` and refuses anything else — that pin is why a fresh
 * catalog can contain tasks the gym has never heard of. This module rewrites
 * the pin so both copies match. It is a patch against upstream code we do not
 * own: each edit is an exact anchor that must be found once, the file is reset
 * from git first, and the result is syntax-checked with the gym's own python
 * before anything restarts.
 */
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config } from '../config.ts';

export class RepinError extends Error {}

export type PinTarget = {
  repository: string;
  revision: string;
  archiveSha256: string;
  taskCount: number;
};

export type RepinReport = {
  server: string;
  preparePath: string;
  fromRevision: string;
  toRevision: string;
  fromTaskCount: number;
  toTaskCount: number;
};

/** Read the constants a report needs, from text already in hand. */
function readPins(source: string): { revision: string; taskCount: number } {
  const revision = /LAB_SOURCE_REVISION = "([0-9a-f]{40})"/.exec(source)?.[1] ?? '';
  const taskCount = Number(/EXPECTED_TASK_COUNT = ([\d_]+)/.exec(source)?.[1]?.replaceAll('_', '') ?? 0);
  return { revision, taskCount };
}

/** One anchored edit: the pattern must match exactly once, or nothing runs. */
function replaceOnce(source: string, pattern: RegExp, replacement: string, label: string): string {
  const hits = source.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`));
  if (!hits || hits.length !== 1) {
    throw new RepinError(
      `Cannot re-pin: the ${label} anchor was not found exactly once in prepare.py — upstream changed.`,
    );
  }
  return source.replace(pattern, replacement);
}

const COPY_DOCUMENTS = `\
def _copy_documents(source_id: str, source_task_dir: Path, task_dir: Path, output_dir: Path, config: dict[str, Any]) -> None:
    """Per-task \`documents/\`, or one shared copy per family for \`docs_dir\` tasks."""
    documents = source_task_dir / "documents"
    if documents.is_dir():
        shutil.copytree(documents, task_dir / "documents")
        return
    family = source_id.split("/")[0]
    shared = output_dir / "_shared" / family
    if not shared.exists():
        docs_dir = (source_task_dir / str(config.get("docs_dir") or "documents")).resolve()
        shutil.copytree(docs_dir, shared)
    (task_dir / "documents").symlink_to(os.path.relpath(shared, task_dir))


`;

/** Find the resources server whose prepare.py pins this repository. */
export async function locate(repository: string): Promise<{ server: string; preparePath: string }> {
  const needle = `LAB_SOURCE_REPOSITORY = "${repository}"`;
  for (const rel of new Bun.Glob('resources_servers/*/prepare.py').scanSync({ cwd: config.gym.root })) {
    const preparePath = resolve(config.gym.root, rel);
    const text = await Bun.file(preparePath).text().catch(() => '');
    if (text.includes(needle)) {
      return { server: rel.split('/')[1]!, preparePath };
    }
  }
  throw new RepinError(
    `No gym resources server pins ${repository}. The gym checkout may not support this benchmark.`,
  );
}

/** Reset prepare.py to upstream so a re-pin always patches a clean base. */
async function resetFromGit(preparePath: string): Promise<void> {
  const rel = preparePath.slice(config.gym.root.length + 1);
  const proc = Bun.spawn(['git', '-C', config.gym.root, 'checkout', '--', rel], {
    stdout: 'ignore',
    stderr: 'pipe',
  });
  await proc.exited; // a failure here only means the anchors decide idempotency
}

/** Assert the patched file still parses, using the gym's own interpreter. */
async function assertParses(preparePath: string): Promise<void> {
  const python = resolve(config.gym.root, '.venv/bin/python');
  const proc = Bun.spawn([python, '-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read())', preparePath], {
    stdout: 'ignore',
    stderr: 'pipe',
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new RepinError('The re-pinned prepare.py does not parse. Nothing was started; the gym is untouched.');
  }
}

/** Rewrite the pin, and relax the two checks that exclude shared-docs tasks. */
export async function apply(target: PinTarget): Promise<RepinReport> {
  const { server, preparePath } = await locate(target.repository);
  await resetFromGit(preparePath);
  let source = await Bun.file(preparePath).text();
  const before = readPins(source);

  source = replaceOnce(
    source,
    /LAB_SOURCE_REVISION = "[0-9a-f]{40}"/,
    `LAB_SOURCE_REVISION = "${target.revision}"`,
    'revision',
  );
  source = replaceOnce(
    source,
    /(LAB_SOURCE_ARCHIVE_SHA256 = \(\n    ")[0-9a-f]{64}(")/,
    `$1${target.archiveSha256}$2`,
    'archive checksum',
  );
  // `_shared` (family-wide docs copies) is not a task; both count sites must
  // skip it or the validator rejects a prepare that actually succeeded.
  const notShared = 'child.is_dir() and child.name != "_shared"';
  source = replaceOnce(
    source,
    /task_dirs = sorted\(child for child in path\.iterdir\(\) if child\.is_dir\(\)\)/,
    `task_dirs = sorted(child for child in path.iterdir() if ${notShared})`,
    'cache task count',
  );
  source = replaceOnce(
    source,
    /task_dirs = sorted\(child for child in stage\.iterdir\(\) if child\.is_dir\(\)\)/,
    `task_dirs = sorted(child for child in stage.iterdir() if ${notShared})`,
    'stage task count',
  );
  source = replaceOnce(
    source,
    /EXPECTED_TASK_COUNT = [\d_]+/,
    `EXPECTED_TASK_COUNT = ${target.taskCount.toLocaleString('en-US').replaceAll(',', '_')}`,
    'task count constant',
  );
  // A task may keep its documents in a family-wide `docs_dir` instead of a
  // per-task `documents/` directory; validate against whichever it declares.
  source = replaceOnce(
    source,
    / {8}if not \(task_dir \/ "documents"\)\.is_dir\(\):\n {12}raise ValueError\(f"LAB task \{source_id\} has no documents directory"\)\n {8}config = json\.loads\(task_json\.read_text\(encoding="utf-8"\)\)/,
    `        config = json.loads(task_json.read_text(encoding="utf-8"))\n` +
      `        _declared = task_dir / str(config.get("docs_dir") or "documents")\n` +
      `        if not (task_dir / "documents").is_dir() and not _declared.resolve().is_dir():\n` +
      `            raise ValueError(f"LAB task {source_id} has no documents directory")`,
    'documents validation',
  );
  source = replaceOnce(
    source,
    / {8}shutil\.copytree\(source_task_dir \/ "documents", task_dir \/ "documents"\)\n\n {8}config = json\.loads\(\(source_task_dir \/ "task\.json"\)\.read_text\(encoding="utf-8"\)\)/,
    `        config = json.loads((source_task_dir / "task.json").read_text(encoding="utf-8"))\n` +
      `        _copy_documents(source_id, source_task_dir, task_dir, output_dir, config)\n` +
      `        if config.get("docs_dir"):\n` +
      `            config["docs_dir"] = "documents"`,
    'documents hydration',
  );
  source = replaceOnce(source, /def _build_task_cache\(/, `${COPY_DOCUMENTS}def _build_task_cache(`, 'helper injection');

  await Bun.write(preparePath, source);
  await assertParses(preparePath);
  return {
    server,
    preparePath,
    fromRevision: before.revision,
    toRevision: target.revision,
    fromTaskCount: before.taskCount,
    toTaskCount: target.taskCount,
  };
}

/** Drop the server's prepared caches so the next start rebuilds at the new pin. */
export async function clearPrepared(server: string): Promise<string[]> {
  const dirs = [
    resolve(config.gym.root, `resources_servers/${server}/data/cache/harbor_tasks/${server}`),
    resolve(config.gym.root, `resources_servers/${server}/data/runtime/harbor_tasks/${server}`),
  ];
  for (const dir of dirs) {
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
  }
  return dirs;
}
