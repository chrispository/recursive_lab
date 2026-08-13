# PLAN.md — build plan and handoff

> **Current state (2026-08-13):** Phases 0 and 1 are **done and verified**.
> Phase 2's CSS, shared UI primitives, rail wiring, and the read-only failures
> tab are done and verified against the seeded database. The other five page
> bodies are still stubs. Phase 3 still has only `respond.tsx`.
>
> **The app boots and serves all six pages; `/failures` renders seeded topics.**
> `bun run db:reset && bun run dev` → http://127.0.0.1:8767
>
> **Pick up here → see "Next three steps" below.**

This file is the handoff. Tick or strike items as they land and update the block
above before ending a session. Rules live in `AGENTS.md`; don't duplicate them.

---

## Next three steps (start here)

1. **Add the remaining read paths.** Create every `/ui/{tab}/{region}` fragment
   and `/api/v1` JSON GET, starting with the failures regions now that the page
   has real data.
2. **Build the remaining five tab views.** Keep the shared primitives in
   `src/views/ui/` and add one view module per tab region; the current page
   stubs are still in `src/http/pages.tsx`.
3. **Write the handoff docs.** `docs/DATA-MODEL.md`, `docs/API.md`, and
   `docs/DESIGN.md` should describe the schema, read surfaces, and rendered
   ledger conventions before mutations land.

Nothing is half-finished. Every file that exists is complete and type-checks.

---

## What we're building

A rebuild of the "recursive( )" benchmark lab — the dashboard driving this
research pipeline:

```
benchmark run  →  failure map  →  taxonomy  →  data forge  →  RL environments
     BR              FM + FI        TX + TP       DF + DOC        VF + ENV
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
- [x] `package.json` scripts: `dev`, `db:migrate`, `db:seed`, `db:reset`, `check`, `test`
- [x] `src/config.ts` — the only reader of `process.env`
- [x] `AGENTS.md`, `PLAN.md`, `.env.example`, `.gitignore`
- [x] `scripts/check-size.ts` — 500-line ceiling, warns at 400
- [x] Vendored: htmx **2.0.10**, IBM Plex Mono woff2 ×2
- [x] `src/views/layout/{Document,Rail}.tsx`, `tabs.ts`
- [x] `src/http/respond.tsx` — full document vs HTMX fragment (+ OOB rail)
- [x] `src/http/pages.tsx` — six routes, failures view plus stubs
- [x] `src/index.ts`

Verified: full doc on cold load, bare fragment + OOB rail under `HX-Request`,
all static assets 200, `/` → `/benchmarks` 302, unknown tab 404, `tsc` clean.

## Phase 1 — Schema ✅ done

- [x] `src/db/migrations/0001_init.sql` — 20 tables, 16 indexes, **0 views**
- [x] `src/db/client.ts` — `all/one/value/insert/run` + `now()`/`json()`
- [x] `src/db/migrate.ts` — uses `executeMultiple` inside an explicit
      transaction (the array form of `db.migrate()` treats a whole file as one
      statement and silently creates only the first table — don't go back to it)
- [x] `src/db/ids.ts` — `PREFIX`, `code()`, `parse()`; **INTEGER PKs**, no random hex
- [x] `scripts/{migrate,seed,seed-data}.ts`
- [ ] `docs/DATA-MODEL.md` ← **not written yet**

Seed produces the real run's proportions: 1 BR → 1 FM → 16 FI → 1 TX → 6 TP →
1 DF → 12 DOC → 6 VF → 6 ENV → 10 jobs. Verified: `foreign_key_check` clean,
lineage joins to one row, and the one-FM-per-run unique index rejects a second
insert.

## Phase 2 — Ledger layout 🟡 failures slice done, five tabs remain

- [x] `public/css/tokens.css` — **Ink** light (default) + dark, three-layer theming
- [x] `public/css/base.css` — graph paper, scanlines, typography, buttons, inputs
- [x] `public/css/ledger.css` — rail, tablebox, **tally**, table, panel, badge, bar
- [x] `public/js/app.js` — theme/density + hold-to-confirm, **delegated from
      `document`** so it survives HTMX swaps
- [x] `src/views/ui/*` — TableBox, Cap, Tally, Table, Panel, Field, Badge, Bar, Id, Btn
- [x] `failures` tab renders seeded topics and lineage data
- [ ] Five remaining tab views rendering seeded data
- [x] Rail wired to `lineage.currentWithRail()`
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
- [ ] Every `/api/v1` JSON GET
- [ ] `docs/API.md` — every route and what it does ← **explicitly requested**

## Phase 4 — Jobs ⬜

Schema is ready (`jobs` + `job_log_lines`); no runner yet.

- [ ] `src/domain/jobs/{model,repo,service,runner}.ts`
- [ ] `/ui/jobs/strip` polled fragment (`hx-trigger="every 3s"`)
- [ ] Incremental log tail `/ui/jobs/:id/log?after=<seq>` + `hx-swap="beforeend"`
- [ ] Cancel by **process group**, not pid
- [ ] Startup sweep: force-fail orphaned `queued`/`running` jobs

## Phase 5 — Mutations ⬜

- [ ] Create failure map
- [ ] Create / resume forge run (resume refills only missing `(item, ordinal)` slots)
- [ ] Document review + approve-all + undo
- [ ] Topic reassignment (taxonomy-scoped only)
- [ ] Verifier save, environment build
- [ ] Settings save + connection test (presence booleans only, never key values)

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
src/db/{client,ids,migrate}.ts       + migrations/0001_init.sql
src/domain/lineage/{model,repo,service}.ts    BR→FM→TX→DF→ENV, gate counting
src/domain/topics/{model,repo,service}.ts     taxonomy table rows + tally
src/http/{respond.tsx,pages.tsx}     failures is real; other bodies are stubs
src/views/ui/*.tsx                  shared ledger primitives
src/views/tabs/Failures.tsx         seeded taxonomy and failure-map view
src/views/layout/{Document,Rail}.tsx, tabs.ts
public/css/{tokens,base,ledger}.css  public/js/{app.js,htmx.min.js}
scripts/{migrate,seed,seed-data,check-size}.ts
```

No `docs/*.md` written yet. `src/gym/`, `src/http/{ui,api}/`, `src/lib/`, and
`tests/` are empty directories.

## Verify

```bash
bun run db:reset && bun run dev     # http://127.0.0.1:8767
bunx tsc --noEmit                   # clean as of this writing
bun scripts/check-size.ts           # no file over 500 lines
```

Note: `bun run check` chains both but exits 144 under some shells — run the two
commands separately if that bites.
