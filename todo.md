# TODO

Outstanding work, roughly in dependency order. Rules live in `AGENTS.md`;
phase-level history lives in `PLAN.md`. This file is what is *left*.

**State as of 2026-08-14.** Harvey Labs is `BMS-00001`. Gym is up.
Manually Benchmark starts `gym eval run --no-serve` as a `BR` job. Recurse is
not wired. Pick one task for a first walkthrough.

`BR-00001` ran end to end: one task, one rollout, 50 criteria, 48 passed. The
run ledger polls itself while the job is live and draws progress from the
pinned Harbor trial folder (turns, then scoring) plus the rollout count, so a
1-task run still has a moving subtitle. Failure-map, forge and environment
tables are still empty.

Note: `bun run db:reset` unlinks the database file. Restart `bun run dev`
afterwards, or every write fails as "readonly database" while reads still work.

**Local patch in the gym checkout — re-apply if the vendor tree is refreshed.**
`resources_servers/legal_agent_bench/vendor/harvey_labs/lab_harbor/judge.py`
now sends `response_format: {"type": "json_object"}` instead of `json_schema`.
DeepSeek rejects `json_schema` with 400 "This response_format type is
unavailable now", so on `BR-00002` all 49 criteria burned a request, fell back
to unconstrained free-form, and twice let the reasoning judge think until it hit
`max_tokens` without ever emitting a verdict — 2 criteria ungraded, 98 HTTP
requests and 8 MB of prompt for one task. `json_object` is the widely supported
subset and needs only the word "json" in the prompt, which `PROMPT_TEMPLATE`
already has. **Takes effect only after `gym env start` is restarted** — the
resources server holds the old module.

---

## 1. Make an imported benchmark runnable

Harbor catalogs bind to the healthy gym resources server at run time (the
unique one, or a previously stored adapter). `runnable` flips on when that
server and its agent are healthy. There is still no cancel button in the UI.

- [x] Decide how a benchmark acquires an adapter — the running gym resources
      server, not a named bench. A different gym is `GYM_ROOT` + `GYM_HEAD_URL`.
- [x] Set `runnable = 1` only when an adapter is present *and* the gym reports
      that server as healthy (health re-checked at run time).
- [x] `src/gym/{spawn,eval,results}.ts` — start `gym eval run`, stream its
      output, read the rollout and metrics files back.
- [x] Spawn **detached**, cancel by **process group** (`-pgid`), never by pid —
      gym starts child servers via Ray and uv, and killing the pid orphans them.

## 2. Run a benchmark end to end

- [x] Create a run: write `benchmark_runs` + `benchmark_run_tasks` **before**
      anything executes, so a run that dies early still records its intent.
- [x] Write exactly one `task_results` row per selected task and trial,
      including `error` and `skipped`, then its `criterion_results`.
- [x] Roll up into the single `benchmark_results` row for the run.
- [x] Enforce one model per run at the API boundary (`AGENTS.md` § Domain rules).

## 3. Jobs runner

Schema and the write side (`domain/jobs/trace.ts`) exist; the supervisor does not.

- [ ] `src/domain/jobs/runner.ts`
- [x] Real `jobs.progress` for a benchmark run — `gym/progress.ts` reads the
      pinned Harbor jobs dir (turns, verifier events) and `gym/results.ts`
      counts JSONL lines. JSONL is still a **lower bound**: a `no_persist`
      rollout is written to neither file, so a finished run can land under its
      total. Close on process exit, never on `done === total`. The bar is
      finished tasks plus a fraction of the in-flight trial (0 → 0.9), then
      ingest (0.9 → 1). Step copy is user-facing, not "collecting rollouts".
- [x] `/ui/benchmarks/ledger` polled fragment (`hx-trigger="every 2s"`). The
      poll attributes are rendered only while the job is live, so a finished
      run stops the polling by replacing itself without them.
- [ ] `/ui/jobs/strip` — the same fragment promoted above `#workspace` so
      progress survives navigating off the Benchmarks tab
- [x] Incremental log tail `/ui/jobs/:code/log?after=<seq>`. The sentinel at
      the end of the log swaps itself for new lines plus a new sentinel, so
      `after` advances without replaying what is already on screen. A count
      that has not moved in eight minutes is either a long Harbor task or a
      wedged process, and the bar alone cannot say which.
- [ ] Startup sweep: force-fail orphaned `queued` / `running` jobs.
- [ ] **Survive a `--watch` reload, or refuse to.** Observed on `BR-00002`.
      `bun --watch` reloads modules *in the same process* — the pid does not
      change — and the old module instance's pending promises are simply
      abandoned. So editing any file under `src/` mid-run drops the `execute()`
      continuation: nothing is left awaiting `spawned.wait()`, the follow loop
      stops, and the ingest never runs. Three things go wrong at once:
      the job sits at `running` forever; the rollouts stay on disk unread; and
      because nobody reaps the child, the finished gym process becomes a
      **zombie** parented to the dev server, and stays one until the dev server
      itself is restarted. `BR-00002` sat in that state for 66 minutes after
      gym had finished.
      A startup sweep does not fix this — the process never restarts, so there
      is no startup to sweep at. Options: reattach on reload by finding jobs
      that are `running` with a live `pgid`, or move the supervisor out of the
      request process entirely. Until then, do not edit `src/` while a run is
      in flight.
- [ ] **Count distinct rollouts, not newlines — required before resume is ever
      turned on.** `gym/results.ts` § `counter` counts `\n` across the main
      jsonl and the failures sidecar. That is exact only because we pass
      `resume_from_cache=False`, so gym dispatches each row once and writes at
      most one line for it. The sidecar takes *one row per attempt*
      (`rollout_collection.py` § `_load_from_cache`, attempts capped at
      `NEMO_GYM_MAX_ROLLOUT_ATTEMPTS`, default 3), so the moment resume or
      `append` is enabled a rollout that fails twice then succeeds writes three
      lines and the bar runs ahead of the run — up to 3× on a flaky one. Only
      `Math.min(1, …)` keeps it on the rails.
      Fix: parse `_ng_task_index` and `_ng_rollout_index` off each appended
      line and count *distinct* keys in a `Set`, instead of counting newlines.
      Still reads only the delta bytes, so it stays cheap; the added cost is one
      `JSON.parse` per new line. Do it in the same closure — `counter()` already
      owns the cursors, and nothing outside it needs to change.
      The lower-bound half does not go away and cannot be fixed here: a
      `kill_shaped` rollout (SIGTERM, OOM, dead Ray actor) is written nowhere
      *by design* — absence is how gym's resume knows to re-dispatch it — so a
      finished run can still land under its total. Completion stays
      `spawned.wait()` returning, never `done === total`.

## 4. Import: finish the surface

The engine works and is verified; the edges are not done.

- [x] **Wire the Benchmarks tab to it.** One "Import benchmark" control;
      inspect is not a separate step — `importFromUrl` rejects unsupported
      hosts and layouts in the form. JSON preview/commit remain for scripts.
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
- [ ] Hold-to-recurse button — click and hold to start the full process
      (the current ✦ Recurse control is a click stub and not wired)

## 7. Tests

- [x] Rollout counter: incremental offsets, a line still being written, a
      multibyte partial line, the failures sidecar, a replaced output file
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

## 9. Retries

Numbered last, but it belongs with § 3 — the jobs runner is where most of this
lands. Nothing in the tree retries anything today. Every long process fails
whole on the first transient error, which for a benchmark run means an hour of
Harbor trajectories thrown away because one HTTP call timed out.

Deliberately deferred, not forgotten. The judge fix above removed what this
list was mostly for — most of it is speculation until something is observed to
flake. Write the rule down when it bites; do not build the framework first.

The rules, before any of the items:

- [ ] **Classify the error, then decide.** A retryable failure is a 5xx, a
      connection reset, a timeout, or `SQLITE_BUSY`. A terminal failure is a
      404, an unsupported archive layout, a revision that does not exist, a
      validation error, or a 401. Retrying a terminal failure just makes the
      user wait longer for the same message. No blanket `catch` + retry.
- [ ] **Bounded, backed off, jittered.** Cap attempts, exponential backoff,
      jitter — several rollouts failing at once must not re-hit the provider in
      lockstep.
- [ ] **A retry is visible.** Every attempt after the first writes a
      `job_log_lines` row saying what failed and which attempt this is. A job
      that quietly succeeded on attempt four is a job that lied about how
      healthy the provider is.
- [ ] **Retries must be idempotent.** Anything retried has to be safe to run
      twice. `task_results` is unique on `(benchmark_result_id, task_id,
      trial_name)`, which helps; a retry that inserts before it fails does not.
- [ ] **Never blind-retry something that spends money.** One retried rollout is
      another full agent trajectory plus another judge pass. Cap it, and let the
      run settings carry the cap rather than hardcoding one.
- [ ] **Prefer the tool's own resume to re-running from zero.** See the items
      below for gym specifically.

Where it is needed, roughly by cost of not having it:

- [ ] **`gym eval run` (`domain/runs/service.ts`).** A non-zero exit fails the
      whole run and every completed rollout is abandoned. Gym already solves
      this properly: `resume_from_cache=true` reads both output files and
      re-dispatches only what is missing, capped by
      `NEMO_GYM_MAX_ROLLOUT_ATTEMPTS`. Re-invoking gym with resume on is the
      fix, **not** a bare re-spawn of the same command — and turning it on
      requires the distinct-key counter in § 3 first, or the progress bar starts
      double-counting attempts.
- [ ] **Import downloads (`lib/source.ts`, `lib/archive.ts`).** github.com and
      huggingface.co both rate-limit and both flake. A 429 or 5xx on a 200 MB
      archive currently loses the whole download. Retry the fetch; never retry a
      404 or an unsupported-layout rejection.
- [ ] **Head-server health (`gym/head.ts`).** One slow `/server_instances` or
      one slow child probe inside `GYM_TIMEOUT_MS` marks a server unhealthy,
      which makes `bindAdapter` refuse to start a run that would have been fine.
      One retry before declaring a server down.
- [x] **Database writes (`db/client.ts`).** `PRAGMA busy_timeout = 5000`, so a
      writer waits for the lock instead of failing instantly. Two writers exist
      during a run — the follow loop every 2s and the ingest inserting task and
      criterion rows. An explicit retry on top of this is not warranted until
      something is actually observed to time out.
- [ ] **Data-forge generation (§ 6).** Per-slot retry, not per-run. The resume
      rule is already written down there — a shortfall stays failed and
      resumable, and resume refills only the missing `(failure_item, ordinal)`
      slots. Retry has to respect that shape or it will refill slots that are
      already good.

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
