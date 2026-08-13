# TODO — benchmark results

## What exists now

`benchmarks_results` is now the run-specific task-result table.
`benchmark_tasks` remains the benchmark catalog: it says which tasks exist, not
whether a particular model passed them.

Each row in `benchmarks_results` represents one task execution within one
benchmark run and one trial. Its authoritative result is `outcome`:

- `passed` — the task's benchmark-level pass condition was satisfied
- `failed` — the task ran, but did not satisfy the benchmark-level condition
- `error` — execution or judging prevented a valid result
- `skipped` — the task was intentionally not run

The row also carries reward, criteria rollup counts, the raw per-task metrics,
and the result artifact path. `jobs.status` remains execution status; it is not
a model pass/fail result.

Topics are scoped directly to their `failure_map_id`. That keeps the model
honest for this app: the analyst extracts topics only from one result's failed
criteria, and `failure_items.topic_id` assigns each failure to one of those
topics. There is no separate taxonomy container or membership table.

## Code updates still needed

- [ ] Add `src/domain/benchmarks_results/{model,repo,service}.ts`.
- [ ] Read task-result rows for the current `benchmark_run_id`.
- [ ] Update `src/views/tabs/Results.tsx` to show one row per task with its
      `outcome`, reward, criteria counts, trial, and result artifact link.
- [ ] Derive the Results page rollup from `benchmarks_results`, rather
      than treating `benchmark_runs.metrics_json` as the authoritative source.
- [ ] Add the result read route/API when the remaining read surfaces are built.
- [ ] Update the benchmark runner/importer so every selected task and trial
      writes exactly one result row, including `error` and `skipped` outcomes.
- [ ] Add tests for multiple tasks, repeated trials, task errors, and a run
      where one task passes while another fails.

## What `criterion_results` would mean

We are **not adding this table yet**. It would be a lower-level table beneath
`benchmarks_results`, with one row for every individual grading criterion:

```text
benchmarks_results (one task outcome)
  └── criterion_results (one criterion outcome)
```

For the current migrated task, it would contain 69 rows: 53 `passed` and 16
`failed`. The existing `failure_items` table contains only those 16 failures,
plus analysis prose, severity, and topic assignment. It is
not a replacement for `criterion_results` because passing criteria never become
failure items.

When we need criterion-level drill-down, add:

- [ ] `criterion_results` with `benchmark_result_id`, `criterion_id`,
      `criterion_title`, `outcome`, score, and `details_json`.
- [ ] Link each `failure_items` row to its corresponding failed criterion
      result, while keeping `failure_items` as the analysis layer.
- [ ] Backfill all 69 criterion rows from the raw legacy result before exposing
      criterion-level UI.

Until then, `benchmarks_results` is enough to answer the immediate
question: did this task pass or fail in this run?
