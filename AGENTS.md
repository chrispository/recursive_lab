# Recursive Lab

Local Bun/Elysia + SQLite lab for importing benchmarks, running NeMo Gym, and
turning failures into reviewed training data. Keep files small (500 lines max):
a new reader should know a file's job from its path.

## Architecture

- Routes are thin and call domain services. Three surfaces only: pages,
  `/ui/...` HTML fragments, and `/api/v1/...` JSON. The browser does not render
  API JSON.
- A fragment owns its root id (`{tab}-{region}`) and swaps itself with
  `outerHTML`. Return changed sibling regions as OOB swaps.
- Each `src/domain/<name>/` has only `model.ts` (schemas/types), `repo.ts`
  (SQL), and `service.ts` (rules/orchestration). Never import another module's
  repo. Views may import models, never services/repos.
- IDs come only from `src/db/ids.ts`; migrations are append-only. Use ISO UTC
  timestamps and `*_json` for valid JSON columns.
- Long work is a `jobs` row plus `job_log_lines`, never ad-hoc status/log columns.

## Research constraints

- One model per benchmark run. Human review is mandatory unless auto-approved.
- Forge generation receives only topic name/description, verifier strategy, and
  count—never original tasks, criteria, answers, names, dates, or figures.
- Rejected novelty is permanent. A forge succeeds only when every requested
  slot is filled; resumes fill missing slots only.
- Results render their stored snapshots, not the current benchmark catalog.
  Criterion IDs are unique within a task, so cross-task results must group by task.

## Imports and Gym

- Import only GitHub/Hugging Face URLs, resolve an immutable commit first, and
  preview before persisting. Source archives are hostile data: read, never run.
- Only `src/gym/` invokes Python. Use `GYM_ROOT`, `GYM_HEAD_URL`, and Gym's
  `/server_instances` discovery—never child ports/paths or benchmark-specific
  server names. Run Gym commands with `cwd: GYM_ROOT`.
- Gym startup can take minutes on a cold cache while resources download/prepare.
  Spawn detached and cancel its process group. Never expose `env.yaml` secrets.

## Workflow

- Preserve unrelated dirty changes. Ask before killing a running server/process.
- Verify relevant changes with `bun run check` and `bun test`; use `bun run
  db:reset` when schema changes. Keep this file and `PLAN.md` current when they
  exist. For frontend changes, manually exercise HTMX swaps and interactions.
- If asked to commit/push: use only `git commit` then `git push` (never `gh stack`).
