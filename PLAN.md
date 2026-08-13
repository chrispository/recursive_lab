# PLAN.md — build plan and handoff

> **Current state (2026-08-13):** Phases 0 and 1 are **done and verified**.
> Phase 2's CSS, shared UI primitives, rail wiring, and all six page views are
> done and verified against the migrated legacy run. The Settings tab now
> includes the five original provider groups, safe credential presence states,
> save/test actions, and dark/light plus density controls. Phase 3 has the page
> routes and the Settings JSON surface; tab fragments and the remaining JSON
> GETs are still pending. The requested legacy run is now in `data/lab.db` as
> `BR-00001`, with its original result artifact path preserved.
> A standalone interactive schema map is available at `/schema.html`; it
> exposes all 23 tables (including `benchmark_task_criteria`,
> `data_forge_runs` / `data_forge_run_items`)
> plus derived `progress`, with fields and FK/logical connections.
> The data-forge tables are named `data_forge_runs` and
> `data_forge_run_items`; their owning document FK is `data_forge_run_id`.
> The matching domain module/read model is `src/domain/data_forge`, with
> `DataForgeSummary`, `dataForgeCode`, and `DataForge` names throughout.
> `benchmark_results` now stores the aggregate rollup for one benchmark run;
> `benchmark_task_results` stores one outcome per run/task/trial,
> `benchmark_task_criteria` stores the static criteria belonging to each task,
> `benchmark_task_criterion_results` stores each task-result verdict against
> those criteria, and `failure_items` points directly to that criterion result; the
> follow-up implementation work is documented in `todo.md`.
> The downstream chain is `benchmark_runs → benchmark_results → failure_maps
> → topics → failure_items`; task and criterion result detail hangs below the
> aggregate result, and topics are scoped to the failure map that produced
> them.
> Pipeline progress (how far a run has travelled) lives in `src/domain/progress`,
> not a table — it is derived on every read. Display codes are five-digit padded
> (`BR-00001`, `FM-00001`, `TP-00001`, etc.) through the central `code()` helper;
> `parse()` accepts legacy unpadded input.
>
> **The app boots and serves all six pages; `/failures` renders the migrated
> 16-item failure map.**
> The local legacy execution ledger now carries source-derived descriptions and
> failure text, and Results derives the benchmark outcome from its imported
> task result instead of hardcoding `verified`.
> Results now selects a benchmark run, computes pass rate from its
> `benchmark_results` row, and renders the imported 69-criterion inspection
> records with judge explanations.
> `bun run db:reset && bun run dev` → http://127.0.0.1:8767
>
> **Pick up here → see "Next three steps" below.**

This file is the handoff. Tick or strike items as they land and update the block
above before ending a session. Rules live in `AGENTS.md`; don't duplicate them.

---

## Next three steps (start here)

1. **Add the remaining read paths.** Create every `/ui/{tab}/{region}` fragment
   and `/api/v1` JSON GET for the seeded page read models.
2. **Check the ledger visually.** Open the app in a browser, switch dark/light
   and density under Settings, and confirm controls survive HTMX navigation.
3. **Write the handoff docs.** `docs/DATA-MODEL.md`, `docs/API.md`, and
   `docs/DESIGN.md` should describe the schema, read surfaces, and rendered
   ledger conventions before mutations land.

Nothing is half-finished. Every file that exists is complete and type-checks.

---

## What we're building

A rebuild of the "recursive( )" benchmark lab — the dashboard driving this
research pipeline:

```
benchmark run  →  task results  →  failure map  →  topics  →  data forge
     BR              BTR              FM + FI        TP          DF + DOC → ENV
```

The previous version (`~/Documents/recursive/tools/`) worked but became
unmaintainable: 3612 + 2821 + 2457 lines across three files, no router, and a
single `/api/state` endpoint returning **636 KB every six seconds** — 402 KB of
which was document body text no list view displayed.

Stack: **Bun + Elysia + HTMX + libSQL (Turso-compatible)**, JSX for
server-rendered fragments. Harbor integration is deliberately deferred.

---

## Phase 0 — Scaffold ✅ done

- [x] deps: `elysia` 1.4.29, `@elysiajs/html`, `@elysiajs/static`, `@libsql/client` 0.17.4
- [x] `tsconfig.json` with `jsxImportSource: "@kitajs/html"`
- [x] `package.json` scripts: `dev`, `db:setup`, `db:seed`, `db:reset`, `check`, `test`
- [x] `src/config.ts` — the only reader of `process.env`
- [x] `AGENTS.md`, `PLAN.md`, `.env.example`, `.gitignore`
- [x] `scripts/check-size.ts` — 500-line ceiling, warns at 400
- [x] Vendored: htmx **2.0.10**, IBM Plex Mono woff2 ×2
- [x] `src/views/layout/{Document,Rail}.tsx`, `tabs.ts`
- [x] `src/http/respond.tsx` — full document vs HTMX fragment (+ OOB rail)
- [x] `src/http/pages.tsx` — six seeded views
- [x] `src/index.ts`

Verified: full doc on cold load, bare fragment + OOB rail under `HX-Request`,
all static assets 200, `/` → `/benchmarks` 302, unknown tab 404, `tsc` clean.

## Phase 1 — Schema ✅ done

- [x] `src/db/schema.sql` — canonical fresh domain schema, **0 views**
- [x] `src/db/client.ts` — `all/one/value/insert/run` + `now()`/`json()`
- [x] `src/db/ids.ts` — `PREFIX`, five-digit `code()`, `parse()`; **INTEGER PKs**, no random hex
- [x] `scripts/{setup-db,seed}.ts`
- [ ] `docs/DATA-MODEL.md` ← **not written yet**

The seed fixture produces the real run's proportions: 1 BR → 1 BTR → 1 FM → 16 FI →
6 TP → 1 DF → 12 DOC → 6 VF → 6 ENV → 10 jobs. The migrated legacy
database has the same progress plus 12 benchmark sources, 3 evaluations, and
13 execution jobs. Verified: `foreign_key_check` clean, progress joins to one
row, and the one-FM-per-result unique index rejects a second insert.

### Legacy import ✅ requested run migrated

- [x] Located the source at `~/Documents/recursive/results/lab_dashboard/lab_dashboard.sqlite3`
- [x] Imported `BR-20260811-214922-3B1546` / `harvey_001` / `glm-5.2`
- [x] Imported task `trusts-estates-private-client__extract-distribution-requirements-from-trust-agreement`
- [x] Preserved 69 criteria, 53 diagnostic passes, 16 failure items, and the
      original full-task pass rate of `0`
- [x] Preserved the model output path under
      `results/lab_dashboard/BR-20260811-214922-3B1546/`
- [x] Normalized nested environment metrics into the Env Lab summary while
      retaining the original nested JSON
- [x] Imported the original 69 criterion-level score records (53 pass, 16 fail),
      including task criteria and judge explanations

## Phase 2 — Ledger layout ✅ seeded views done

- [x] `public/css/tokens.css` — **Ink** light (default) + dark, three-layer theming
- [x] `public/css/base.css` — graph paper, scanlines, typography, buttons, inputs
- [x] `public/css/ledger.css` — rail, tablebox, **tally**, table, panel, badge, bar
- [x] `public/js/app.js` — theme/density + hold-to-confirm, **delegated from
      `document`** so it survives HTMX swaps
- [x] `src/views/ui/*` — TableBox, Cap, Tally, Table, Panel, Field, Badge, Bar, Id, Btn
- [x] Six tab views rendering seeded data
- [x] Rail wired to `progress.currentWithRail()`
- [x] Settings provider groups, safe save/test API, and appearance controls
- [ ] `docs/DESIGN.md`
- [ ] **Never visually checked in a browser.** Markup and CSS are correct by
      construction but no screenshot has been taken. Do this first once a real
      tab renders.

Palette decisions already made: light mode is **Ink** (`--brand:#c8452a`), not
Bone. `--btn-ink` is *light* in Ink because the brand is dark there — black on
`#c8452a` fails contrast. The `data-palette` switcher from redesign.html was
dropped: two themes, not eight.

## Phase 3 — Read paths 🟡 barely started

- [x] `src/http/respond.tsx`
- [ ] Every `/ui/{tab}/{region}` fragment route
- [ ] Every `/api/v1` JSON GET (Settings GET/POST/test exists)
- [ ] `docs/API.md` — every route and what it does ← **explicitly requested**

## Phase 4 — Jobs 🟡 read model done, runner pending

Schema is ready (`jobs` + `job_log_lines`); no runner yet.

- [x] `src/domain/jobs/{model,repo,service}.ts` — seeded execution ledger read model
- [ ] `src/domain/jobs/runner.ts`
- [ ] `/ui/jobs/strip` polled fragment (`hx-trigger="every 3s"`)
- [ ] Incremental log tail `/ui/jobs/:id/log?after=<seq>` + `hx-swap="beforeend"`
- [ ] Cancel by **process group**, not pid
- [ ] Startup sweep: force-fail orphaned `queued`/`running` jobs

## Phase 5 — Mutations 🟡 settings mutation done, workflow mutations pending

- [ ] Create failure map
- [ ] Create / resume data-forge run (resume refills only missing `(item, ordinal)` slots)
- [ ] Document review + approve-all + undo
- [ ] Topic reassignment (failure-map-scoped only)
- [ ] Verifier save, environment build
- [x] Settings save + connection test (presence booleans only, never key values)

## Phase 6 — Gym wiring ⬜

- [ ] `src/gym/{paths,spawn,eval,results,status}.ts`
- [ ] Benchmark run end-to-end as a job
- [ ] `docs/GYM.md`

Facts already established, so no re-research is needed:
`/home/chris/Documents/recursive/.venv/bin/gym` exists and works. Run with
`cwd: GYM_ROOT` and `PYTHONUNBUFFERED=1`. Gym derives `<stem>_materialized_inputs.jsonl`,
`<stem>_failures.jsonl`, `<stem>_aggregate_metrics.json` from `--output`.
Rollouts come out unordered — sort by `(_ng_task_index, _ng_rollout_index)`.
Head server is `:11000`, `/server_instances`; every server answers `GET /` with
`{"status":"ok"}`. `outputs/<date>/` is Hydra logs, not results.

## Phase 7 — Deferred ⬜

Harbor, reward profiling, Prime Intellect dispatch, cluster training, Turso sync.

---

## Files that exist right now

```
src/config.ts                        env + paths, the only process.env reader
src/index.ts                         composition only
src/db/{client,ids,schema.sql}
src/domain/progress/{model,repo,service}.ts   BR→BTR→FM→TP→DF→ENV, gate counting
src/domain/topics/{model,repo,service}.ts     failure-map topic rows + tally
src/domain/runs/{model,repo,service}.ts       benchmark/run read model
src/domain/data_forge/{model,repo,service}.ts data-forge/document read model
src/domain/environments/{model,repo,service}.ts  environment/evaluation read model
src/domain/jobs/{model,repo,service}.ts       execution ledger read model
src/http/{respond.tsx,pages.tsx}     six seeded page views
src/http/schema.ts                   standalone schema.html route
src/views/ui/*.tsx                  shared ledger primitives
src/views/tabs/*.tsx                six seeded tab views, including DataForge.tsx
src/gym/settings.ts                 safe env.yaml settings service
src/http/api/settings.ts            Settings JSON GET/POST/test routes
src/views/layout/{Document,Rail}.tsx, tabs.ts
public/css/{tokens,base,ledger}.css  public/js/{app.js,htmx.min.js}
public/schema.html                   draggable schema map with persisted layout
scripts/{setup-db,seed,check-size}.ts
```

No `docs/*.md` written yet. `src/http/ui/`, `src/lib/`, and `tests/` are empty
directories.

## Verify

```bash
bun run db:reset && bun run dev     # http://127.0.0.1:8767
bun run check:types                 # clean
bun run check:size                  # no file over 500 lines
```

`bun run db:reset` recreates the development seed from the canonical schema.

Note: `bun run check` chains both but exits 144 under some shells — run the two
commands separately if that bites.
