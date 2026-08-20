import { describe, expect, it } from 'bun:test';
import type { GymHealth, GymServer } from '../src/gym/head.ts';
import { GymPairError, pickAgent, pickModelType, pickResources } from '../src/gym/servers.ts';

function server(overrides: Partial<GymServer> = {}): GymServer {
  return {
    processName: 'test_resources',
    name: 'test',
    serverType: 'resources_servers',
    url: 'http://127.0.0.1:14000',
    port: 14000,
    pid: 1000,
    dirPath: '/tmp/test',
    healthy: true,
    ...overrides,
  };
}

function healthOf(servers: GymServer[]): GymHealth {
  return {
    reachable: true,
    headUrl: 'http://127.0.0.1:11000',
    servers,
    error: '',
  };
}

describe('pickResources', () => {
  it('matches exact processName when preferred is specified', () => {
    const s = server({ processName: 'legal_agent_bench_benchmark_resources_server', name: 'legal_agent_bench' });
    const health = healthOf([s]);
    expect(pickResources(health, 'legal_agent_bench_benchmark_resources_server')).toEqual(s);
  });

  it('matches component name as single fallback candidate', () => {
    const s = server({ processName: 'legal_agent_bench_benchmark_resources_server', name: 'legal_agent_bench' });
    const health = healthOf([s]);
    expect(pickResources(health, 'legal_agent_bench')).toEqual(s);
  });

  it('matches processName prefix as single fallback candidate', () => {
    const s = server({ processName: 'swebench_benchmark_resources_server', name: 'swebench' });
    const health = healthOf([s]);
    expect(pickResources(health, 'swebench')).toEqual(s);
  });

  it('throws GymPairError when multiple fallback candidates match preferred name/prefix', () => {
    const s1 = server({ processName: 'swebench_lite_resources_server', name: 'swebench' });
    const s2 = server({ processName: 'swebench_verified_resources_server', name: 'swebench' });
    const health = healthOf([s1, s2]);
    expect(() => pickResources(health, 'swebench')).toThrow(GymPairError);
    expect(() => pickResources(health, 'swebench')).toThrow(/Multiple gym resources servers match swebench/);
  });

  it('throws GymPairError when no healthy resources match preferred', () => {
    const s = server({ processName: 'other_server', name: 'other' });
    const health = healthOf([s]);
    expect(() => pickResources(health, 'missing_bench')).toThrow(GymPairError);
    expect(() => pickResources(health, 'missing_bench')).toThrow(/not healthy/);
  });

  it('picks the single healthy server when preferred is not set', () => {
    const s = server({ processName: 'only_server', name: 'only' });
    const health = healthOf([s]);
    expect(pickResources(health)).toEqual(s);
  });

  it('throws GymPairError when preferred is not set and multiple servers are running', () => {
    const s1 = server({ processName: 's1' });
    const s2 = server({ processName: 's2' });
    const health = healthOf([s1, s2]);
    expect(() => pickResources(health)).toThrow(GymPairError);
    expect(() => pickResources(health)).toThrow(/Multiple gym resources servers are running/);
  });

  it('throws GymPairError when no healthy servers are running', () => {
    const s = server({ processName: 'unhealthy', healthy: false });
    const health = healthOf([s]);
    expect(() => pickResources(health)).toThrow(GymPairError);
    expect(() => pickResources(health)).toThrow(/No healthy gym resources server/);
  });
});

describe('pickAgent', () => {
  const resources = server({
    processName: 'legal_agent_bench_benchmark_resources_server',
    name: 'legal_agent_bench',
  });

  it('picks agent by exact convention name', () => {
    const agent = server({
      processName: 'legal_agent_bench_benchmark_resources_server_harbor_agent',
      serverType: 'responses_api_agents',
    });
    const health = healthOf([resources, agent]);
    expect(pickAgent(health, resources)).toEqual(agent);
  });

  it('picks agent by stem harbor_agent convention', () => {
    const agent = server({
      processName: 'legal_agent_bench_benchmark_harbor_agent',
      serverType: 'responses_api_agents',
    });
    const health = healthOf([resources, agent]);
    expect(pickAgent(health, resources)).toEqual(agent);
  });

  it('throws GymPairError when multiple prefix candidates match agent', () => {
    const a1 = server({
      processName: 'legal_agent_bench_benchmark_harbor_agent_v1',
      serverType: 'responses_api_agents',
    });
    const a2 = server({
      processName: 'legal_agent_bench_benchmark_harbor_agent_v2',
      serverType: 'responses_api_agents',
    });
    const health = healthOf([resources, a1, a2]);
    expect(() => pickAgent(health, resources)).toThrow(GymPairError);
    expect(() => pickAgent(health, resources)).toThrow(/Multiple gym agents match/);
  });

  it('falls back to single running agent if no prefix matches', () => {
    const agent = server({
      processName: 'custom_agent',
      serverType: 'responses_api_agents',
    });
    const health = healthOf([resources, agent]);
    expect(pickAgent(health, resources)).toEqual(agent);
  });

  it('throws GymPairError when no healthy agents exist', () => {
    const health = healthOf([resources]);
    expect(() => pickAgent(health, resources)).toThrow(GymPairError);
    expect(() => pickAgent(health, resources)).toThrow(/No healthy agent/);
  });
});

describe('pickModelType', () => {
  it('returns component name of single healthy model server', () => {
    const model = server({
      processName: 'policy_model',
      name: 'vllm_model',
      serverType: 'responses_api_models',
    });
    const health = healthOf([model]);
    expect(pickModelType(health)).toBe('vllm_model');
  });

  it('throws when no model server is healthy', () => {
    const health = healthOf([]);
    expect(() => pickModelType(health)).toThrow(GymPairError);
    expect(() => pickModelType(health)).toThrow(/No healthy gym model server/);
  });

  it('throws when multiple model servers are running', () => {
    const m1 = server({ processName: 'm1', name: 'vllm_model', serverType: 'responses_api_models' });
    const m2 = server({ processName: 'm2', name: 'openai_model', serverType: 'responses_api_models' });
    const health = healthOf([m1, m2]);
    expect(() => pickModelType(health)).toThrow(GymPairError);
    expect(() => pickModelType(health)).toThrow(/Multiple gym model servers are running/);
  });
});
