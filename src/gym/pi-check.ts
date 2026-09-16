/** Opt-in developer check against the actual pinned trainer schema and installed package. */
import { config } from '../config.ts';
import { SCHEMA_PACKAGE } from './pi-training.ts';

export async function checkTrainingIntegration(packageDir: string, toml: string): Promise<string> {
  const proc = Bun.spawn(['uv', 'run', '--no-project', '--python', '3.12',
    '--with', SCHEMA_PACKAGE, '--with', 'verifiers==0.3.0', '--with', packageDir,
    'python', '-c', `import sys, tomllib
from prime_rl.configs.rl import RLConfig
import verifiers as vf
config = RLConfig.model_validate(tomllib.loads(sys.stdin.read()))
source = config.orchestrator.train.source[0]
assert config.orchestrator.group_size == source.group_size == 4
assert config.model.name == config.trainer.model.name == config.inference.model.name
assert source.legacy.args["split"] == "train"
env = vf.load_environment(source.legacy.id, **source.legacy.args)
assert len(env.dataset) > 0
import asyncio, importlib
from types import SimpleNamespace
module = importlib.import_module(source.legacy.id.replace("-", "_"))
assert module.load_environment(pass_threshold=0.3).pass_threshold == 0.3
async def reply(**kwargs):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="VERDICT: PASS"))])
client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=reply)))
module._judge_client = lambda: client
row = env.dataset[0]
assert asyncio.run(module.judge_coverage([{"content": "A and B"}], row["answer"], row["info"])) == 1.0
async def broken_reply(**kwargs):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="not a verdict"))])
client.chat.completions.create = broken_reply
try:
    asyncio.run(module.judge_coverage([{"content": "A and B"}], row["answer"], row["info"]))
except RuntimeError:
    pass
else:
    raise AssertionError("Judge failures must not become valid training rewards")
print("Trainer schema and installed training environment passed")`],
  { cwd: config.gym.root, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  proc.stdin.write(toml);
  await proc.stdin.end();
  const [out, err, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`Training integration failed: ${out}\n${err}`);
  return out;
}
