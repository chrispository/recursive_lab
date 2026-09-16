import { code } from '../../src/db/ids.ts';
import type { EnvironmentRow, EnvironmentMeasure } from '../../src/domain/environments/model.ts';
import type { PiPackageSpec } from '../../src/gym/pi-package.ts';

export function packageFixture(): PiPackageSpec {
  return { slug: 'lab-training-test', title: 'Training test', topicDescription: 'Test evidence',
    verifierStrategy: 'Check both targets', passThreshold: 0.3, splits: {
      train: [{ question: 'Which units conflict?', answer: 'A and B', info: {
        verifier_targets: ['identifies A', 'identifies B'], title: 'Memo', topic: 'Training test', document_id: 1,
      } }], canary: [], heldout: [],
    } };
}

export function measureFixture(patch: Partial<EnvironmentMeasure> = {}): EnvironmentMeasure {
  return { meanReward: 0.5, passRate: 1, withinTaskStd: 0.2, saturatedFraction: 0,
    tasksScored: 1, rolloutsPerExample: 4, error: null,
    evidence: { evaluationId: 1, packageHash: 'built-hash', model: 'policy', endpointLabel: 'policy.invalid',
      judgeModel: 'judge', judgeEndpointLabel: 'judge.invalid' }, ...patch };
}

export function environmentFixture(patch: Partial<EnvironmentRow> = {}): EnvironmentRow {
  return { environmentId: 1, environmentCode: code('environments', 1), topicId: 1, topicCode: code('topics', 1),
    topicName: 'Training test', topicDescription: 'Test evidence', verifierStrategy: 'Check both targets',
    slug: 'lab-training-test', status: 'built', baseModel: 'policy', inferenceModel: 'policy',
    verifierName: 'Judge coverage', passThreshold: 0.3, localPath: null, packageHash: 'built-hash', packageVersion: 2,
    scaleReady: true, clusterPrepared: false, taskCounts: { tasks: 1, train: 1, canary: 0, heldout: 0 },
    rlTest: measureFixture({ rolloutsPerExample: 2 }), validation: measureFixture(), ...patch };
}
