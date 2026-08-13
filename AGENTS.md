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
- **Two status vocabularies, never mixed in one column.**
  - *Execution* — `queued running succeeded failed cancelled`. Lives on `jobs`.
  - *Domain lifecycle* — `draft ready archived`, `pending approved rejected`.
    Lives on the entity.
- **No views.** The app this replaces had `SELECT *` views to rename tables it
  was ashamed of. Tables are named correctly here; if a name is wrong, migrate it.
- **Migrations are append-only.** Never edit a migration that has been applied —
  add `000N_whatever.sql`.

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

---

## NeMo Gym

- `src/gym/` is the only place that knows Python exists. Nothing else spawns a
  process or reads a gym path.
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
bun run check      # tsc --noEmit + the 500-line ceiling
bun test
bun run db:reset   # migrate + seed from scratch
bun run dev        # http://127.0.0.1:8767
```

After a frontend change, check in a browser: click through all five rail stages,
confirm the active stripe and gate readout update, toggle the theme, and confirm
interactive controls still work **after** an HTMX swap — listeners bound once at
load are the classic break here, which is why `public/js/app.js` delegates from
`document` instead.
