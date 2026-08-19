import { all, db, one, type Row } from '../../db/client.ts';
import type { FailureCandidate, FailureMapOutput } from './model.ts';

type CandidateDb = Row & {
  criterion_result_id: number;
  benchmark_result_id: number;
  task_id: string;
  trial_name: string;
  criterion_id: string;
  criterion_title: string;
  reasoning: string;
  source_json: string;
};

type MapDb = Row & { failure_map_id: number; benchmark_result_id: number };

export async function benchmarkResultIdForRun(benchmarkRunId: number): Promise<number | null> {
  const row = await one<Row & { benchmark_result_id: number }>(
    `SELECT id AS benchmark_result_id
       FROM benchmark_results
      WHERE benchmark_run_id = ?`,
    [benchmarkRunId],
  );
  return row?.benchmark_result_id ?? null;
}

export async function listCandidates(benchmarkRunId: number): Promise<FailureCandidate[]> {
  const rows = await all<CandidateDb>(
    `SELECT c.id AS criterion_result_id, r.id AS benchmark_result_id,
            c.task_id, c.trial_name, c.criterion_id, c.criterion_title,
            c.reasoning, c.source_json
       FROM criterion_results c
       JOIN task_results tr ON tr.id = c.task_result_id AND tr.task_id = c.task_id
       JOIN benchmark_results r ON r.id = tr.benchmark_result_id
      WHERE r.benchmark_run_id = ? AND c.result = 'fail'
      ORDER BY c.task_id ASC, tr.id ASC, c.id ASC`,
    [benchmarkRunId],
  );
  return rows.map((row) => ({
    criterionResultId: row.criterion_result_id,
    benchmarkResultId: row.benchmark_result_id,
    taskId: row.task_id,
    trialName: row.trial_name,
    criterionId: row.criterion_id,
    criterionTitle: row.criterion_title,
    reasoning: row.reasoning,
    sourceJson: row.source_json,
  }));
}

export async function findByRun(benchmarkRunId: number): Promise<MapDb | null> {
  return one<MapDb>(
    `SELECT fm.id AS failure_map_id, fm.benchmark_result_id
       FROM failure_maps fm
       JOIN benchmark_results r ON r.id = fm.benchmark_result_id
      WHERE r.benchmark_run_id = ?`,
    [benchmarkRunId],
  );
}

export async function saveAnalysis(input: {
  benchmarkResultId: number;
  promptRevisionId: number;
  providerModel: string;
  usage: Record<string, unknown>;
  rawOutput: Record<string, unknown>;
  candidates: FailureCandidate[];
  output: FailureMapOutput;
}): Promise<{ failureMapId: number; topicIds: Map<string, number> }> {
  const tx = await db.transaction('write');
  try {
    const at = new Date().toISOString();
    const mapResult = await tx.execute({
      sql: `INSERT INTO failure_maps
              (benchmark_result_id, prompt_revision_id, provider_model, usage_json, raw_output_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        input.benchmarkResultId,
        input.promptRevisionId,
        input.providerModel,
        JSON.stringify(input.usage),
        JSON.stringify(input.rawOutput),
        at,
        at,
      ],
    });
    const failureMapId = Number(mapResult.lastInsertRowid);
    const topicIds = new Map<string, number>();

    for (const topic of input.output.topics) {
      const topicResult = await tx.execute({
        sql: `INSERT INTO topics
                (failure_map_id, name, slug, description, verifier_strategy, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
        args: [failureMapId, topic.name, topic.slug, topic.description, topic.verifierStrategy, at, at],
      });
      topicIds.set(topic.slug, Number(topicResult.lastInsertRowid));
    }

    const byFailureId = new Map(
      input.candidates.map((candidate) => [`CR-${String(candidate.criterionResultId).padStart(5, '0')}`, candidate]),
    );
    for (const topic of input.output.topics) {
      const topicId = topicIds.get(topic.slug);
      if (!topicId) throw new Error(`Topic ${topic.slug} was not written.`);
      for (const failureId of topic.failureIds) {
        const candidate = byFailureId.get(failureId);
        if (!candidate) throw new Error(`Unknown failure ${failureId}.`);
        await tx.execute({
          sql: `INSERT INTO failure_items
                  (failure_map_id, benchmark_result_id, criterion_result_id, topic_id,
                   task_id, trial_name, criterion_id, criterion_title, reasoning,
                   capability, severity, status, occurrences, source_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'medium', 'open', 1, ?, ?, ?)`,
          args: [
            failureMapId,
            input.benchmarkResultId,
            candidate.criterionResultId,
            topicId,
            candidate.taskId,
            candidate.trialName,
            candidate.criterionId,
            candidate.criterionTitle,
            candidate.reasoning,
            topic.description,
            candidate.sourceJson || '{}',
            at,
            at,
          ],
        });
      }
    }

    await tx.commit();
    return { failureMapId, topicIds };
  } catch (error) {
    await tx.rollback().catch(() => undefined);
    throw error;
  }
}
