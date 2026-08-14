# AGENTS.md — rules for working in this repo

Read this before writing code. It is rules, not background. For *what* the app
does, read `README.md`; for the schema, `docs/DATA-MODEL.md`; for routes,
`docs/API.md`.

When I tell you to commit and push, you run the shortest git commands possible.

Just git commit and git push. Absolutely no long git commands or diffs - just do what I say.

## The one rule everything else serves

**A junior dev opens any random file and knows what part of the app it is.**

Every rule below exists to protect that. The app this replaces failed it: a
3612-line domain file, a 2821-line server with a 360-line `if path ==` chain,
and one API endpoint that returned 636 KB of everything.

---

## File size

**500 lines is the ceiling.** `bun run check:size` fails the build past it.

When a file approaches the line, split it — don't compress it:

- **Views** split by region. `views/tabs/failures/TopicTable.tsx`, not a
  1000-line `Failures.tsx`.
- **Routes** split by resource. One file per resource in `http/api/`, one file
  per tab in `http/ui/`.
- **Domain** splits by the three-file rule below. If `service.ts` is still too
  big after that, the module is doing two jobs — make it two modules.

---

## The three HTTP surfaces

Every route is exactly one of these. Adding a route means deciding which.

| Surface | Path | Returns | Used by |
|---|---|---|---|
| **Page** | `/failures` | Full HTML document, or the bare region under `HX-Request` | Browser navigation |
| **Fragment** | `/ui/failures/topics` | One HTML region | HTMX swaps |
| **JSON** | `/api/v1/failure-maps` | JSON | Scripts, tests, future clients |

Rules:

- **No route contains business logic.** All three call the same
  `domain/*/service.ts` function. If a route has an `if` about the domain, it
  belongs in the service.
- **The browser never renders from `/api/v1`.** Pages and fragments return HTML.
- **There is no `/api/state`.** Never add one.
- **An endpoint never returns a field the requesting view does not render.**
  Document bodies, rollout transcripts, judge responses, and job logs are each
  their own lazy endpoint, fetched on explicit expansion. This is the rule that
  keeps the polling payload from growing back to 636 KB.

### The fragment ⇄ DOM-id invariant

A fragment component renders its own root element carrying `id="{tab}-{region}"`,
matching its route `/ui/{tab}/{region}`. It is always swapped with
`hx-swap="outerHTML"` onto that id, so a fragment replacing itself is idempotent.

```tsx
// views/tabs/failures/TopicTable.tsx  ⇄  GET /ui/failures/topics
<section id="failures-topics" hx-get="/ui/failures/topics" hx-swap="outerHTML">
```

No wrapper divs. No target that isn't the component's own root.

Mutations `POST` to the same path and return the updated region. Anything *else*
that changed (rail gates, tally counts) rides along as an `hx-swap-oob="true"`
sibling in the same response — never a second request.

---

## Domain modules: exactly three files

Every folder under `src/domain/` has the same three files, always:

| File | Contains | Never contains |
|---|---|---|
| `model.ts` | TypeBox schemas, inferred types, status enums | SQL, HTTP |
| `repo.ts` | SQL only; takes the client, returns mapped rows | Business rules, HTTP |
| `service.ts` | Business rules, orchestration; calls repo and gym | SQL, HTML |

Import direction is one-way:

```
http/ ──▶ domain/*/service.ts ──▶ domain/*/repo.ts ──▶ db/client.ts
views/ ─▶ domain/*/model.ts (types only)
```

**Nothing imports another module's `repo.ts`.** If a service needs another
module's data, it calls that module's service.

---

## Database conventions

- **IDs are `INTEGER PRIMARY KEY AUTOINCREMENT`.** The display form (`FM-00004`,
  `TP-00012`) is produced by `code()` in `src/db/ids.ts` and parsed by `parse()`.
  Those two functions are the *only* place an ID prefix appears. Never build an
  ID string inline, and never generate a random one.
- **Timestamps** are `TEXT`, ISO-8601 UTC. Only these four names:
  `created_at`, `updated_at`, `started_at`, `finished_at`.
- **JSON columns** are suffixed `_json`, and are always
  `NOT NULL DEFAULT '{}' CHECK (json_valid(...))`.
- **The outcome column is called `result`, at every level.** `benchmark_results.result`
  and `task_results.result` are `passed|failed|error|skipped`;
  `criterion_results.result` is `pass|fail|error`. Not `outcome`, not `verdict` —
  one word, so a reader never has to ask whether three names mean three things.
- **Result tables are named for what they hold, not for their parent.**
  `task_results` and `criterion_results`, not `benchmark_task_results` and
  `benchmark_task_criterion_results`. The old names shared a 21-character prefix
  and produced the display codes `BTC` and `BTCR`, which differ by one trailing
  letter and address different tables. Prefixes are now `TR` and `CR`.
- **`criterion` is singular, `criteria` is plural, and both are correct.**
  `benchmark_task_criteria` is a table of many; `criterion_id` is one. The
  modifier goes singular and the head noun stays plural — the same rule as
  `benchmark_tasks` → `task_results`. Do not "fix" this to match.
- **Two status vocabularies, never mixed in one column.**
  - *Execution* — `queued running succeeded failed cancelled`. Lives on `jobs`.
  - *Domain lifecycle* — `draft ready archived`, `pending approved rejected`.
    Lives on the entity.
- **No views.** The app this replaces had `SELECT *` views to rename tables it
  was ashamed of. Tables are named correctly here; if a name is wrong, migrate it.
- **Migrations are append-only.** Never edit a migration that has been applied —
  add `000N_whatever.sql`.
- **No seed fixtures.** There was a `scripts/seed.ts` that invented a plausible
  run to develop against; it was deleted once the real import worked. Develop
  against a real URL import and a real gym run instead. A fixture that drifts
  from the pipeline is worse than an empty database, and every view must render
  an empty database correctly anyway.

---

## Jobs

Anything long-running is a row in `jobs` plus lines in `job_log_lines`. One
table, one runner (`domain/jobs/runner.ts`), one fragment set, one API resource.

Do not add a `status`/`started_at`/`finished_at`/`log` set of columns to a domain
table. That is what the old schema did six times over. Domain tables keep their
*outputs* and a `job_id` FK.

Log lines are rows, not an appended `TEXT` column, so tailing is
`ORDER BY seq DESC LIMIT n` and incremental fetch is `WHERE seq > ?`.

---

## Domain rules — do not refactor these away

These are research constraints, not implementation details. Each one is load
bearing; a convenience change that breaks one silently invalidates results.

1. **Exactly one model per benchmark run.** Enforced at the API boundary.
2. **Anti-benchmax.** The document generator receives *only* topic name,
   description, verifier strategy, and count. Never the original task, criterion
   text, reference answer, names, dates, or figures. This constraint is the
   entire reason the pipeline exists.
3. **The novelty gate is one-way.** A document with `novelty_status = 'rejected'`
   can never later become `approved`.
4. **Human review is mandatory** unless the forge run set `auto_approve`.
5. **A forge run succeeds only if every requested slot was filled.** A shortfall
   stays failed and resumable; resume refills only the missing
   `(failure_item, ordinal)` slots rather than starting a new run.
6. **`pass_threshold` is a floor, not a quality bar.** The real gate on cluster
   handoff is the learnability signal — `within_task_std >= 0.05`, and
   saturated/floored fraction `<= 0.8`. An environment where every rollout
   scores 1.0 teaches nothing and must be refused.
7. **Topic reassignment is valid only within the failure map's own taxonomy.**
8. **A result view reads the historical record, never the catalog.**
   `criterion_results` stores its own `criterion_title` and `match_criteria`
   because the judge graded *that* wording. `benchmark_task_criteria` holds what
   the criterion says today. Rendering a current title above reasoning written
   against an older one produces a row that displays cleanly and states
   something false, so Results, the failure map and topics read only the
   snapshot columns. The catalog is for the Benchmarks tab, where no run is in
   scope. If you ever want to show drift, render both as labelled columns —
   never silently pick one.
9. **Criterion ids are unique only within a task.** The same id is reused by
   every task, so any list of criterion results must carry `task_id` and group
   by it.
   A flat list across a multi-task run is ambiguous, and the ambiguity is
   invisible on the single-task runs you will test with.

---

## Benchmark import

- **A benchmark is imported from a URL, pinned to a revision.** `github.com` and
  `huggingface.co` only. The ref is resolved to an immutable commit *before*
  anything downloads; importing the same repository at a newer commit creates a
  new `benchmarks` row rather than updating the old one, so past runs keep
  meaning what they meant.
- **Formats are a registry, not a branch.** `src/lib/formats.ts` lists them;
  each is a module exporting `{ id, label, keep, detect, read }`. Supporting a
  new layout means adding a sibling module and one line in `FORMATS` — never an
  `if` in the importer, the domain, or the routes.
- **A source repository is hostile data.** It is downloaded, read, and never
  executed. `src/lib/archive.ts` streams the tar as it decompresses so a large
  repository is never held in memory, rejects any entry whose path escapes the
  staging directory, and writes only the definition files a format asked for.
- **Import is two-phase.** `preview()` downloads and inspects but writes no
  rows; `commit()` persists what the preview staged. Never collapse them: a
  benchmark can be tens of thousands of tasks and the user confirms first.

## NeMo Gym

- `src/gym/` is the only place that knows Python exists. Nothing else spawns a
  process or reads a gym path.
- **The head server is the only gym address we know.** `gym env start` assigns a
  fresh port to every child server on each launch, so `GYM_HEAD_URL` is the one
  configured endpoint; resources-server, agent and model URLs come from
  `/server_instances`, and gym paths come from `/global_config_dict_yaml`.
  Hardcoding any other port or path is how this breaks after the next restart.
- Every invocation runs with `cwd: config.gym.root` — gym config paths are
  repo-relative and break otherwise.
- Spawn **detached** and cancel by **process group** (`-pgid`), not pid. Gym
  starts many child servers via Ray and uv; killing the pid orphans them.
- `env.yaml` holds live API keys. **The API returns presence booleans only,
  never values.** Writes are atomic: tmp file → `chmod 0600` → rename.

---

## Keep PLAN.md current

This work spans sessions and models. Before ending a work session:

1. Tick or strike the items you finished in `PLAN.md`.
2. Update the **Current state** line at the top — what phase, what is half-done.

`AGENTS.md` + `PLAN.md` + `docs/` is the handoff. A fresh model should be able to
continue from those three without reading the old Python.

---

## Verification

```bash
bun run check      # tsc --noEmit + the 500-line ceiling + the pipeline chain
bun test
bun run db:reset   # empty database from the canonical schema
bun run dev        # http://127.0.0.1:8767
```

After a frontend change, check in a browser: click through all five rail stages,
confirm the active stripe and gate readout update, toggle the theme, and confirm
interactive controls still work **after** an HTMX swap — listeners bound once at
load are the classic break here, which is why `public/js/app.js` delegates from
`document` instead.
