/**
 * Prime Intellect `verifiers` environments: package writer and eval runner.
 *
 * An environment is a v0 PI package — `pyproject.toml` plus one Python module
 * exposing `load_environment()` — next to its `taskset/` splits. Local proof
 * runs `prime eval run <id>` with the policy provider's endpoint; the judge
 * that scores verifier coverage rides in on `LAB_JUDGE_*` env vars. Secrets are
 * passed to the child only, never logged.
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { providerHost, recordError } from './diagnostics.ts';
import { readOutcome, savedResultPaths } from './pi-results.ts';
import { runPrimeProcess } from './prime-process.ts';

export function piBin(): string {
  return process.env.PRIME_BIN ?? Bun.which('prime') ?? '/usr/local/bin/prime';
}

export function piInstalled(): boolean {
  return existsSync(piBin());
}

/** One taskset row, as written to `taskset/<split>.jsonl`. */
export type PiTask = {
  question: string;
  answer: string;
  info: { verifier_targets: string[]; title: string; topic: string };
};

/** Everything a generated environment package needs to know. */
export type PiPackageSpec = {
  slug: string;
  title: string;
  topicDescription: string;
  verifierStrategy: string;
  passThreshold: number;
  splits: { train: PiTask[]; canary: PiTask[]; heldout: PiTask[] };
};

export const moduleName = (slug: string) => slug.replaceAll('-', '_');

/** The judge-coverage environment module. Deterministic in the spec alone. */
function moduleSource(spec: PiPackageSpec): string {
  return `"""${spec.title}

Judge-coverage environment: a judge model reads the answer against each
verifier target; reward is the fraction satisfied. Pass floor ${spec.passThreshold.toFixed(2)}.
Strategy: ${spec.verifierStrategy.replace(/\*\//g, '* /')}
"""
import asyncio
import json
import os
from pathlib import Path

import datasets
from openai import AsyncOpenAI

import verifiers as vf

TASKSET_DIR = Path(__file__).parent / "taskset"
JUDGE_PROMPT = """\\
Task given to the assistant:
<question>
{question}
</question>

Reference answer:
<reference>
{answer}
</reference>

Verifier target that a correct answer must satisfy:
<target>
{target}
</target>

Assistant response:
<response>
{response}
</response>

Does the response satisfy the verifier target? Reply with exactly VERDICT: PASS or VERDICT: FAIL.
"""


def _judge_client() -> AsyncOpenAI:
    return AsyncOpenAI(
        base_url=os.environ["LAB_JUDGE_BASE_URL"],
        api_key=os.environ["LAB_JUDGE_API_KEY"],
    )


async def _score_target(client: AsyncOpenAI, judge_model: str, question: str, answer: str, target: str, response: str) -> float:
    prompt = JUDGE_PROMPT.format(question=question, answer=answer, target=target, response=response)
    completion = await client.chat.completions.create(
        model=judge_model,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=2048,
        temperature=0.0,
    )
    verdict = (completion.choices[0].message.content or "").upper()
    return 1.0 if "VERDICT: PASS" in verdict else 0.0


def _response_text(completion) -> str:
    if not completion:
        return ""
    first = completion[0]
    if isinstance(first, dict):
        return str(first.get("content") or "")
    return str(getattr(first, "content", "") or "")


def _question_text(prompt) -> str:
    if not prompt:
        return ""
    if isinstance(prompt, str):
        return prompt
    last = prompt[-1] if len(prompt) else None
    if isinstance(last, dict):
        return str(last.get("content") or "")
    return str(getattr(last, "content", "") or "")


async def judge_coverage(completion, answer, info, prompt=None, **kwargs):
    targets = list(info.get("verifier_targets") or [])
    if not targets:
        return 0.0
    response = _response_text(completion)
    prompt_text = _question_text(prompt)
    client = _judge_client()
    judge_model = os.environ.get("LAB_JUDGE_MODEL", "")
    scores = await asyncio.gather(
        *(_score_target(client, judge_model, prompt_text, str(answer), target, response) for target in targets),
        return_exceptions=True,
    )
    hits = sum(1.0 for score in scores if score is not None and not isinstance(score, BaseException) and score >= 1.0)
    return hits / len(targets)


def _load_split(name: str) -> list[dict]:
    path = TASKSET_DIR / f"{name}.jsonl"
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def load_environment(**kwargs):
    split = str(kwargs.pop("split", "train"))
    if split not in {"train", "canary", "heldout"}:
        raise ValueError(f"Unknown taskset split: {split}")
    rows = _load_split(split)
    dataset = datasets.Dataset.from_list(rows)
    eval_dataset = None
    rubric = vf.Rubric(funcs=[judge_coverage], weights=[1.0])
    return vf.SingleTurnEnv(
        dataset=dataset,
        eval_dataset=eval_dataset,
        rubric=rubric,
        pass_threshold=${spec.passThreshold.toFixed(2)},
        **kwargs,
    )
`;
}

function pyprojectSource(spec: PiPackageSpec): string {
  return `[project]
name = "${spec.slug}"
description = "${spec.title.replace(/"/g, "'")}"
tags = ["legal", "judge-coverage", "rl"]
version = "0.1.0"
requires-python = ">=3.10"
dependencies = [
    "verifiers>=0.3.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build]
include = ["${moduleName(spec.slug)}.py", "pyproject.toml", "taskset"]

[tool.verifiers.eval]
num_examples = ${spec.splits.train.length}
rollouts_per_example = 4
`;
}

function readmeSource(spec: PiPackageSpec): string {
  const counts = (role: keyof PiPackageSpec['splits']) => spec.splits[role].length;
  return `# ${spec.slug}

${spec.title}

- **Topic**: ${spec.topicDescription}
- **Verifier**: judge coverage — a judge model scores the answer against every verifier target; reward is the fraction satisfied. Pass floor ${spec.passThreshold.toFixed(2)}.
- **Strategy**: ${spec.verifierStrategy}
- **Splits**: train ${counts('train')} · canary ${counts('canary')} · heldout ${counts('heldout')}

## Local proof

\`\`\`bash
PYTHONPATH=<this directory's parent> prime eval run ${spec.slug} \\
  --plain --provider openai --api-base-url "$POLICY_BASE_URL" \\
  --api-key-var LAB_POLICY_API_KEY --model "$POLICY_MODEL" --save-results
\`\`\`

The judge needs \`LAB_JUDGE_BASE_URL\`, \`LAB_JUDGE_API_KEY\`, and \`LAB_JUDGE_MODEL\` in the environment.
`;
}

/** The immutable training handoff: prime-rl consumes the same environment. */
export function clusterToml(spec: PiPackageSpec, inferenceModel: string, judgeModel: string, rollouts: number): string {
  return `# Cluster training config for ${spec.slug} (${spec.title}).
# Generated by recursive_lab — the environment package in this directory is
# the artifact to install (prime env install / hub push) before training.

[[orchestrator.train.env]]
name = "${spec.slug}"
harness = { id = "default", runtime = { type = "subprocess" } }
timeout = { scoring = 120 }

[orchestrator.train.env.env_args]
# Local proof used ${rollouts} rollouts per example; the cluster keeps 4.
pass_threshold = ${spec.passThreshold.toFixed(2)}

[lab]
inference_model = "${inferenceModel}"
judge_model = "${judgeModel}"
judge = "coverage: fraction of verifier targets a judge scores as satisfied"
splits = { train = ${spec.splits.train.length}, canary = ${spec.splits.canary.length}, heldout = ${spec.splits.heldout.length} }
`;
}

/** Writes the package and returns the paths written, in stable order. */
export async function writePackage(dir: string, spec: PiPackageSpec): Promise<string[]> {
  const mod = moduleName(spec.slug);
  const files: Array<[string, string]> = [
    ['pyproject.toml', pyprojectSource(spec)],
    [`${mod}.py`, moduleSource(spec)],
    ['README.md', readmeSource(spec)],
  ];
  for (const role of ['train', 'canary', 'heldout'] as const) {
    files.push([`taskset/${role}.jsonl`, spec.splits[role].map((task) => JSON.stringify(task)).join('\n') + '\n']);
  }
  for (const [name, body] of files) {
    await mkdir(resolve(dir, name, '..'), { recursive: true });
    await writeFile(resolve(dir, name), body, 'utf8');
  }
  return files.map(([name]) => resolve(dir, name));
}

export type PiEvalRequest = {
  /** Environment id (package slug). */
  envId: string;
  /** Directory containing the package; becomes PYTHONPATH. */
  envDir: string;
  model: string;
  baseUrl: string;
  /** Name of the env var carrying the policy API key. */
  apiKeyVar: string;
  apiKey: string;
  judge: { baseUrl: string; apiKey: string; model: string };
  numExamples: number;
  rolloutsPerExample: number;
  maxConcurrent: number;
  /** Where `--output-dir` points; results land under `evals/` inside it. */
  outputDir: string;
  timeoutMs: number;
  /** Selects which generated taskset split `load_environment` exposes. */
  split?: 'train' | 'canary' | 'heldout';
};

export type PiRollout = { exampleId: number; reward: number; error: string | null };

export type PiEvalOutcome = {
  resultsPath: string;
  rollouts: PiRollout[];
  avgReward: number;
  passAtK: Record<string, number>;
  seconds: number;
};

export type PiEvalHooks = {
  onLine?: (line: string, stream: 'out' | 'err') => void | Promise<void>;
  onSpawn?: (pgid: number) => void | Promise<void>;
};

/** Runs `prime eval run` and parses its saved results. Throws on non-zero exit. */
export async function runEval(request: PiEvalRequest, hooks: PiEvalHooks = {}): Promise<PiEvalOutcome> {
  await mkdir(request.outputDir, { recursive: true });
  const previousResults = new Set(await savedResultPaths(request));
  const args = [
    'eval', 'run', request.envId,
    '--plain',
    '--disable-tui',
    '--provider', 'openai',
    '--api-base-url', request.baseUrl,
    '--api-key-var', request.apiKeyVar,
    '--model', request.model,
    '--num-examples', String(request.numExamples),
    '--rollouts-per-example', String(request.rolloutsPerExample),
    '--max-concurrent', String(request.maxConcurrent),
    '--save-results',
    '--output-dir', request.outputDir,
  ];
  if (request.split) args.push('--env-args', JSON.stringify({ split: request.split }));
  const prime = await runPrimeProcess({
    command: [piBin(), ...args],
    cwd: request.envDir,
    env: {
      PYTHONUNBUFFERED: '1',
      PRIME_DISABLE_VERSION_CHECK: '1',
      PYTHONPATH: request.envDir,
      [request.apiKeyVar]: request.apiKey,
      LAB_JUDGE_BASE_URL: request.judge.baseUrl,
      LAB_JUDGE_API_KEY: request.judge.apiKey,
      LAB_JUDGE_MODEL: request.judge.model,
    },
    timeoutMs: request.timeoutMs,
    diagnostic: {
      directory: resolve(request.outputDir, 'diagnostics'),
      name: `${request.envId}-${request.split ?? 'default'}-prime`,
      metadata: {
        kind: 'prime_eval',
        env_id: request.envId,
        model: request.model,
        provider_host: providerHost(request.baseUrl),
        api_key_var: request.apiKeyVar,
        split: request.split,
        timeout_ms: request.timeoutMs,
      },
    },
    onLine: hooks.onLine,
    onSpawn: hooks.onSpawn,
  });
  try {
    return await readOutcome(request, previousResults);
  } catch (error) {
    await recordError(prime.diagnostic, 'result parsing', error);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message} Prime diagnostics: ${prime.diagnostic.path}.`);
  }
}
