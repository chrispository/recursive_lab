/**
 * Pick the running gym servers a catalog run will talk to.
 *
 * Names come from `/server_instances`, not from a benchmark. A future gym
 * checkout is `GYM_ROOT` + `GYM_HEAD_URL`; a future resources server is
 * whatever `gym env start --resources-server …` brought up. This file must
 * not mention a specific bench.
 */
import type { GymHealth, GymServer } from './head.ts';

const healthy = (health: GymHealth, serverType: string) =>
  health.servers.filter((server) => server.serverType === serverType && server.healthy);

const names = (servers: GymServer[]) => servers.map((server) => server.processName).join(', ') || 'none';

export class GymPairError extends Error {}

/**
 * The resources server that will execute tasks.
 *
 * A stored adapter wins when that process is healthy. Otherwise there must be
 * exactly one healthy resources server — two running is ambiguous.
 */
export function pickResources(health: GymHealth, preferred = ''): GymServer {
  const running = healthy(health, 'resources_servers');
  if (preferred) {
    const exact = running.find((server) => server.processName === preferred);
    if (exact) return exact;
    const candidates = running.filter(
      (server) => server.name === preferred || server.processName.startsWith(`${preferred}_`),
    );
    if (candidates.length === 1) return candidates[0]!;
    if (candidates.length === 0) {
      throw new GymPairError(
        `Gym resources server ${preferred} is not healthy (running: ${names(running)}).`,
      );
    }
    throw new GymPairError(
      `Multiple gym resources servers match ${preferred} (${names(candidates)}). Bind the catalog to one of them.`,
    );
  }
  if (running.length === 1) return running[0]!;
  if (running.length === 0) {
    throw new GymPairError('No healthy gym resources server. Start one with gym env start --resources-server <name>.');
  }
  throw new GymPairError(
    `Multiple gym resources servers are running (${names(running)}). Bind the catalog to one of them.`,
  );
}

/**
 * The agent paired with a resources server.
 *
 * Gym's usual name is `{resources}_harbor_agent`. If that is not up, a unique
 * agent whose process name starts with the resources name, or the only healthy
 * agent on the head, is accepted.
 */
export function pickAgent(health: GymHealth, resources: GymServer): GymServer {
  const running = healthy(health, 'responses_api_agents');
  const convention = `${resources.processName}_harbor_agent`;
  const named = running.find((server) => server.processName === convention);
  if (named) return named;
  const stem = resources.processName.replace(/_resources_server$/, '');
  const stemNamed = running.find((server) => server.processName === `${stem}_harbor_agent`);
  if (stemNamed) return stemNamed;
  const prefixed = running.filter(
    (server) => server.processName.startsWith(`${resources.processName}_`) || server.processName.startsWith(`${stem}_`),
  );
  if (prefixed.length === 1) return prefixed[0]!;
  if (prefixed.length > 1) {
    throw new GymPairError(
      `Multiple gym agents match ${resources.processName} (${names(prefixed)}).`,
    );
  }
  if (running.length === 1) return running[0]!;
  throw new GymPairError(
    `No healthy agent for ${resources.processName} (looked for ${convention}; running: ${names(running)}).`,
  );
}

/**
 * `--model-type` is the component name (e.g. `inference_provider`), not the
 * process name (`policy_model`). There must be exactly one healthy model server.
 */
export function pickModelType(health: GymHealth): string {
  const running = healthy(health, 'responses_api_models');
  if (running.length === 1) return running[0]!.name;
  if (running.length === 0) {
    throw new GymPairError('No healthy gym model server. Start gym with --model-type set.');
  }
  throw new GymPairError(`Multiple gym model servers are running (${names(running)}).`);
}
