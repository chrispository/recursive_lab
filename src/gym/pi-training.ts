/** Portable training handoff for the pinned Prime RL legacy environment bridge. */
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { EnvironmentRow } from '../domain/environments/model.ts';
import type { PiPackageSpec } from './pi-package.ts';
import { sha256, verifiedPackage } from './pi-artifact.ts';

export const PRIME_RL_REVISION = '60bc29547a8824ad1de7b9af8d265e2b27b2a72d'; // v0.8.0
export const SCHEMA_PACKAGE = `prime-rl-configs @ git+https://github.com/PrimeIntellect-ai/prime-rl.git@${PRIME_RL_REVISION}#subdirectory=packages/prime-rl-configs`;

/** Four attempts are an actual trainer setting, not lab-only metadata. */
export function clusterToml(spec: Pick<PiPackageSpec, 'slug' | 'passThreshold'>, model: string, _judgeModel = '', rollouts = 4): string {
  if (!model.trim()) throw new Error('A trainable checkpoint is required.');
  if (rollouts !== 4) throw new Error('Training requires four rollouts per task.');
  return `# Prime RL v0.8.0 (${PRIME_RL_REVISION}). See TRAINING.md.
max_steps = 20
seq_len = 8192

[model]
name = ${JSON.stringify(model)}

[deployment]
type = "single_node"
num_train_gpus = 1
num_infer_gpus = 1

[orchestrator]
batch_size = 32
group_size = 4

[orchestrator.train.sampling]
max_completion_tokens = 2048
temperature = 1.0

[[orchestrator.train.source]]
name = ${JSON.stringify(spec.slug)}
legacy.id = ${JSON.stringify(spec.slug)}
legacy.args = { split = "train" }
# Packaged reward floor: ${spec.passThreshold}

[trainer.optim]
lr = 0.000001

[ckpt]

[inference]
`;
}

const exportDirectory = (env: EnvironmentRow) => resolve(env.localPath!, 'exports', `validation-${env.validation!.evidence!.evaluationId}`);
export const trainingExportPath = (env: EnvironmentRow) => resolve(exportDirectory(env), 'training-package.tar.gz');

export async function prepareTrainingExport(environment: EnvironmentRow, model: string): Promise<string> {
  const evidence = environment.validation?.evidence;
  if (!environment.scaleReady || !evidence?.packageHash) throw new Error('A current passing validation is required.');
  if (!environment.taskCounts.train) throw new Error('This environment has no training tasks.');
  const files = await verifiedPackage(environment.localPath!, environment.slug, evidence.packageHash);
  const toml = clusterToml(environment, model);
  const destination = exportDirectory(environment);
  const existing = await readFile(resolve(destination, 'cluster.toml'), 'utf8').catch(() => null);
  if (existing !== null) {
    if (existing !== toml) throw new Error('This validation already has an export for a different checkpoint. Validate again to create another export.');
    await verifyTrainingExport(environment);
    return toml;
  }
  await mkdir(resolve(destination, '..'), { recursive: true });
  const staging = await mkdtemp(resolve(destination, '..', '.preparing-'));
  const bundle = resolve(staging, 'training-package');
  await mkdir(bundle);
  for (const [name, data] of files) {
    const path = resolve(bundle, name);
    await mkdir(resolve(path, '..'), { recursive: true });
    await writeFile(path, data, { flag: 'wx' });
  }
  const extras = new Map([
    ['cluster.toml', toml],
    ['validate.py', await readFile(resolve(import.meta.dir, 'pi_validate.py'), 'utf8')],
    ['TRAINING.md', trainingInstructions(environment, model)],
  ]);
  for (const [name, data] of extras) {
    files.set(name, Buffer.from(data));
    await writeFile(resolve(bundle, name), data, { flag: 'wx' });
  }
  const manifest = JSON.stringify({ format: 1, primeRlRevision: PRIME_RL_REVISION, verifiers: '0.3.0',
    environment: environment.environmentCode, slug: environment.slug, trainingModel: model,
    validation: evidence, metrics: environment.validation, splits: environment.taskCounts,
    files: Object.fromEntries([...files].map(([name, data]) => [name, sha256(data)])),
  }, null, 2) + '\n';
  await writeFile(resolve(bundle, 'manifest.json'), manifest, { flag: 'wx' });
  const archive = resolve(staging, 'training-package.tar.gz');
  const proc = Bun.spawn(['tar', '-czf', archive, '-C', staging, 'training-package'], { stdout: 'ignore', stderr: 'pipe' });
  if (await proc.exited !== 0) throw new Error(`Unable to archive training package: ${await new Response(proc.stderr).text()}`);
  await writeFile(resolve(staging, 'archive.sha256'), sha256(await readFile(archive)), { flag: 'wx' });
  await writeFile(resolve(staging, 'cluster.toml'), toml, { flag: 'wx' });
  await rename(staging, destination);
  return toml;
}

export async function verifyTrainingExport(environment: EnvironmentRow) {
  const dir = exportDirectory(environment);
  const bytes = await readFile(trainingExportPath(environment));
  const expected = await readFile(resolve(dir, 'archive.sha256'), 'utf8');
  if (sha256(bytes) !== expected) throw new Error('Training archive changed after preparation. Validate again before exporting.');
  return bytes;
}

function trainingInstructions(env: EnvironmentRow, model: string) {
  const evidence = env.validation!.evidence!;
  return `# Training package: ${env.topicName}

This export does not upload anything or start a training job.
It contains the exact tasks and grader checked in validation ${evidence.evaluationId}.
Validated policy: ${evidence.model} (${evidence.endpointLabel}).
Trainable checkpoint confirmed by the operator: ${model}.
Judge: ${evidence.judgeModel} (${evidence.judgeEndpointLabel}).

## Prepare your GPU host

Use Prime RL v0.8.0, commit ${PRIME_RL_REVISION}, with verifiers==0.3.0.
Follow that revision's installation instructions, including its submodules and GPU dependencies.
Do not upgrade verifiers independently: this package uses its legacy environment API.
Copy and extract this archive on the GPU host. Install it into the Prime RL environment:

    uv pip install --python /path/to/prime-rl/.venv/bin/python verifiers==0.3.0 /path/to/training-package

Provide LAB_JUDGE_BASE_URL, LAB_JUDGE_API_KEY and LAB_JUDGE_MODEL to the environment
workers through your cluster's secret mechanism. The base URL and model must match
the validation above. Never put the key in this archive or commit it to source control.
The judge endpoint must be reachable from the workers. Each rollout makes one policy
call plus one judge call per verifier target, before retries.

## Verify before spending GPU time

From the extracted package directory, using the Prime RL Python environment:

    /path/to/prime-rl/.venv/bin/python validate.py

This verifies file checksums, the pinned versions, the actual Prime RL config schema,
the installed environment and its training split. It does not call a model or launch training.
The validation manifest records the local evidence; passing these checks does not prove
the checkpoint fits your GPUs or that training will improve it.

## Launch a small training run

The supplied config is a 20-step starting run: 32 rollouts per batch, four attempts per
task, one trainer GPU and one inference GPU. Check model memory requirements first.
From your pinned Prime RL checkout, with judge secrets available to its workers:

    uv run --no-sync rl @ /path/to/training-package/cluster.toml

Only train.jsonl feeds optimizer updates. Canary and heldout files remain in the archive;
the starter config does not run them automatically. Evaluate heldout after training to
measure improvement without adding those examples to the training dataset.
For multiple nodes, adapt the pinned release's deployment/SLURM configuration to your
cluster and validate the resulting config. Changes create a new training recipe and
should be recorded separately from this original export.
`;
}
