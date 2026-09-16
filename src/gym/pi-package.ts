import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** One taskset row, as written to `taskset/<split>.jsonl`. */
export type PiTask = {
  question: string;
  answer: string;
  info: { verifier_targets: string[]; title: string; topic: string; document_id: number };
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
  return `${JSON.stringify(`${spec.title}\nJudge coverage: fraction of verifier targets satisfied.\nStrategy: ${spec.verifierStrategy}`)}
import asyncio
import json
import os
from pathlib import Path

import datasets
from openai import AsyncOpenAI

import verifiers as vf

TASKSET_DIR = Path(__file__).parent / "taskset"
TARGET_SCORES_PATH = os.environ.get("LAB_TARGET_SCORES_PATH", "")
CALL_INDEX = 0
# A judge call is one short classification. The SDK default is 600s with two
# retries, which exceeds the whole eval budget: a single hung request then
# looks exactly like a broken environment. Bound it so a stalled endpoint is
# reported as a stalled endpoint, on the target it stalled on.
JUDGE_TIMEOUT_S = float(os.environ.get("LAB_JUDGE_TIMEOUT_S", "90"))
JUDGE_MAX_RETRIES = int(os.environ.get("LAB_JUDGE_MAX_RETRIES", "2"))
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
        timeout=JUDGE_TIMEOUT_S,
        max_retries=JUDGE_MAX_RETRIES,
    )


async def _score_target(client: AsyncOpenAI, judge_model: str, question: str, answer: str, target: str, response: str) -> dict:
    try:
        prompt = JUDGE_PROMPT.format(question=question, answer=answer, target=target, response=response)
        completion = await client.chat.completions.create(
            model=judge_model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=2048,
            temperature=0.0,
        )
        verdict = (completion.choices[0].message.content or "").strip().upper()
        if verdict not in {"VERDICT: PASS", "VERDICT: FAIL"}:
            raise ValueError("Judge returned an invalid verdict")
        passed = verdict == "VERDICT: PASS"
        return {"score": 1.0 if passed else 0.0, "verdict": "pass" if passed else "fail", "error": ""}
    except Exception as error:
        return {"score": None, "verdict": "error", "error": f"{type(error).__name__}: {error}"}


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
    global CALL_INDEX
    call_index = CALL_INDEX
    CALL_INDEX += 1
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
    example_id = _context_number(kwargs, ("example_id", "_ng_task_index"))
    rollout_index = _context_number(kwargs, ("rollout_index", "_ng_rollout_index"))
    document_id = info.get("document_id")
    events = []
    for target_index, (target, score) in enumerate(zip(targets, scores)):
        if isinstance(score, BaseException):
            item = {"score": None, "verdict": "error", "error": f"{type(score).__name__}: {score}"}
        else:
            item = score
        events.append({
            "call_index": call_index,
            "example_id": example_id,
            "rollout_index": rollout_index,
            "document_id": document_id,
            "target_index": target_index,
            "target_text": target,
            "score": item.get("score"),
            "verdict": item.get("verdict", "error"),
            "judge_model": judge_model,
            "error": item.get("error", ""),
        })
    _write_target_scores(events)
    failures = [event for event in events if event["verdict"] == "error"]
    if failures:
        raise RuntimeError(f"Judge scoring failed for {len(failures)} target(s); inspect judge connectivity and credentials.")
    hits = sum(1.0 for score in scores if isinstance(score, dict) and score.get("score") == 1.0)
    return hits / len(targets)


def _context_number(kwargs, names):
    sources = [kwargs]
    state = kwargs.get("state")
    if isinstance(state, dict):
        sources.append(state)
    for source in sources:
        for name in names:
            value = source.get(name)
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                return value
    return None


def _write_target_scores(events):
    if not TARGET_SCORES_PATH:
        return
    path = Path(TARGET_SCORES_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        for event in events:
            handle.write(json.dumps(event, ensure_ascii=False) + "\\n")


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
    pass_threshold = float(kwargs.pop("pass_threshold", ${spec.passThreshold.toFixed(2)}))
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
        pass_threshold=pass_threshold,
        **kwargs,
    )
`;
}

function pyprojectSource(spec: PiPackageSpec): string {
  return `[project]
name = "${spec.slug}"
description = ${JSON.stringify(spec.title)}
tags = ["judge-coverage", "rl"]
version = "0.1.0"
requires-python = ">=3.10"
dependencies = [
    "verifiers==0.3.0",
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
PYTHONPATH=<this directory> prime eval run ${spec.slug} \\
  --plain --provider openai --api-base-url "$POLICY_BASE_URL" \\
  --api-key-var LAB_POLICY_API_KEY --model "$POLICY_MODEL" --save-results
\`\`\`

The judge needs \`LAB_JUDGE_BASE_URL\`, \`LAB_JUDGE_API_KEY\`, and \`LAB_JUDGE_MODEL\` in the environment.
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
