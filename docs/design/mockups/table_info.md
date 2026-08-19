# Table columns — what the schema can actually give us

Source of truth: `src/db/schema.sql`, `src/domain/runs/repo.ts` (the `SELECT`),
`src/domain/runs/model.ts` (`BenchmarkRunSummary`), `src/domain/runs/ingest.ts`
(what lands in `metrics_json`).

Split into three tiers per table:

* **Have** — already on `BenchmarkRunSummary` / already rendered.
* **One line away** — the column exists in the DB but the `SELECT` in
  `repo.ts` does not project it. Cheap to add.
* **Needs a join** — real work, listed so we can decide it is worth it.

---

## 01 Benchmarks — run ledger (`RunLedger.tsx`)

The ledger is a per-run history. One row per `benchmark_runs` row.

### Have

| Field | Source | Note |
|---|---|---|
| `benchmarkRunCode` | `ids.ts` over `benchmark_runs.id` | `BR-00010` |
| `benchmarkName`, `benchmarkCode` | `benchmarks.name` / id | |
| `lab` | `benchmarks.lab` | **unused today** — free identity signal |
| `adapter` | `benchmarks.adapter` | e.g. `harbor`; **unused today** |
| `model` | `benchmark_runs.model` | one model per run, always |
| `taskCount` | `benchmark_runs.task_count` | what was *selected* |
| `expectedCriteria` | subquery over `benchmark_run_tasks` ⋈ `benchmark_task_criteria` | checks the selection implies, known before Harbor starts |
| `result` | `benchmark_results.result` | `passed\|failed\|error\|skipped\|null` |
| `resultTasksTotal/Passed` | `benchmark_results.tasks_*` | |
| `resultCriteriaTotal/Passed/Failed` | `benchmark_results.criteria_*` | |
| `settings.repeats` | `settings_json` | rollouts per task; already used for `total = taskCount * repeats` |
| `settings.concurrency`, `temperature`, `maxTurns`, … | `settings_json` | full `RunSettings` is in there |
| `metrics.rollouts`, `pass_rate`, `criteria_total` | `metrics_json`, written by `ingest.ts` | |
| `outputPath` | `benchmark_results.result_path` | |

### One line away (add to the `SELECT`)

| Column | Table | Why it earns a slot |
|---|---|---|
| `br.created_at` | `benchmark_runs` | **the ledger is a history and has no dates on it.** Highest-value single addition. |
| `br.label` | `benchmark_runs` | already selected, but the ledger renders `benchmarkName` instead — for two runs of the same benchmark the rows are literally identical today |
| `result.tasks_failed` | `benchmark_results` | we show `passed of total`; failed vs errored vs skipped is collapsed |
| `result.tasks_error`, `result.tasks_skipped` | `benchmark_results` | an errored task is not a wrong answer — same argument the code already makes for ungraded criteria |
| `result.reward` | `benchmark_results` | |
| `result.created_at` | `benchmark_results` | with `br.created_at`, gives ingest lag |

### Needs a join

| Want | How |
|---|---|
| **duration** | `jobs` where `kind='benchmark_run' AND subject_type='benchmark_runs' AND subject_id=br.id` → `finished_at - started_at`. Also gives `status`, `exit_code`, `error`. |
| criteria ungraded | `COUNT(*) FROM criterion_results WHERE result='error'` — Results already computes this client-side by summing `task.errored` |
| downstream state | `failure_maps` / `data_forge_runs` / `environments` exist per run — a "what came next" column would tell you which runs are dead ends |

### Verdict for the ledger row

Keep the outcome-first layout, shrink the row from `min-height: 168px` to
~92px, and spend the reclaimed space on columns rather than on padding:

`BR code · mark | benchmark + label + lab | model | tasks passed | checks passed | rollouts | duration | created_at`

`lab`, `label`, `created_at` and duration are the four that add real
information; everything else is already on screen.

---

## 02 Results (`Results.tsx`)

Today: one "Result rollup" table with a single row for the selected run,
counts pushed into the caption `Tally` at top right, and a `Badge` status
square in the last column. The ask is per-run rows carrying their own counts.

> **Shipped** in `src/views/tabs/Results.tsx` as the "Results by run" table.
> `tasks_failed`, `tasks_error` and an ungraded-criteria subquery were added to
> the `SELECT` in `runs/repo.ts`; `created_at`, `tasks_skipped` and `reward` are
> still unprojected.

### The requested six, per run

| Column | Source | Tier |
|---|---|---|
| tasks | `benchmark_results.tasks_total` (fall back `benchmark_runs.task_count`) | have |
| tasks passed | `benchmark_results.tasks_passed` | have |
| tasks failed | `benchmark_results.tasks_failed` | added to the `SELECT` |
| criteria | `benchmark_results.criteria_total` | have |
| criteria passed | `benchmark_results.criteria_passed` | have |
| criteria failed | `benchmark_results.criteria_failed` | have |

So five of the six are already on the type; `tasks_failed` is the only
missing one, and `tasks_error` / `tasks_skipped` should come with it so the
row's numbers reconcile (`total = passed + failed + error + skipped` is a
CHECK-able invariant, and a row where they don't add up is the bug you want
to see).

### Worth adding alongside

| Column | Source | Why |
|---|---|---|
| ungraded criteria | `COUNT(criterion_results.result='error')` | added to the `SELECT` as a subquery. It belongs in the row, not only in the caption — a criterion the judge could not grade shrinks the pass-rate denominator. |
| pass rate | `benchmark_results.pass_rate` | stored; currently recomputed in the view |
| all-pass rate | `tasks_passed / tasks_total` | the stricter number the ledger already headlines |
| rollouts | `metrics_json.rollouts` | already rendered |
| input/output tokens | `metrics_json` | already rendered — but they are `0` in both screenshots, so confirm `ingest.ts` actually writes them before giving them columns |
| judge model | `criterion_results.judge_model` | the grader is not the model under test; a run graded by a different judge is not comparable |
| `sourceDrifted` | already on `BenchmarkCriterionResult` | a run whose catalog moved under it deserves a row-level mark, not just a per-criterion dialog warning |

### Pass rate

Two of them, not one, and neither is labelled with its denominator: the task
pass rate closes the task columns (after Errored) and the criterion pass rate
closes the criterion columns (after Ungraded). The `colspan` group header above
each block is what makes that unambiguous, which is the whole reason the header
is two rows deep.

### Model column

Dropped. `benchmark_runs` holds exactly one model per run (AGENTS.md § Domain
rules), so the model is a property of the run identity in column one, not a
dimension the table varies over.

### Status column

Drop the `Badge`. The result is already carried by:

* the 3px left stripe on `td:first-child` (`.m-table tr[data-state=…]`) — the
  app's existing signature, and
* the numbers themselves.

A green square that says PASSED next to "1 of 1 passed" is the same fact
three times. Reserve an explicit word for the states the numbers *cannot*
express: `error` (the run died before grading — counts are meaningless) and
`skipped`.

### Run selection

`m-run-picker` is a `<label> <select> <button>` GET form. Problems: it needs a
round trip to see anything, the option text
(`BR-00010 · Harvey Labs · glm-5.2`) is unreadable at a glance, and it hides
the very comparison the page is for.

Better: since the per-run table now has one row per run, **the table is the
picker** — rows are the runs, clicking one selects it, and the criterion
inspection below re-renders for the selected row. `benchmark_runs` is small
(the ledger already lists every run), so there is no pagination problem.
