/**
 * Build and run `gym eval run` against already-started servers.
 *
 * `--no-serve` is mandatory here: `gym env start` is already running, and a
 * second start fights it for ports. Paths are gym-root-relative because gym
 * config paths are repo-relative and break otherwise. See AGENTS.md § NeMo Gym.
 *
 * Adapter, agent, and `--model-type` are the process/component names the head
 * reports. Hydra overlays are applied only for keys that exist on that gym
 * config, so a resources server without a judge does not get LAB judge flags.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { benchmarkRunDir, config } from '../config.ts';
import * as gymConfig from './config.ts';
import * as head from './head.ts';
import { pickAgent, pickModelType, pickResources } from './servers.ts';
import { gym, type Spawned } from './spawn.ts';

export type EvalSettings = {
  repeats: number;
  concurrency: number;
  temperature: number;
  topP: number;
  outputTokenStrategy: 'adaptive' | 'fixed';
  maxOutputTokens: number;
  maxTurns: number;
  shellTimeout: number;
  agentModelTimeout: number;
  judgeParallelism: number;
  judgeTimeout: number;
  judgeMaxTokens: number;
  judgeRetries: number;
};

export type EvalTask = {
  taskId: string;
  maxOutputTokens: number;
};

export type EvalRequest = {
  benchmarkRunCode: string;
  adapter: string;
  model: string;
  tasks: EvalTask[];
  settings: EvalSettings;
};

export type EvalHandle = {
  inputPath: string;
  outputPath: string;
  harborJobsDir: string;
  command: string[];
  spawned: Spawned;
};

const rel = (absolute: string) => relative(config.gym.root, absolute);

/**
 * One rollout row.
 *
 * ## `lab_run_code` — how a run tells Harbor who it is
 *
 * This is not a gym field. It exists because the Harbor agent names its jobs
 * directory before it knows anything about the lab, and the run's identity has
 * to cross three programs to change that.
 *
 * It cannot go through config. `gym eval run --no-serve` reuses the servers
 * `gym env start` already built, and the agent reads `harbor_jobs_dir` from its
 * own startup config, so an eval-time Hydra overlay for it is inert — see
 * AGENTS.md § NeMo Gym. The request is the only thing that genuinely varies per
 * run, so the identity rides on that:
 *
 *   1. this function writes the field into each line of selected-tasks.jsonl;
 *   2. gym posts the row to the agent's `/run` **verbatim** — `json=row` in
 *      `nemo_gym/rollout_collection.py`, no field enumeration anywhere;
 *   3. `HarborRunRequest` sets `extra="allow"`
 *      (`responses_api_agents/harbor_agent/app.py`), so the unknown key is kept
 *      rather than dropped, which is what a plain pydantic model would do;
 *   4. `harbor_bridge.py` reads it, validates it as a path component, and names
 *      the Harbor job after it — trials land in `<harbor_jobs>/BR-000NN/`
 *      instead of under four levels of date, dataset, model and a random id.
 *
 * Steps 2 and 3 are upstream code we do not own, and each can break differently:
 * `extra="forbid"` would reject every request loudly, while a row rebuilt
 * field-by-field would drop the code with no error at all. The second is the
 * dangerous one, so **nothing here may depend on it arriving**. Progress finds
 * trials by mtime under the jobs root rather than by looking for `BR-000NN`,
 * and an agent that ignores the field still runs the eval correctly — it just
 * writes to the dated layout.
 */
function rowOf(
  adapter: string,
  agent: string,
  task: EvalTask,
  settings: EvalSettings,
  benchmarkRunCode: string,
) {
  return {
    agent_ref: { name: agent, type: 'responses_api_agents' },
    instance_id: `${adapter}::${task.taskId}`,
    lab_run_code: benchmarkRunCode,
    responses_create_params: {
      input: [],
      temperature: settings.temperature,
      top_p: settings.topP,
      max_output_tokens: task.maxOutputTokens,
    },
  };
}

type Bound = {
  resourcesProcess: string;
  resourcesName: string;
  agentProcess: string;
  agentName: string;
  modelType: string;
};

/**
 * Hydra overlays for this run.
 *
 * `harbor_jobs_dir` is deliberately absent. It is server startup state, so
 * setting it here did nothing but make the recorded command claim a path the
 * run never wrote to; `gymConfig.harborJobsDir` reads the real one instead.
 *
 * The keys that remain are in the same position — under `--no-serve` the
 * servers are already up and hold their own config — so they take effect only
 * on a gym started with them. They are kept because they are correct for a run
 * that does start its own servers, and because dropping them would lose the
 * only record of what the run asked for. `settingsFixedAtStart` names them so
 * the ledger can say so out loud rather than implying they applied.
 */
function overlaysOf(bound: Bound, settings: EvalSettings, live: gymConfig.GymConfig): string[] {
  const resources = `${bound.resourcesProcess}.resources_servers.${bound.resourcesName}`;
  const agent = `${bound.agentProcess}.responses_api_agents.${bound.agentName}`;
  const wanted: [string, string | number][] = [
    [`${resources}.judge_parallelism`, settings.judgeParallelism],
    [`${resources}.judge_request_timeout_seconds`, settings.judgeTimeout],
    [`${resources}.judge_max_tokens`, settings.judgeMaxTokens],
    [`${resources}.judge_max_retries`, settings.judgeRetries],
    [`${agent}.harbor_agent_kwargs.max_turns`, settings.maxTurns],
    [`${agent}.harbor_agent_kwargs.shell_timeout`, settings.shellTimeout],
    [`${agent}.harbor_agent_kwargs.agent_model_timeout_seconds`, settings.agentModelTimeout],
  ];
  return wanted
    .filter(([path]) => gymConfig.has(live, path))
    .map(([path, value]) => `+${path}=${value}`);
}

/**
 * Run settings that a running gym cannot be told about mid-flight.
 *
 * Temperature, top-p, output cap, repeats and concurrency all reach gym per
 * request or on the command line and do apply. These do not: they are read by
 * the agent and resources servers when `gym env start` builds them.
 */
export const settingsFixedAtStart = [
  'max turns',
  'shell timeout',
  'agent model timeout',
  'judge parallelism',
  'judge timeout',
  'judge max tokens',
  'judge retries',
];

export function commandOf(
  request: EvalRequest,
  inputRel: string,
  outputRel: string,
  bound: Bound,
  live: gymConfig.GymConfig,
): string[] {
  const { model, settings } = request;
  const args = [
    'eval', 'run',
    '--no-serve',
    '--resources-server', bound.resourcesName,
    '--model-type', bound.modelType,
    '--agent', bound.agentProcess,
    '--model', model,
    '--input', inputRel,
    '--output', outputRel,
    '--split', 'validation',
    '--concurrency', String(settings.concurrency),
    '--temperature', String(settings.temperature),
    '--top-p', String(settings.topP),
    ...overlaysOf(bound, settings, live),
    '+reuse_existing_data_preparation=true',
  ];
  if (settings.outputTokenStrategy === 'fixed') {
    args.push('--max-output-tokens', String(settings.maxOutputTokens));
  }
  if (settings.repeats > 1) args.push('--num-repeats', String(settings.repeats));
  return args;
}

/** Write selected-tasks.jsonl and start gym. Does not wait. */
export async function start(
  request: EvalRequest,
  onLine: (line: string, stream: 'out' | 'err') => void | Promise<void>,
): Promise<EvalHandle> {
  const health = await head.health();
  if (!health.reachable) {
    throw new Error(`NeMo Gym is not running (${health.headUrl}).`);
  }
  const resources = pickResources(health, request.adapter);
  const agent = pickAgent(health, resources);
  const bound: Bound = {
    resourcesProcess: resources.processName,
    resourcesName: resources.name,
    agentProcess: agent.processName,
    agentName: agent.name,
    modelType: pickModelType(health),
  };
  const live = await gymConfig.load();

  const dir = benchmarkRunDir(request.benchmarkRunCode);
  const inputPath = resolve(dir, 'selected-tasks.jsonl');
  const outputPath = resolve(dir, 'rollouts.jsonl');
  // Harbor owns this directory and creates it; the lab only reads it. Creating
  // one of our own here is what hid the mistake last time — an empty directory
  // we made ourselves looks exactly like a run that has not started yet.
  const jobsDir = gymConfig.harborJobsDir(live, bound.agentProcess, bound.agentName);
  await mkdir(dirname(inputPath), { recursive: true });

  const lines = request.tasks.map((task) =>
    JSON.stringify(
      rowOf(bound.resourcesName, bound.agentProcess, task, request.settings, request.benchmarkRunCode),
    ),
  );
  await writeFile(inputPath, lines.join('\n') + '\n');

  const command = commandOf(request, rel(inputPath), rel(outputPath), bound, live);
  const spawned = gym(command, { cwd: config.gym.root, onLine });
  return { inputPath, outputPath, harborJobsDir: jobsDir, command: ['gym', ...command], spawned };
}
