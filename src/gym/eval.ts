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
import { benchmarkRunDir, config, harborJobsDir } from '../config.ts';
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

function rowOf(adapter: string, agent: string, task: EvalTask, settings: EvalSettings) {
  return {
    agent_ref: { name: agent, type: 'responses_api_agents' },
    instance_id: `${adapter}::${task.taskId}`,
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

function overlaysOf(
  bound: Bound,
  settings: EvalSettings,
  live: gymConfig.GymConfig,
  jobsRel: string,
): string[] {
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
    [`${agent}.harbor_jobs_dir`, jobsRel],
  ];
  return wanted
    .filter(([path]) => gymConfig.has(live, path))
    .map(([path, value]) => `+${path}=${value}`);
}

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
    '--resources-server', bound.resourcesProcess,
    '--model-type', bound.modelType,
    '--agent', bound.agentProcess,
    '--model', model,
    '--input', inputRel,
    '--output', outputRel,
    '--split', 'validation',
    '--concurrency', String(settings.concurrency),
    '--temperature', String(settings.temperature),
    '--top-p', String(settings.topP),
    ...overlaysOf(bound, settings, live, rel(harborJobsDir(request.benchmarkRunCode))),
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
  const jobsDir = harborJobsDir(request.benchmarkRunCode);
  await mkdir(dirname(inputPath), { recursive: true });
  await mkdir(jobsDir, { recursive: true });

  const lines = request.tasks.map((task) =>
    JSON.stringify(rowOf(bound.resourcesName, bound.agentProcess, task, request.settings)),
  );
  await writeFile(inputPath, lines.join('\n') + '\n');

  const command = commandOf(request, rel(inputPath), rel(outputPath), bound, live);
  const spawned = gym(command, { cwd: config.gym.root, onLine });
  return { inputPath, outputPath, harborJobsDir: jobsDir, command: ['gym', ...command], spawned };
}
