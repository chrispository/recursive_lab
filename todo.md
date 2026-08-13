# TODO — benchmark result hierarchy

## Current model

The benchmark data model now separates definitions, execution metadata, and
results at the level where each concept actually lives:

```text
benchmarks
└── benchmark_tasks
    └── benchmark_task_criteria

benchmark_runs
└── benchmark_results                 one aggregate result per run
    └── benchmark_task_results        one result per task/trial
        └── benchmark_task_criterion_results
```

`benchmark_results` is the benchmark-wide rollup: task counts, criterion
counts, pass rate, reward, outcome, and artifact path. `benchmark_runs` keeps
the model, settings, label, and execution metadata. `failure_maps` attach to
the aggregate result; `failure_items` attach directly to a failed
`benchmark_task_criterion_results` row.

The migrated local run preserves 1 aggregate result, 1 task result, 69
criterion results, and 16 failure items. The schema, seed path, repositories,
Results page, failure map, data forge, progress read model, and interactive
schema map all use this hierarchy.

## Next implementation work

- [ ] Add task-result list/detail read surfaces to the Results page.
- [ ] Update the benchmark runner/importer so every selected task and trial
      writes exactly one task result and its criterion results, including
      `error` and `skipped` outcomes.
- [ ] Add tests for multiple tasks, repeated trials, task errors, aggregate
      rollups, and a run where one task passes while another fails.
