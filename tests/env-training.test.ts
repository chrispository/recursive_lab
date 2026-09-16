import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { trainingGates, trainingReady } from '../src/domain/environments/model.ts';
import { hashFiles, verifiedPackage } from '../src/gym/pi-artifact.ts';
import { writePackage } from '../src/gym/pi-package.ts';
import { clusterToml, prepareTrainingExport, trainingExportPath, verifyTrainingExport } from '../src/gym/pi-training.ts';
import { checkTrainingIntegration } from '../src/gym/pi-check.ts';
import { environmentFixture, measureFixture, packageFixture } from './fixtures/environment.ts';

describe('training readiness', () => {
  const ready = (measure = measureFixture(), count = 1, hash = 'built-hash') => trainingReady(measure, 0.3, count, hash);
  it('requires complete, current package evidence, not just a historical passing flag', () => {
    expect(ready()).toBe(true);
    expect(ready(measureFixture({ evidence: undefined }))).toBe(false);
    expect(ready(measureFixture(), 1, 'changed')).toBe(false);
    expect(ready(measureFixture(), 2)).toBe(false);
    expect(ready(measureFixture({ rolloutsPerExample: 2 }))).toBe(false);
    expect(ready(measureFixture({ error: 'judge unavailable' }))).toBe(false);
    expect(ready(measureFixture({ meanReward: 0 }))).toBe(false);
    expect(ready(measureFixture({ withinTaskStd: 0 }))).toBe(false);
    expect(ready(measureFixture({ saturatedFraction: 1 }))).toBe(false);
  });
  it('gives useful advice for failed screening rules', () => {
    const failed = trainingGates(measureFixture({ withinTaskStd: 0 }), 0.3).filter((gate) => !gate.passed);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.advice).toContain('similar scores');
  });
  it('clears persisted readiness and rejects cancelled or superseded approvals', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lab-readiness-db-'));
    try {
      const proc = Bun.spawn([process.execPath, 'tests/fixtures/readiness-repo.ts'], {
        env: { ...process.env, DATABASE_URL: `file:${join(dir, 'lab.db')}` }, stdout: 'pipe', stderr: 'pipe',
      });
      const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      if (code !== 0) throw new Error(`${out}\n${err}`);
      expect(out).toContain('transitions passed');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe('training export', () => {
  it('sets a trainable model and four attempts in the trainer config', () => {
    const config = Bun.TOML.parse(clusterToml(packageFixture(), 'org/model')) as any;
    expect(config.model.name).toBe('org/model');
    expect(config.orchestrator.group_size).toBe(4);
    expect(config.orchestrator.train.source[0].legacy.args.split).toBe('train');
    expect(config.lab).toBeUndefined();
  });
  it('exports exact files, preserves validation identity, and rejects changed packages or archives', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lab-training-export-'));
    try {
      const paths = await writePackage(dir, packageFixture());
      const packageHash = await hashFiles(paths);
      const validation = measureFixture();
      validation.evidence!.packageHash = packageHash;
      const env = environmentFixture({ localPath: dir, packageHash, validation });
      const toml = await prepareTrainingExport(env, 'org/model');
      expect(await prepareTrainingExport(env, 'org/model')).toBe(toml);
      await expect(prepareTrainingExport(env, 'other/model')).rejects.toThrow('different checkpoint');
      const manifest = JSON.parse(await readFile(join(dir, 'exports/validation-1/training-package/manifest.json'), 'utf8'));
      expect(manifest.validation).toEqual(validation.evidence);
      expect(manifest.files['taskset/train.jsonl']).toHaveLength(64);
      expect(await readFile(join(dir, 'exports/validation-1/training-package/taskset/train.jsonl'), 'utf8'))
        .toBe(await readFile(join(dir, 'taskset/train.jsonl'), 'utf8'));
      expect((await verifyTrainingExport(env)).length).toBeGreaterThan(100);
      await writeFile(trainingExportPath(env), 'changed');
      await expect(verifyTrainingExport(env)).rejects.toThrow('changed');
      await writeFile(join(dir, 'taskset/train.jsonl'), 'changed');
      await expect(verifiedPackage(dir, env.slug, packageHash)).rejects.toThrow('changed');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  // Opt in: installs an isolated CPU-only schema environment and a wheel of the fixture.
  it.skipIf(process.env.PRIME_SCHEMA_CHECK !== '1')('loads the config and installed package with pinned Prime RL', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lab-training-install-'));
    try {
      await writePackage(dir, packageFixture());
      expect(await checkTrainingIntegration(dir, clusterToml(packageFixture(), 'Qwen/Qwen3-0.6B'))).toContain('passed');
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 180_000);
});
