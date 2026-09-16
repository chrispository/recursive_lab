import { describe, expect, it } from 'bun:test';
import { EnvironmentInbox } from '../src/views/tabs/env-lab/EnvironmentInbox.tsx';
import { ClusterHandoffBody } from '../src/views/tabs/ClusterHandoff.tsx';
import { environmentsUi } from '../src/http/ui/environments.tsx';
import { environmentsApi } from '../src/http/api/environments.ts';
import { environmentFixture, measureFixture } from './fixtures/environment.ts';

describe('environment workflow fragments', () => {
  it('distinguishes a completed low-reward check from a failed execution', async () => {
    const env = environmentFixture({ scaleReady: false,
      rlTest: measureFixture({ meanReward: 0, rolloutsPerExample: 2 }), validation: null });
    const markup = String(await EnvironmentInbox({ environments: [env], buildJob: null, evalJob: null }));
    expect(markup).toContain('check completed');
    expect(markup).toContain('Check training signal');
    expect(markup).not.toContain('>error</');
    expect(markup).toContain('data-review-status="pending"');
  });
  it('keeps an unlearnable environment in the next-action queue', async () => {
    const env = environmentFixture({ scaleReady: false, validation: measureFixture({ withinTaskStd: 0 }) });
    const markup = String(await EnvironmentInbox({ environments: [env], buildJob: null, evalJob: null }));
    expect(markup).toContain('data-review-status="pending"');
    expect(markup).toContain('Attempts receive similar scores');
    expect(markup).toContain('Review training signal');
  });
  it('requires a checkpoint for preparation and offers a real download when prepared', async () => {
    const env = environmentFixture();
    const form = String(await ClusterHandoffBody({ environments: [env], benchmarkRun: null, validation: null }));
    expect(form).toContain('name="training_model"');
    expect(form).toContain('name="checkpoint_confirmed"');
    expect(form).toContain('hx-target="#cluster-handoff-body"');
    const download = String(await ClusterHandoffBody({ environments: [{ ...env, clusterPrepared: true }], benchmarkRun: null, validation: null }));
    expect(download).toContain(`/api/v1/environments/${env.environmentCode}/training-package`);
    expect(download).not.toContain('name="training_model"');
  });
  it('keeps the lab body and controls after a rejected build request', async () => {
    const res = await environmentsUi.handle(new Request('http://localhost/ui/env-lab/build', {
      method: 'POST', body: new URLSearchParams({ benchmark_run_id: '0' }),
    }));
    const markup = await res.text();
    expect(res.status).toBe(200);
    expect(markup).toContain('id="env-lab-body"');
    expect(markup).toContain('id="env-lab-run-form"');
    expect(markup).toContain('Select a benchmark run.');
    expect(markup).toContain('id="env-lab-handoff"');
  });
  it('rejects an invalid download identifier', async () => {
    const res = await environmentsApi.handle(new Request('http://localhost/api/v1/environments/not-an-id/training-package'));
    expect(res.status).toBe(400);
  });
});
