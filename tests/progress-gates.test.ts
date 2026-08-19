import { describe, expect, it } from 'bun:test';
import { handoffGate, type BenchmarkRunProgress } from '../src/domain/progress/model.ts';

/** Small progress fixture for the handoff prerequisites. */
function progressWithFailureMap(entity: string | null): BenchmarkRunProgress {
  const step = (value: string | null) => ({ entity: value, count: value ? 1 : 0 });
  return {
    benchmarkRunId: 1,
    benchmarkRunCode: 'BR-00001',
    label: 'Gate test run',
    model: 'test-model',
    passRate: 0.5,
    benchmarkResult: step('BR-RESULT-00001'),
    failureMapId: entity ? 1 : null,
    failureMap: step(entity),
    topicCount: 0,
    dataForgeRun: step(null),
    environments: step(null),
  };
}

describe('handoff gates', () => {
  it('keeps the Failure map → Data forge handoff closed until a map exists', () => {
    const gate = handoffGate('forge', progressWithFailureMap(null));

    expect(gate.open).toBe(false);
    expect(gate.reason).toBe('Create a failure map before sending this run to Data forge.');
  });

  it('opens the Data forge handoff once the selected run has a map', () => {
    expect(handoffGate('forge', progressWithFailureMap('FM-00001'))).toEqual({ open: true, reason: null });
  });

  it('does not apply the Data forge prerequisite to other handoffs', () => {
    expect(handoffGate('failures', progressWithFailureMap(null))).toEqual({ open: true, reason: null });
  });

  it('keeps Env lab closed until an approved document exists', () => {
    const progress = progressWithFailureMap('FM-00001');
    progress.dataForgeRun = { entity: 'DF-00001', count: 0 };
    expect(handoffGate('env-lab', progress).open).toBe(false);

    progress.dataForgeRun.count = 1;
    expect(handoffGate('env-lab', progress)).toEqual({ open: true, reason: null });
  });
});
