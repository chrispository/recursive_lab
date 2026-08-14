/**
 * Benchmark source URLs, resolved to a pinned snapshot.
 *
 * A benchmark import must be reproducible: "the tasks at this commit", never
 * "the tasks on main today". So every URL is resolved to an immutable revision
 * before anything is downloaded, and that revision is stored on the benchmark
 * row. Re-importing the same URL later without a revision picks up a *new*
 * commit, and that is a different benchmark, not an update.
 *
 * Nothing here touches the filesystem or the database — it turns a string the
 * user typed into a spec `archive.ts` can fetch.
 */

export type SourceKind = 'github' | 'huggingface';

export type SourceSpec = {
  kind: SourceKind;
  /** `owner/repo` for GitHub, `namespace/name` for HuggingFace. */
  identifier: string;
  /** The ref as given: a branch, tag, or commit. Empty means "default branch". */
  requestedRef: string;
  /** Canonical https URL of the repository itself. */
  url: string;
};

/** A spec whose ref has been resolved to an immutable commit. */
export type PinnedSource = SourceSpec & {
  /** Full commit sha (GitHub) or revision (HuggingFace). Never a branch name. */
  revision: string;
  /** Where the `.tar.gz` snapshot of that exact revision lives. */
  archiveUrl: string;
  /** Repository URL at the pinned revision, for the audit trail. */
  pinnedUrl: string;
};

export class SourceError extends Error {}

const clean = (value: string) => value.trim().replace(/\.git$/, '').replace(/\/+$/, '');

/**
 * Parse a URL into a source spec.
 *
 * Accepts the forms people actually paste: a repo root, a `/tree/<ref>` link
 * copied from the branch dropdown, or a bare `owner/repo`.
 */
export function parse(input: string): SourceSpec {
  const raw = clean(input);
  if (!raw) throw new SourceError('Enter a benchmark source URL.');

  // Bare `owner/repo` is assumed to be GitHub, which is where benchmarks live.
  if (!raw.includes('://')) {
    const parts = raw.split('/').filter(Boolean);
    if (parts.length !== 2) {
      throw new SourceError(`'${input}' is not a URL or an owner/repo pair.`);
    }
    return { kind: 'github', identifier: `${parts[0]}/${parts[1]}`, requestedRef: '', url: `https://github.com/${parts[0]}/${parts[1]}` };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new SourceError(`'${input}' is not a valid URL.`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new SourceError(`Only http(s) sources are supported, not '${parsed.protocol}'.`);
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  const host = parsed.hostname.replace(/^www\./, '');

  if (host === 'github.com') {
    const [owner, repo, keyword, ...rest] = segments;
    if (!owner || !repo) throw new SourceError('A GitHub URL needs an owner and a repository.');
    // /tree/<ref> and /commit/<ref> both name a revision; anything else does not.
    const requestedRef = keyword === 'tree' || keyword === 'commit' ? rest.join('/') : '';
    return { kind: 'github', identifier: `${owner}/${repo}`, requestedRef, url: `https://github.com/${owner}/${repo}` };
  }

  if (host === 'huggingface.co') {
    // Dataset URLs carry a /datasets prefix; model URLs do not.
    const path = segments[0] === 'datasets' ? segments.slice(1) : segments;
    const [namespace, name, keyword, ...rest] = path;
    if (!namespace || !name) throw new SourceError('A HuggingFace URL needs a namespace and a dataset name.');
    const requestedRef = keyword === 'tree' || keyword === 'blob' ? rest.join('/') : '';
    return {
      kind: 'huggingface',
      identifier: `${namespace}/${name}`,
      requestedRef,
      url: `https://huggingface.co/datasets/${namespace}/${name}`,
    };
  }

  throw new SourceError(`Unsupported host '${host}'. Import from github.com or huggingface.co.`);
}

type GithubRef = { sha?: string; commit?: { sha?: string } };

/**
 * Percent-encode a ref for a URL path without destroying its slashes.
 *
 * Branch names are routinely `feature/x` or `release/1.0`, and those slashes
 * are real path separators to both hosts' APIs. Encoding the ref whole turns
 * them into `%2F` and every such ref resolves to a 404.
 */
const encodeRef = (ref: string) => ref.split('/').map(encodeURIComponent).join('/');

/** Resolve a spec's ref to an immutable revision by asking the host. */
export async function pin(spec: SourceSpec, timeoutMs = 20_000): Promise<PinnedSource> {
  const signal = AbortSignal.timeout(timeoutMs);

  if (spec.kind === 'github') {
    // `commits/<ref>` resolves branches, tags and shas alike; omitting the ref
    // resolves the default branch, so we never have to guess main vs master.
    const ref = spec.requestedRef || 'HEAD';
    const api = `https://api.github.com/repos/${spec.identifier}/commits/${encodeRef(ref)}`;
    const response = await fetch(api, { signal, headers: { accept: 'application/vnd.github+json' } });
    if (response.status === 404) {
      throw new SourceError(`${spec.identifier} has no ref '${ref}', or the repository is private.`);
    }
    if (!response.ok) throw new SourceError(`GitHub returned ${response.status} for ${spec.identifier}.`);
    const body = (await response.json()) as GithubRef;
    const revision = body.sha ?? body.commit?.sha ?? '';
    if (!revision) throw new SourceError(`GitHub did not return a commit sha for ${spec.identifier}.`);
    return {
      ...spec,
      revision,
      archiveUrl: `https://codeload.github.com/${spec.identifier}/tar.gz/${revision}`,
      pinnedUrl: `${spec.url}/tree/${revision}`,
    };
  }

  const ref = spec.requestedRef || 'main';
  const api = `https://huggingface.co/api/datasets/${spec.identifier}/revision/${encodeRef(ref)}`;
  const response = await fetch(api, { signal, headers: { accept: 'application/json' } });
  if (response.status === 404) {
    throw new SourceError(`${spec.identifier} has no revision '${ref}', or the dataset is gated.`);
  }
  if (!response.ok) throw new SourceError(`HuggingFace returned ${response.status} for ${spec.identifier}.`);
  const body = (await response.json()) as { sha?: string };
  const revision = body.sha ?? '';
  if (!revision) throw new SourceError(`HuggingFace did not return a revision for ${spec.identifier}.`);
  return {
    ...spec,
    revision,
    archiveUrl: `https://huggingface.co/api/datasets/${spec.identifier}/tar/${revision}`,
    pinnedUrl: `${spec.url}/tree/${revision}`,
  };
}

/** Parse and pin in one step — what the import service actually calls. */
export const resolve = async (input: string, ref = ''): Promise<PinnedSource> => {
  const spec = parse(input);
  return pin(ref.trim() ? { ...spec, requestedRef: ref.trim() } : spec);
};
