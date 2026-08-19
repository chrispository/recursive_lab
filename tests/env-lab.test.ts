import { describe, expect, it } from 'bun:test';
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { clusterToml, moduleName, runEval, writePackage, type PiPackageSpec } from '../src/gym/pi.ts';
import { measureOf } from '../src/domain/environments/service.ts';
import { taskOf, type BuildDocument } from '../src/domain/environments/model.ts';

const rollout = (exampleId: number, reward: number) => ({ exampleId, reward });

function spec(): PiPackageSpec {
  return {
    slug: 'provision-fact-matching-tp00001',
    title: 'Provision-Fact Matching',
    topicDescription: 'Recognize when a brief applies the same exception inconsistently.',
    verifierStrategy: 'Score observable behavior against the topic’s verifier targets.',
    passThreshold: 0.3,
    splits: {
      train: [
        {
          question: 'DOCUMENT\n\n---\n\n# Task\n\nIdentify the inconsistencies.',
          answer: 'The doctrine applies uniformly.',
          info: { verifier_targets: ['flags unit A', 'flags unit B'], title: 'Memo', topic: 'Provision-Fact Matching' },
        },
      ],
      canary: [],
      heldout: [],
    },
  };
}

describe('measureOf', () => {
  it('marks a saturated, spread-less eval as unlearnable', () => {
    const measure = measureOf([rollout(0, 1), rollout(0, 1), rollout(1, 1), rollout(1, 1)]);

    expect(measure.tasksScored).toBe(2);
    expect(measure.passRate).toBe(1);
    expect(measure.withinTaskStd).toBe(0);
    expect(measure.saturatedFraction).toBe(1);
  });

  it('keeps partial coverage and within-task spread distinct', () => {
    const measure = measureOf([rollout(0, 1), rollout(0, 0), rollout(1, 0.5)]);

    expect(measure.tasksScored).toBe(2);
    expect(measure.withinTaskStd).toBeGreaterThan(0.05);
    expect(measure.saturatedFraction).toBe(0);
    // Example 0 means 0.5 (≥ 0.3 floor), example 1 means 0.5 too.
    expect(measure.passRate).toBe(1);
  });

  it('counts an example below the floor as not passed', () => {
    const measure = measureOf([rollout(0, 0.2), rollout(0, 0.2), rollout(1, 0.9), rollout(1, 0.9)]);

    expect(measure.passRate).toBe(0.5);
    expect(measure.saturatedFraction).toBe(0);
  });

  it('returns zeros for an empty rollout set', () => {
    const measure = measureOf([]);

    expect(measure).toEqual({ passRate: 0, withinTaskStd: 0, saturatedFraction: 0, tasksScored: 0 });
  });
});

describe('taskOf', () => {
  it('places the document body before the task and hides the reference in answer', () => {
    const document: BuildDocument = {
      documentId: 1,
      topicId: 1,
      role: 'train',
      title: 'Severity Coding Memo',
      content: 'BODY TEXT',
      taskInstruction: 'Rate each issue.',
      referenceAnswer: 'S: 2, P: 1',
      verifierTargets: ['rates severity', 'justifies each rating'],
    };
    const task = taskOf(document, 'Assigning severity ratings');

    expect(task.question.startsWith('BODY TEXT')).toBe(true);
    expect(task.question.endsWith('# Task\n\nRate each issue.')).toBe(true);
    expect(task.answer).toBe('S: 2, P: 1');
    expect(task.info.verifier_targets).toHaveLength(2);
    expect(task.info.topic).toBe('Assigning severity ratings');
  });
});

describe('writePackage', () => {
  it('writes a syntactically valid python module and the three splits', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'env-pkg-'));
    const files = await writePackage(dir, spec());

    expect(moduleName('provision-fact-matching-tp00001')).toBe('provision_fact_matching_tp00001');
    expect(files.map((file) => file.split('/').pop()).sort()).toEqual(
      ['README.md', 'pyproject.toml', 'canary.jsonl', 'heldout.jsonl', 'train.jsonl', 'provision_fact_matching_tp00001.py'].sort(),
    );

    const rows = (await readFile(join(dir, 'taskset/train.jsonl'), 'utf8')).trim().split('\n');
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!).info.verifier_targets).toHaveLength(2);
    expect(await readFile(join(dir, 'taskset/canary.jsonl'), 'utf8')).toBe('\n');

    const python = await readFile(join(dir, `${moduleName(spec().slug)}.py`), 'utf8');
    expect(python).toContain('def load_environment(**kwargs):');
    expect(python).toContain('split = str(kwargs.pop("split", "train"))');
    expect(python).toContain('rows = _load_split(split)');
    expect(python).toContain('pass_threshold=0.30');
    expect(python).not.toContain('${');
    const proc = Bun.spawn(['python3', '-c', 'import ast, sys; ast.parse(sys.stdin.read())'], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    proc.stdin.write(python);
    await proc.stdin.end();
    expect(await proc.exited).toBe(0);
  });

  it('keeps the cluster TOML a pass-through of the package facts', () => {
    const toml = clusterToml(spec(), 'glm-5.2', 'gpt-5.2-mini', 4);

    expect(toml).toContain('name = "provision-fact-matching-tp00001"');
    expect(toml).toContain('pass_threshold = 0.30');
    expect(toml).toContain('inference_model = "glm-5.2"');
    expect(toml).toContain('train = 1');
  });
});

describe('runEval', () => {
  it('reads Prime results from the nested run directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pi-eval-'));
    const envDir = join(dir, 'environment');
    const outputDir = join(dir, 'results');
    const fakePrime = join(dir, 'prime');
    const envId = 'provision-fact-matching-tp00001';
    await mkdir(envDir);
    await writeFile(fakePrime, `#!${process.execPath}
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const args = process.argv.slice(2);
const outputDir = args[args.indexOf('--output-dir') + 1];
const envId = args[2];
const runDir = join(outputDir, 'evals', envId + '--glm-5.2', 'abc123');
await mkdir(runDir, { recursive: true });
await writeFile(join(runDir, 'results.jsonl'), JSON.stringify({ example_id: 0, reward: 0.75, error: null }) + '\\n');
await writeFile(join(runDir, 'metadata.json'), JSON.stringify({ avg_reward: 0.75, pass_at_k: { '1': 1 }, time: 1 }));
`, 'utf8');
    await chmod(fakePrime, 0o755);

    const previousPrime = process.env.PRIME_BIN;
    process.env.PRIME_BIN = fakePrime;
    try {
      const outcome = await runEval({
        envId,
        envDir,
        model: 'glm-5.2',
        baseUrl: 'https://policy.invalid/v1',
        apiKeyVar: 'LAB_POLICY_API_KEY',
        apiKey: 'policy-key',
        judge: { baseUrl: 'https://judge.invalid/v1', apiKey: 'judge-key', model: 'judge' },
        numExamples: 1,
        rolloutsPerExample: 1,
        maxConcurrent: 1,
        outputDir,
        timeoutMs: 10_000,
        split: 'train',
      });

      expect(outcome.avgReward).toBe(0.75);
      expect(outcome.rollouts).toEqual([{ exampleId: 0, reward: 0.75, error: null }]);
      expect(outcome.resultsPath).toEndWith('/evals/provision-fact-matching-tp00001--glm-5.2/abc123/results.jsonl');
    } finally {
      if (previousPrime === undefined) delete process.env.PRIME_BIN;
      else process.env.PRIME_BIN = previousPrime;
    }
  });

  it('records Prime failures in a removable diagnostic sidecar', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pi-eval-failure-'));
    const envDir = join(dir, 'environment');
    const outputDir = join(dir, 'results');
    const fakePrime = join(dir, 'prime');
    const envId = 'provision-fact-matching-tp00001';
    await mkdir(envDir);
    await writeFile(fakePrime, `#!${process.execPath}
console.error('fake prime diagnostic failure');
process.exitCode = 7;
`, 'utf8');
    await chmod(fakePrime, 0o755);

    const previousPrime = process.env.PRIME_BIN;
    process.env.PRIME_BIN = fakePrime;
    try {
      let failure: unknown;
      try {
        await runEval({
          envId,
          envDir,
          model: 'glm-5.2',
          baseUrl: 'https://policy.invalid/v1',
          apiKeyVar: 'LAB_POLICY_API_KEY',
          apiKey: 'policy-key',
          judge: { baseUrl: 'https://judge.invalid/v1', apiKey: 'judge-key', model: 'judge' },
          numExamples: 1,
          rolloutsPerExample: 1,
          maxConcurrent: 1,
          outputDir,
          timeoutMs: 10_000,
          split: 'train',
        });
      } catch (error) {
        failure = error;
      }

      const diagnostic = await readFile(
        join(outputDir, 'diagnostics', `${envId}-train-prime.log`),
        'utf8',
      );
      expect(String(failure)).toContain('code 7');
      expect(String(failure)).toContain('Prime diagnostics:');
      expect(diagnostic).toContain('fake prime diagnostic failure');
      expect(diagnostic).toContain('process exited code=7');
    } finally {
      if (previousPrime === undefined) delete process.env.PRIME_BIN;
      else process.env.PRIME_BIN = previousPrime;
    }
  });
});
