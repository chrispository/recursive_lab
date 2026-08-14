/**
 * The NeMo Gym head server client.
 *
 * `gym env start` (run in `config.gym.root`) brings up one head server plus a
 * process per resources server, agent, and model. The ports of those children
 * are assigned at startup and change on every restart, so the head server's
 * `/server_instances` registry is the *only* way to address them. Nothing in
 * this app may hardcode a gym port other than the head URL itself.
 */
import { config } from '../config.ts';

/** One server as the head registry reports it. */
export type GymServer = {
  /** Config key, e.g. `legal_agent_bench` or `legal_agent_bench_harbor_agent`. */
  processName: string;
  /** Component name inside its type, e.g. `harbor_agent`. */
  name: string;
  /** `resources_servers` | `responses_api_agents` | `responses_api_models`. */
  serverType: string;
  url: string;
  port: number;
  pid: number;
  /** Absolute path of the component in the gym checkout. */
  dirPath: string;
  /** True once the server answered `GET /` with `{"status":"ok"}`. */
  healthy: boolean;
};

export type GymHealth = {
  reachable: boolean;
  headUrl: string;
  servers: GymServer[];
  /** Populated only when `reachable` is false. */
  error: string;
};

type InstanceRow = {
  process_name?: string;
  name?: string;
  server_type?: string;
  url?: string;
  port?: number;
  pid?: number;
  dir_path?: string;
};

/** Every fetch in this module goes through here so one hang can't stall a page. */
async function get(url: string): Promise<Response> {
  return fetch(url, {
    signal: AbortSignal.timeout(config.gym.timeoutMs),
    headers: { accept: 'application/json' },
  });
}

/** `{"status":"ok"}` on `GET /` is the health contract every gym server honours. */
async function probe(url: string): Promise<boolean> {
  try {
    const response = await get(`${url}/`);
    if (!response.ok) return false;
    const body = (await response.json()) as { status?: string };
    return body.status === 'ok';
  } catch {
    return false;
  }
}

/**
 * The registry, with each child probed. Never throws — an unreachable head
 * server is a normal state (nobody ran `gym env start` yet), not an error the
 * caller should have to catch.
 */
export async function health(): Promise<GymHealth> {
  const headUrl = config.gym.headUrl;
  let rows: InstanceRow[];
  try {
    const response = await get(`${headUrl}/server_instances`);
    if (!response.ok) {
      return { reachable: false, headUrl, servers: [], error: `head server returned ${response.status}` };
    }
    rows = (await response.json()) as InstanceRow[];
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    return { reachable: false, headUrl, servers: [], error };
  }

  const servers = await Promise.all(
    rows.map(async (row): Promise<GymServer> => {
      const url = row.url ?? '';
      return {
        processName: row.process_name ?? '',
        name: row.name ?? '',
        serverType: row.server_type ?? '',
        url,
        port: row.port ?? 0,
        pid: row.pid ?? 0,
        dirPath: row.dir_path ?? '',
        healthy: url ? await probe(url) : false,
      };
    }),
  );

  return { reachable: true, headUrl, servers, error: '' };
}

/** The URL of one server by its config key, or null if it is not running. */
export async function serverUrl(processName: string): Promise<string | null> {
  const { servers } = await health();
  return servers.find((server) => server.processName === processName)?.url ?? null;
}
