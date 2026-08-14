# TODO

Outstanding work, roughly in dependency order. Rules live in `AGENTS.md`;
phase-level history lives in `PLAN.md`. This file is what is *left*.

**State as of 2026-08-14.** The catalog is filled from URL imports and the gym
endpoint is live, but nothing can execute a benchmark yet:

```
BM-00001  Harvey Labs        harbor    1,749 tasks  104,467 criteria  runnable=0
BM-00002  Grade School Math  tabular  18,903 tasks   17,584 criteria  runnable=0
```

Every result, failure-map, forge and environment table is empty and waiting on
the first real run.

---

## 1. Make an imported benchmark runnable

Nothing today maps a benchmark to something that can execute it. `adapter` is
written empty on purpose and `runnable` stays 0.

- [ ] Decide how a benchmark acquires an adapter — matched against the running
      gym's resources servers, chosen by the user at import, or generated. This
      is a design question, not just wiring.
- [ ] Set `runnable = 1` only when an adapter is present *and* the gym reports
      that server as healthy.
- [ ] `src/gym/{spawn,eval,results}.ts` — start `gym eval run`, stream its
      output, read the rollout and metrics files back.
- [ ] Spawn **detached**, cancel by **process group** (`-pgid`), never by pid —
      gym starts child servers via Ray and uv, and killing the pid orphans them.

## 2. Run a benchmark end to end

- [ ] Create a run: write `benchmark_runs` + `benchmark_run_tasks` **before**
      anything executes, so a run that dies early still records its intent.
- [ ] Write exactly one `task_results` row per selected task and trial,
      including `error` and `skipped`, then its `criterion_results`.
- [ ] Roll up into the single `benchmark_results` row for the run.
- [ ] Enforce one model per run at the API boundary (`AGENTS.md` § Domain rules).

## 3. Jobs runner

Schema and the write side (`domain/jobs/trace.ts`) exist; the supervisor does not.

- [ ] `src/domain/jobs/runner.ts`
- [ ] `/ui/jobs/strip` polled fragment (`hx-trigger="every 3s"`)
- [ ] Incremental log tail `/ui/jobs/:id/log?after=<seq>` + `hx-swap="beforeend"`
- [ ] Startup sweep: force-fail orphaned `queued` / `running` jobs

## 4. Import: finish the surface

The engine works and is verified; the edges are not done.

- [ ] **Wire the Benchmarks tab to it.** The "Import benchmark" button is still
      rendered `disabled` — importing is a POST today, not a click. Needs the
      preview → confirm → commit flow as fragments.
- [ ] Delete / re-import a benchmark from the UI. `replace` exists only as an
      API flag, and a benchmark with runs is correctly blocked by `ON DELETE
      RESTRICT` — that path needs a real error message, not a raw FK failure.
- [ ] Garbage-collect `data/staging/` — abandoned previews are never cleaned up.
- [ ] Populate `benchmark_sources` (content fingerprints). The table exists and
      is empty; the data forge's novelty gate depends on it.

### Known format gaps

- [ ] **HuggingFace datasets mostly ship parquet.** `src/lib/source.ts` resolves
      and pins HF URLs correctly, but neither `harbor` nor `tabular` reads
      parquet, so most HF datasets fail detection. Options: a parquet reader, or
      pull rows from the datasets-server API instead of the repo tarball.
- [ ] `tabular` puts everything in the `validation` split — no train/test
      detection. It also guesses prompt/answer field names; the guess is
      recorded in task metadata but nothing lets the user correct it.
- [ ] `tabular` rows with no answer field import ungraded (17,584 criteria
      across 18,903 gsm8k tasks). Reported honestly at preview; no way to act
      on it yet.

## 5. Read paths

- [ ] Every `/ui/{tab}/{region}` fragment route
- [ ] Every `/api/v1` JSON GET (settings, gym and benchmarks exist)
- [ ] Task-result list/detail on the Results page
- [ ] Pagination anywhere a benchmark's tasks are listed — `repo.listTasks` is
      bounded, but no view uses the offset yet

## 6. Mutations

- [ ] Create failure map
- [ ] Create / resume data-forge run (resume refills only missing
      `(failure_item, ordinal)` slots)
- [ ] Document review + approve-all + undo
- [ ] Topic reassignment (failure-map-scoped only)
- [ ] Verifier save, environment build

## 7. Tests

`tests/` is still empty.

- [ ] Import: URL parsing, revision pinning, tar path-traversal rejection, pax
      long names, format detection picking the right module, duplicate refusal
- [ ] Runs: multiple tasks, repeated trials, task errors, aggregate rollups, and
      a run where one task passes while another fails
- [ ] The composite-FK guard: a criterion result must not attach a criterion
      from one task to a result for another

## 8. Docs

- [ ] `docs/DATA-MODEL.md` — the schema and, importantly, the snapshot-vs-catalog
      rule (`AGENTS.md` § Domain rules 8)
- [ ] `docs/API.md` — every route and what it does
- [ ] `docs/DESIGN.md` — rendered ledger conventions
- [ ] `docs/GYM.md` — head server, discovery, running a benchmark

---

## Reference: the data model

Definitions are always written before results, and results reference them:

```text
benchmarks
├── benchmark_tasks
│   └── benchmark_task_criteria
└── benchmark_runs
    ├── benchmark_run_tasks           what the run was asked to execute
    │      └──▶ benchmark_tasks
    └── benchmark_results             one aggregate rollup per run
        ├── task_results              one result per task/trial
        │   └── criterion_results
        │          └──▶ benchmark_task_criteria
        └── failure_maps
            ├── topics
            └── failure_items ──▶ criterion_results, topics
```

`benchmark_results` and `task_results` are kept deliberately: together they are
how `benchmark_runs` reaches `benchmark_task_criteria`, and `task_results` is
what makes repeated trials of one task separate rows rather than a column.
`benchmark_run_tasks` is the *pre-execution* edge. `bun run check:chain` asserts
all 19 links.

`criterion_results` carries **composite** foreign keys — `(task_result_id,
task_id)` and `(benchmark_task_criterion_id, task_id)` — so a verdict cannot
attach a criterion from one task to a result for another. Two independent
single-column FKs allowed exactly that, and because criterion ids repeat across
tasks the mistake would have reconciled in every count while producing nonsense
judge text downstream.

The outcome column is `result` at every level. Result views read the snapshot
columns on `criterion_results`, never the live catalog — see `AGENTS.md`
§ Domain rules 8 and 9.
