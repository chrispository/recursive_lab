/**
 * The resolved NeMo Gym config, read from the running head server.
 *
 * `GET /global_config_dict_yaml` returns the merged Hydra config for whatever
 * `gym env start` was launched with. Values still carry OmegaConf
 * interpolations, which the gym resolves at its own read time:
 *
 *   ${oc.env:VAR,fallback}                     environment variable, or fallback
 *   ${resources_server.resources_servers...}   another key in the same document
 *
 * We resolve both here so callers see plain strings. This is the app's single
 * source of truth for gym paths — never hardcode one; ask the running server.
 */
import { config } from '../config.ts';

export type GymConfig = Record<string, unknown>;

const INTERPOLATION = /\$\{([^}]+)\}/g;

/** Walks `a.b.c` through the parsed document. */
function lookup(root: GymConfig, path: string): unknown {
  let node: unknown = root;
  for (const key of path.split('.')) {
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/**
 * Resolves one `${...}` body. `depth` stops a config that refers to itself from
 * recursing forever — gym configs are hand-written and this has happened.
 */
function resolveExpression(root: GymConfig, body: string, depth: number): string {
  if (body.startsWith('oc.env:')) {
    const [name, ...fallback] = body.slice('oc.env:'.length).split(',');
    return process.env[name!.trim()] ?? fallback.join(',');
  }
  if (body.startsWith('oc.select:')) {
    const [path, ...fallback] = body.slice('oc.select:'.length).split(',');
    const found = lookup(root, path!.trim());
    return typeof found === 'string' ? resolveString(root, found, depth + 1) : fallback.join(',');
  }
  const found = lookup(root, body.trim());
  return typeof found === 'string' ? resolveString(root, found, depth + 1) : String(found ?? '');
}

function resolveString(root: GymConfig, raw: string, depth = 0): string {
  if (depth > 8) return raw;
  return raw.replace(INTERPOLATION, (_match, body: string) => resolveExpression(root, body, depth));
}

/** True when `a.b.c` exists, even if the value is null or a number. */
export function has(root: GymConfig, path: string): boolean {
  return lookup(root, path) !== undefined;
}

/** Reads a string at `a.b.c`, with interpolations resolved. */
export function str(root: GymConfig, path: string, fallback = ''): string {
  const found = lookup(root, path);
  return typeof found === 'string' ? resolveString(root, found) : fallback;
}

/** Reads an array at `a.b.c`; anything else comes back empty. */
export function list<T>(root: GymConfig, path: string): T[] {
  const found = lookup(root, path);
  return Array.isArray(found) ? (found as T[]) : [];
}

/** Reads a plain object at `a.b.c`; anything else comes back empty. */
export function obj(root: GymConfig, path: string): Record<string, unknown> {
  const found = lookup(root, path);
  return found && typeof found === 'object' && !Array.isArray(found)
    ? (found as Record<string, unknown>)
    : {};
}

/** The live config, or a thrown error naming the head server that refused us. */
export async function load(): Promise<GymConfig> {
  const url = `${config.gym.headUrl}/global_config_dict_yaml`;
  const response = await fetch(url, { signal: AbortSignal.timeout(config.gym.timeoutMs) });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}. Is \`gym env start\` running?`);
  }
  // The endpoint returns a JSON *string* whose content is YAML.
  const yaml = (await response.json()) as string;
  return Bun.YAML.parse(yaml) as GymConfig;
}
