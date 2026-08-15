/**
 * Turning a finished gym eval into rows.
 *
 * This is the back half of a benchmark run: the process has exited, and what
 * is left is reading its rollouts and writing `benchmark_results`,
 * `task_results` and `criterion_results` under it. It is separate from
 * `service.ts` because it is a different job — that file decides what to run
 * and watches it run; this one only reconciles what came back against what was
 * asked for.
 *
 * The reconciliation is the point. Gym is free to return rollouts for tasks
 * nobody asked for, to reuse a trial name, or to return nothing at all for a
 * task; each of those is recorded rather than allowed to crash or to quietly
 * change what the run claims it measured.
 */
import * as gymResults from '../../gym/results.ts';
import * as benchmarks from '../benchmarks/service.ts';
import type * as jobs from '../jobs/trace.ts';
import { ROLLOUT_SHARE } from './model.ts';
import * as repo from './repo.ts';
import { saving } from './steps.ts';

/** How every trial of one task turned out. Rolled up into one task outcome. */
type TaskTally = { passed: number; failed: number; error: number };

/**
 * The one line of an error worth putting in the ledger.
 *
 * Harness errors arrive as Python tracebacks relayed through Ray, where the
 * first line is the wrapper (`RayTaskError(ValueError): ray::runner_ray_remote()`)
 * and the *last* is the exception that actually explains the run. Logging the
 * first line reproduces the traceback's least useful part; the full text stays
 * on the task row and in the trial directory either way.
 */
function headline(error: string): string {
  const lines = error.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? '';
}

/**
 * One task's verdict across its trials.
 *
 * A task with any errored trial is an error — the run cannot claim it graded
 * that task. Otherwise any failed trial makes the task failed, since a task
 * that passes only sometimes has not been passed. No trials at all is skipped.
 */
function taskOutcome(tally: TaskTally | undefined): 'passed' | 'failed' | 'error' | 'skipped' {
  if (!tally) return 'skipped';
  if (tally.error) return 'error';
  if (tally.failed) return 'failed';
  if (tally.passed) return 'passed';
  return 'skipped';
}

export async function ingest(
  work: { benchmarkRunId: number; benchmarkId: number; taskIds: string[]; trace: jobs.Trace },
  outputPath: string,
): Promise<void> {
  await work.trace.step(saving(), ROLLOUT_SHARE);
  const rollouts = await gymResults.read(outputPath);
  await work.trace.log(`rollouts              ${rollouts.length}`);

  const catalog = await benchmarks.criteriaFor(work.benchmarkId, work.taskIds);
  const byTask = new Map<string, Map<string, (typeof catalog)[number]>>();
  for (const row of catalog) {
    let inner = byTask.get(row.taskId);
    if (!inner) {
      inner = new Map();
      byTask.set(row.taskId, inner);
    }
    inner.set(row.criterionId, row);
  }

  const requested = new Set(work.taskIds);
  /** Trial names already used per task — `task_results` is unique on that pair. */
  const usedTrials = new Set<string>();
  /** Per-task trial outcomes, which is what the run-level rollup counts. */
  const tallies = new Map<string, TaskTally>();
  const counts = { rollouts: 0, criteria: 0, criteriaPassed: 0, criteriaFailed: 0 };

  const expected = work.taskIds.length;
  const resultId = await repo.insertResult({
    benchmarkRunId: work.benchmarkRunId,
    benchmarkId: work.benchmarkId,
    result: 'error',
    tasksTotal: expected,
    tasksPassed: 0,
    tasksFailed: 0,
    tasksError: 0,
    tasksSkipped: 0,
    criteriaTotal: 0,
    criteriaPassed: 0,
    criteriaFailed: 0,
    passRate: null,
    reward: null,
    resultPath: outputPath,
    metrics: {},
  });

  for (const rollout of rollouts) {
    // A rollout for a task this run never asked for cannot be stored — the
    // task_results FK is to the catalog. Say so rather than crash on the FK.
    if (!requested.has(rollout.taskId)) {
      await work.trace.log(`unrequested task      ${rollout.taskId} (rollout discarded)`, 'err');
      continue;
    }

    // Gym repeats a task by rollout index. When it does not label the repeats
    // distinctly, keep them apart here rather than let the unique constraint
    // silently reduce N trials to one.
    let trialName = rollout.trialName;
    for (let n = 2; usedTrials.has(`${rollout.taskId}\0${trialName}`); n += 1) {
      trialName = `${rollout.trialName}-${n}`;
      if (n === 2) {
        await work.trace.log(
          `duplicate trial name  ${rollout.taskId} ${rollout.trialName} → ${trialName}`,
          'err',
        );
      }
    }
    usedTrials.add(`${rollout.taskId}\0${trialName}`);
    counts.rollouts += 1;

    // The reason a rollout produced no verdict belongs in the ledger. It is
    // stored on the task row either way, but a run that graded nothing is read
    // from the log, and silence there sends you to the model for an answer that
    // is not in the model.
    if (rollout.error) {
      await work.trace.log(`rollout error         ${rollout.taskId} ${trialName}: ${headline(rollout.error)}`, 'err');
    }

    const tally = tallies.get(rollout.taskId) ?? { passed: 0, failed: 0, error: 0 };
    if (rollout.result !== 'skipped') tally[rollout.result] += 1;
    tallies.set(rollout.taskId, tally);

    const taskResultId = await repo.insertTaskResult({
      benchmarkResultId: resultId,
      benchmarkId: work.benchmarkId,
      taskId: rollout.taskId,
      trialName,
      result: rollout.result,
      reward: rollout.reward,
      criteriaTotal: rollout.criteria.length,
      criteriaPassed: rollout.criteria.filter((item) => item.result === 'pass').length,
      criteriaFailed: rollout.criteria.filter((item) => item.result === 'fail').length,
      resultPath: rollout.trialDir,
      metrics: { error: rollout.error },
    });

    const catalogForTask = byTask.get(rollout.taskId);
    for (const criterion of rollout.criteria) {
      const ref = catalogForTask?.get(criterion.criterionId);
      if (!ref) {
        await work.trace.log(`unmatched criterion   ${rollout.taskId} ${criterion.criterionId}`, 'err');
        continue;
      }
      counts.criteria += 1;
      if (criterion.result === 'pass') counts.criteriaPassed += 1;
      if (criterion.result === 'fail') counts.criteriaFailed += 1;
      await repo.insertCriterionResult({
        taskResultId,
        catalogCriterionId: ref.id,
        taskId: rollout.taskId,
        trialName,
        criterionId: criterion.criterionId,
        title: criterion.title || ref.title,
        result: criterion.result,
        reasoning: criterion.reasoning,
        matchCriteria: ref.matchCriteria,
        judgeModel: criterion.judgeModel,
        judgeError: criterion.judgeError,
        errorType: criterion.errorType,
      });
    }
  }

  // A task the run asked for but gym never returned still gets a row, so the
  // ledger says what happened to every task the run intended to execute.
  for (const taskId of work.taskIds) {
    if (tallies.has(taskId)) continue;
    await repo.insertTaskResult({
      benchmarkResultId: resultId,
      benchmarkId: work.benchmarkId,
      taskId,
      trialName: 'trial-1',
      result: 'skipped',
      reward: null,
      criteriaTotal: 0,
      criteriaPassed: 0,
      criteriaFailed: 0,
      resultPath: null,
      metrics: {},
    });
  }

  // Roll trials up into tasks *before* counting. `tasks_*` are task counts and
  // must sum to `tasks_total`; counting rollouts here made a passing run with
  // repeats > 1 record itself as failed, because N passing trials of one task
  // never equal the one task that was asked for.
  const tasks = { passed: 0, failed: 0, error: 0, skipped: 0 };
  for (const taskId of work.taskIds) tasks[taskOutcome(tallies.get(taskId))] += 1;

  const passRate = counts.criteria > 0 ? counts.criteriaPassed / counts.criteria : null;
  let result: 'passed' | 'failed' | 'error' | 'skipped' = 'failed';
  if (tasks.error) result = 'error';
  else if (tasks.passed === expected) result = 'passed';
  else if (tasks.skipped === expected) result = 'skipped';

  await repo.updateResult(resultId, {
    result,
    tasksTotal: expected,
    tasksPassed: tasks.passed,
    tasksFailed: tasks.failed,
    tasksError: tasks.error,
    tasksSkipped: tasks.skipped,
    criteriaTotal: counts.criteria,
    criteriaPassed: counts.criteriaPassed,
    criteriaFailed: counts.criteriaFailed,
    passRate,
    reward: passRate,
    metrics: { pass_rate: passRate, criteria_total: counts.criteria, rollouts: counts.rollouts },
  });

  await work.trace.log(
    `benchmark_results     ${result}  tasks ${tasks.passed}/${expected} passed ` +
      `(${counts.rollouts} rollouts)  criteria ${counts.criteriaPassed}/${counts.criteria}`,
  );
  const summary = {
    benchmarkRunId: work.benchmarkRunId,
    result,
    tasks: expected,
    rollouts: counts.rollouts,
    criteria: counts.criteria,
  };

  // A run that errored on every task measured nothing, and a job that closes
  // `succeeded` is read as a run that produced a result. The rows are written
  // either way — the benchmark_result stays, so the ledger can still show what
  // was attempted — but the job itself has to say it did not deliver a run.
  if (tasks.error === expected && expected > 0) {
    const first = rollouts.find((item) => item.error);
    await work.trace.fail(
      new Error(
        `No task was graded: all ${expected} errored` +
          (first ? ` — ${headline(first.error)}` : '.'),
      ),
    );
    return;
  }

  await work.trace.succeed(summary);
}
