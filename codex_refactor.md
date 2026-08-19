# Readability Refactor Backlog

Audit date: 2026-08-18

This is a readability-first backlog, not a mandate to change every stylistic choice. Items are ordered by expected value. Prefer small, independently verifiable changes and preserve behavior unless an item explicitly says otherwise.

## Baseline

- `bun run check` passes.
- `bun test` currently exits with code 1 before collecting tests on Bun 1.3.14.
- `bun test ./tests --dots` passes: 48 tests, 0 failures.
- `tsc --noEmit --noUnusedLocals --noUnusedParameters` finds seven unused declarations.
- No application files were changed during this audit.

## Priority 0: Repository Correctness

### 1. Stop `.gitignore` from hiding source files

Files: `.gitignore:6`, `src/gym/lifecycle.ts`, `src/gym/pins.ts`, `src/gym/repin.ts`, `src/gym/storage.ts`

Change: Replace the unanchored `gym/` rule with `/gym/`.

Why: Git interprets `gym/` at any depth, so it also ignores `src/gym/`. Four source files used by the application are currently ignored and untracked. A clean `git status` therefore gives a false sense that all source is versioned.

Risk: Low. After changing the rule, inspect and intentionally add the four newly visible source files.

### 2. Make the test command deterministic

Files: `package.json:16`

Change: Use `bun test ./tests` instead of bare `bun test`.

Why: In this environment, bare `bun test` and `bun test tests/file.test.ts` silently exit with code 1, while an explicit relative path such as `bun test ./tests` runs all 48 tests successfully. The documented verification command should work consistently.

Risk: Low. Recheck on the Bun versions used locally and in CI.

### 3. Enable unused-code checking

Files: `tsconfig.json:16-19`

Change: Add `noUnusedLocals` and `noUnusedParameters` after cleaning the current findings.

Why: The codebase values readability, and unused imports, locals, parameters, and exported types create misleading context. Making this part of `bun run check` prevents gradual accumulation.

Current findings:

| File | Finding |
| --- | --- |
| `src/domain/data_forge/service.ts:10` | Imported `DocumentRow` is used only by the re-export on line 12, not by this import. |
| `src/gym/lifecycle.ts:13` | Unused `head` namespace import. |
| `src/gym/settings.ts:5-7` | Three unused Gym imports. |
| `src/http/ui/data_forge.tsx:93` | Unused `current` local, which also performs unnecessary database reads. |
| `src/views/layout/RunContext.tsx:14` | Unused `progress` component parameter. |

Risk: Low. Remove these first, then turn on the compiler options.

## Priority 1: Safe Deletions

### 4. Delete the unused hold-to-confirm implementation

Files: `public/js/app.js:48-90`

Change: Remove the entire `data-hold` state machine and its comment.

Why: No template or stylesheet uses `data-hold`, `hold:complete`, `--hold-progress`, or `is-ready`. The comment points to `todo.md section 6`, which no longer exists. This is approximately 43 lines of speculative behavior in the only browser script.

Risk: Low. A repository-wide reference search confirms it has no consumers.

### 5. Remove or finish the unwired recurse control

Files: `src/views/tabs/Benchmarks.tsx:169-172`, `public/js/app.js:212-217`, `public/css/ledger.css:635-638`

Change: Prefer deleting the full-process card, its click handler, and its dedicated style until the workflow exists. If it must remain as a design placeholder, render it explicitly disabled and remove the fake success interaction.

Why: Clicking the control only says it is “not wired yet.” Shipping a control that performs no operation adds UI, JavaScript, CSS, and reader uncertainty without application value.

Risk: Product decision. The deletion itself is mechanically small.

### 6. Delete dead exports and types

Files: `src/gym/results.ts:61-63`, `src/gym/settings.ts:257-258`

Change: Remove `completeLines` and `StorageLocation`.

Why: Neither symbol has a consumer. `completeLines` is also a one-line wrapper around `counter(outputPath)()` and does not establish a distinct abstraction.

Risk: Low for this repository. Confirm there are no external consumers before deleting.

### 7. Remove the unused prompt-card read

File: `src/http/ui/data_forge.tsx:90-103`

Change: Delete `const current = await promptCard(...)` on line 93.

Why: The result is never used. More importantly, this “unused local” performs prompt and data-forge reads, so deletion removes hidden work as well as a misleading name.

Risk: Low.

### 8. Remove the unused `RunContext.progress` prop

Files: `src/views/layout/RunContext.tsx:12-20`, call sites in `src/views/tabs/Benchmarks.tsx:72`, `DataForge.tsx:56`, `EnvLab.tsx:41`, `Failures.tsx:73`, `Results.tsx:176`

Change: Remove `progress` from `RunContext` props and from each call site.

Why: `RunContext` calculates all displayed values from `benchmarkRun`. The similarly named standalone `failedCriteriaOf` helper does use progress, which makes the unused component prop especially misleading.

Risk: Low.

### 9. Decide whether standalone design studies belong in production routes

Files: `src/http/schema.ts:1-11`, `src/index.ts:22,52-53`, `public/ledger-options.html`, `public/schema.html`

Change: Keep `/schema.html` if it is an intentional maintained tool. Remove `/ledger-options.html` and `ledgerOptionsDocument` if the ledger study is obsolete now that a ledger is implemented. Otherwise move design-only pages behind a clearly named development-only surface.

Why: `ledger-options.html` is described as a “proposed” visual study but is mounted by the production application. The route and document look like supported product surface to a new reader.

Risk: Product decision.

### 10. Move or remove historical design artifacts

Files: `logo-explorations.html`, `redesign-explorations.html`, `public/mockups/**`, tracked `outputs/**`

Change: Delete obsolete artifacts or move retained design history under one clearly named `docs/design/` directory. Stop tracking generated Hydra output unless it is a deliberate fixture.

Why: Design studies are spread across the repository root and `public/`, where static serving can make them look like application assets. `public/mockups` alone is about 2.4 MB. Tracked `outputs` are generated run residue rather than source.

Risk: Product/history decision. Preserve anything still used as a reference.

## Priority 2: Split Files by Responsibility

### 11. Split `public/css/ledger.css`

File: `public/css/ledger.css:1-2168`

Change: Split along the existing section boundaries. A practical first pass is `layout.css`, `benchmarks.css`, `results.css`, `forge.css`, and `components.css`, while retaining `tokens.css`, `base.css`, and `settings.css`.

Why: At more than 2,100 lines and roughly 400 selectors, this is the largest source file by a wide margin. Its own comments already define coherent modules. The repository’s 500-line readability rule currently checks only TypeScript, but the same rationale applies more strongly here.

Risk: Medium. Keep import order stable and manually exercise responsive layouts and HTMX swaps.

### 12. Split the browser script by behavior

File: `public/js/app.js:1-486`

Change: Split the script into focused modules or clearly isolated files for preferences, settings form requests, task selection, the thinking orb, result dialogs/filtering, benchmark-config animation, and document review.

Why: The file is at the TypeScript warning threshold and contains unrelated behavior with independent event handlers. Finding the handler for one screen requires scanning every screen’s client behavior.

Risk: Medium. Preserve delegated listeners so HTMX replacements continue to work.

### 13. Split `benchmarks/service.ts` before adding more behavior

File: `src/domain/benchmarks/service.ts:1-485`

Change: Keep the required `model.ts`/`repo.ts`/`service.ts` domain shape, but move non-domain mechanics to appropriately named `src/gym/` or `src/lib/` modules. The strongest boundary is import preview/commit versus Gym pin synchronization/alignment.

Why: The file is six lines below the hard ceiling and mixes archive staging, format detection, database import orchestration, snapshot movement, Gym repinning, lifecycle restart, adapter binding, and alignment reporting.

Risk: Medium. Do not create extra files inside `src/domain/benchmarks/`; AGENTS.md allows only the three domain files.

### 14. Reduce `data_forge/service.ts` and `data_forge/repo.ts` before feature work

Files: `src/domain/data_forge/service.ts:1-409`, `src/domain/data_forge/repo.ts:1-406`

Change: First remove duplication and extract provider-neutral parsing/hash helpers to `src/lib/` only if they are reusable. In the repo, replace large inline row-mapping/query blocks with small, locally named mappers where that makes each SQL operation easier to scan.

Why: Both files have crossed the repository’s warning threshold. Adding another forge feature will likely force rushed splitting at the 500-line limit.

Risk: Medium. Preserve the anti-benchmark data boundary and permanent novelty-rejection rules.

### 15. Split large view components around meaningful regions

Files: `src/views/tabs/Failures.tsx:1-371`, `src/views/tabs/DataForge.tsx:1-314`, `src/views/tabs/Results.tsx:1-295`

Change: Extract only substantial regions that already have their own concepts, such as the failure inventory, topic table, document review queue, run-results table, and criterion inspection. Avoid creating wrappers that merely rename a few JSX lines.

Why: These files combine page composition, formatting helpers, row components, dialogs, status fragments, and large tables. Their named visual regions provide natural boundaries and make targeted changes safer.

Risk: Medium. Fragment root IDs and `outerHTML` ownership must remain unchanged.

## Priority 3: Remove Duplication

### 16. Share HTTP error-message normalization

Files: `src/http/api/benchmarks.ts:4`, `data_forge.ts:4`, `failure_maps.ts:4`, `gym.ts:11`; `src/http/ui/benchmarks.tsx:25`, `data_forge.tsx:9`, `failures.tsx:8`, `settings.tsx:15`

Change: Add one small helper in `src/http/respond.tsx` or a non-JSX `src/http` utility and use it across API and UI handlers.

Why: The same `error instanceof Error ? error.message : 'Unexpected error.'` expression is repeated eight times. Centralizing it improves consistency and removes local boilerplate without obscuring domain-specific status selection.

Risk: Low.

### 17. Share unknown-body normalization

Files: `src/http/api/data_forge.ts:6-21,33`, `src/http/api/gym.ts:25,43`, `src/http/ui/benchmarks.tsx:53`, `src/http/ui/data_forge.tsx:11-30,91`, `src/http/ui/failures.tsx:11`

Change: Introduce one narrowly named helper such as `recordBody(value): Record<string, unknown>`. Keep endpoint-specific parsing local.

Why: The same defensive object check appears throughout route files. A one-line shared guard would let each handler show only fields that matter to that endpoint.

Risk: Low.

### 18. Use one data-forge input parser for API and UI routes

Files: `src/http/api/data_forge.ts:6-21`, `src/http/ui/data_forge.tsx:11-30`

Change: Extract request-shape parsing to one HTTP-layer helper. Do not move it into the domain service; snake_case form/API transport names do not belong in domain logic.

Why: The two implementations parse the same run ID, prompt revision, backend, provider model, document count, threshold, and auto-approve flag. They already differ subtly: the API allows an undefined backend while the UI defaults to `data_designer`.

Risk: Low to medium. Decide which backend default is intended and add parser tests.

### 19. Share run metric display helpers

Files: `src/views/tabs/Failures.tsx:31-41`, `src/views/tabs/Results.tsx:13-36`

Change: Move the shared dash, tinted count, and percentage rendering into a small view helper or UI component. Allow the failure view’s additional `warn` tone.

Why: The implementations are nearly identical and encode an important semantic rule: missing data is an em dash, not zero. Keeping one implementation prevents these screens from drifting.

Risk: Low.

### 20. Reuse stage-number formatting

Files: `src/views/layout/tabs.ts:25-26`, `src/views/layout/Handoff.tsx:24,37`

Change: Use `stageNumber` from `tabs.ts` instead of local `padStart` expressions and the special-cased `'01'`.

Why: The codebase already names this formatting rule. Reimplementing it in the neighboring layout module makes the special case harder to understand.

Risk: Low.

### 21. Consolidate repeated provider-setting definitions

Files: `src/gym/settings.ts:15-33,115-141,260-267`, `src/http/api/settings.ts:8-15`, `src/views/tabs/Settings.tsx`

Change: Define transport-safe setting keys and provider metadata once, then derive input filtering and repeated test configuration from it. Keep secret/public distinctions explicit.

Why: Key names and provider fallback chains are repeated in several places. Adding or renaming one setting currently requires synchronized edits across storage, API filtering, testing, and UI.

Risk: Medium. Do not accidentally expose secret values through metadata returned to the browser.

## Priority 4: Naming Improvements

### 22. Rename ambiguous Gym result functions

File: `src/gym/results.ts:50,292`

Change: Rename `counter` to `createRolloutCounter` and `read` to `readRollouts`.

Why: Both names require import aliases or source-file context to understand. They represent specific operations and are used in long orchestration code where explicit names improve scanning.

Risk: Low. Update tests and imports together.

### 23. Rename generic source and format operations at call sites

Files: `src/lib/source.ts:46,109,152`, `src/lib/formats.ts:90,111`, `src/lib/harbor.ts:69,109`, `src/lib/tabular.ts:94,137`

Change: Prefer names such as `parseSource`, `pinSource`, `resolveSource`, `detectFormat`, `formatById`, `readTasks`, and `detectHarbor` where modules are commonly namespace-imported alongside other modules with `read`, `detect`, or `resolve` functions.

Why: Generic names are acceptable inside a tiny module, but orchestration code contains several `read`, `detect`, `resolve`, and `get` operations from different namespaces. More explicit exported names reduce backtracking.

Risk: Medium because this is broad rename churn. Do it only where call-site readability measurably improves.

### 24. Rename `mb` to describe its real behavior

File: `src/views/tabs/settings/GymPanel.tsx:22-27`

Change: Rename `mb` to `formatBytes`.

Why: It emits bytes, KB, MB, or GB, so `mb` is inaccurate. The implementation itself is clear; only the name is misleading.

Risk: Low.

### 25. Replace one-letter or overloaded local names in complex code

Files: `src/gym/lifecycle.ts:119`, `src/gym/storage.ts:171`, `src/domain/benchmarks/service.ts` and large view row renderers

Change: Prefer `resolvePromise` over `r`, `entry` over `e`, and domain terms over generic `item`, `row`, or `value` when several different row/value shapes share one function.

Why: Short names are harmless in tiny callbacks, but they increase cognitive load in lifecycle, storage, import, and ingestion paths that already carry several kinds of identifiers and rows.

Risk: Low. Apply selectively; avoid wholesale cosmetic churn.

### 26. Clarify the two meanings of “result”

Files: `src/domain/runs/model.ts`, `src/domain/runs/repo.ts`, `src/domain/runs/ingest.ts`, result views

Change: Where practical, use `runOutcome` or `taskOutcome` for status strings and reserve `benchmarkResult` for the persisted aggregate entity. Use `criterionVerdict` for `pass`/`fail`/`error` values.

Why: `result` currently names a database entity, an outcome string, a parsed provider response, and view state. More specific local names would make run ingestion and rendering easier to reason about.

Risk: Medium. Prefer local and type-property improvements over a large database/schema rename.

## Priority 5: Comment Quality

### 27. Keep invariant comments; trim comments that narrate syntax

Files: repository-wide, especially `src/views/tabs/Results.tsx`, `src/views/tabs/Failures.tsx`, `public/css/ledger.css`

Change: Retain comments that explain domain distinctions, data provenance, security boundaries, race conditions, or non-obvious browser behavior. Remove comments that merely introduce the immediately following component, selector, or straightforward branch.

Why: The strongest comments in this codebase explain facts such as criterion IDs repeating across tasks, ungraded not meaning failed, hostile archives, and process-group ownership. Those are valuable. Repeated section narration and obvious JSX/CSS descriptions make those important comments less visible.

Risk: Low, but review comments individually rather than applying a blanket deletion rule.

### 28. Shorten oversized file headers

Files: `src/boot.ts:1-10`, `src/gym/pins.ts:1-15`, `src/gym/repin.ts:1-11`, `src/domain/runs/service.ts`, `src/lib/archive.ts`

Change: Keep a one- or two-sentence statement of responsibility at the top. Move operational details next to the code that enforces them or into maintained architecture documentation when they apply across the module.

Why: Several headers are excellent design notes but are long enough to delay reaching the module API. Local comments near the relevant branch are easier to keep synchronized with implementation.

Risk: Low. Do not remove safety rationale that has no other home.

### 29. Fix stale or inaccurate comments immediately

Files: `public/js/app.js:52-53`, `src/config.ts:4`, `src/http/schema.ts:8`

Change: Delete the stale `todo.md section 6` reference with the hold code. Narrow the config header’s claim that nothing else reads `process.env`, because `src/index.ts:31` reads `NODE_ENV`. Update or remove “proposed” wording for the ledger page based on its actual status.

Why: Incorrect comments are worse than absent comments in a readability-focused codebase because readers use them as architectural guarantees.

Risk: Low.

### 30. Document intentionally swallowed errors consistently

Files: catch blocks in `src/lib/tabular.ts`, `src/lib/harbor.ts`, `src/lib/archive.ts`, `src/gym/results.ts`, `src/gym/pins.ts`, `src/gym/storage.ts`, and services

Change: For each empty catch, either add a short reason that the failure is safely ignorable, return/record a useful degraded-state reason, or let the error propagate. Do not add generic “ignore error” comments.

Why: Some swallowed errors are carefully justified, while others silently turn malformed files or inaccessible paths into empty data. Consistent intent makes it easier to distinguish resilience from accidental information loss.

Risk: Medium if behavior changes. Comment-only clarifications are low risk.

## Priority 6: Type and API Clarity

### 31. Replace assertion-based request bodies with schemas

Files: all `src/http/api/*.ts` and form handlers under `src/http/ui/*.tsx`

Change: Use Elysia/TypeBox request schemas for public JSON routes, with small explicit form parsers for HTMX form bodies. Start with benchmark import and data-forge endpoints, which currently cast nested input directly to domain types.

Why: Expressions such as `preview as benchmarks.ImportPreview` and `plan as Partial<benchmarks.ImportPlan>` make untrusted transport data look validated when it is not. Schemas improve both runtime safety and route readability by declaring accepted input beside the route.

Risk: Medium. Preserve current error messages and accepted form encodings.

### 32. Give exported functions explicit return types at boundaries

Files: service aliases and public functions such as `src/domain/runs/service.ts:68`, `src/domain/benchmarks/repo.ts:182`, `src/domain/data_forge/service.ts:17`, `src/gym/settings.ts:260`

Change: Add explicit return types to domain service APIs, repo functions returning inferred structural rows, and HTTP-shared helpers. Internal one-line helpers can remain inferred.

Why: Boundary signatures are the fastest way to understand a module without reading its body. Inference is less helpful when it exposes a large anonymous structural type or changes accidentally with an implementation edit.

Risk: Low to medium. Some inferred types may reveal that a named model type is missing.

### 33. Reduce service modules that only re-export repositories

Files: `src/domain/jobs/service.ts:1-8`, `src/domain/environments/service.ts:1-6`, simple aliases in prompts, topics, benchmarks, runs, and failure maps services

Change: Keep the service boundary required by AGENTS.md, but use explicit named wrapper functions when the service is an intentional API or add rules there when they exist. Avoid a growing mix where some names are wrappers and others are direct repo aliases with no visible distinction.

Why: Direct aliases are concise, but they make service APIs inherit repo naming and signatures accidentally. A reader cannot tell whether the lack of orchestration is intentional or temporary.

Risk: Low if done selectively. Do not add wrappers solely to increase line count.

### 34. Keep models free of view-specific wording where possible

Files: `src/domain/topics/model.ts:13-25`, `src/domain/runs/model.ts`, `src/domain/inventory/model.ts`

Change: Separate persisted/domain concepts from projections that exist specifically for one page when those projections grow. For example, `TopicRow` currently includes table counts and is described as “the failure-map table renders it.”

Why: View-oriented model names make later non-view consumers inherit display concerns. Clear projection names such as `TopicSummary` or `TopicWithCounts` explain why aggregate fields are present.

Risk: Medium. Avoid splitting types until there is a second consumer or real ambiguity.

## Priority 7: Focused Readability Improvements

### 35. Simplify `steps.ts` constant functions

File: `src/domain/runs/steps.ts:13-16,29-43`

Change: Replace zero-argument functions such as `starting()` and `preparing()` with named constants, while retaining functions that interpolate values.

Why: A function implies computation or deferred behavior. These four functions return fixed strings and add call punctuation everywhere without adding meaning.

Risk: Low.

### 36. Make storage represent multiple paths as data, not newline-delimited text

Files: `src/gym/storage.ts:20-36,118-120,167-171,217`, `src/views/tabs/settings/GymPanel.tsx:146-148`

Change: Give a bucket `paths: string[]` or a dedicated union shape instead of joining multiple prepared-asset paths with `\n` and splitting them later.

Why: Newline-delimited strings are presentation encoding inside domain/infrastructure data. Readers must discover the convention across multiple files, and a path containing a newline would be ambiguous.

Risk: Medium. Update inventory and settings projections together.

### 37. Replace repeated linear bucket lookup plus non-null assertions

File: `src/gym/storage.ts:47-130`

Change: Build named bucket variables before the list or use a record keyed by a `BucketId` union, then return `Object.values` in display order.

Why: `list.find(... )!` is used to recover objects the same function just created. Named objects or a typed record would remove assertions and make mutation targets obvious.

Risk: Low to medium.

### 38. Introduce a typed `BucketId`

File: `src/gym/storage.ts:20-38,211`

Change: Define the six IDs once as a readonly tuple/union and derive the validation set from it.

Why: `Bucket.id` is currently any string while `BUCKET_IDS` separately defines valid values. A union documents valid IDs in function signatures and catches typos before runtime.

Risk: Low.

### 39. Clarify lock acquisition control flow

File: `src/boot.ts:29-57`

Change: Extract the stale-lock PID check into a small helper or use a named `isProcessAlive(pid)` function. Replace exception-message prefix matching with a dedicated error class or direct branch result.

Why: The current nested try/catch uses thrown errors both for process probing and for application control flow, then recognizes its own error by message text. It works, but takes careful reading to prove stale locks are removed safely.

Risk: Medium because lock behavior is concurrency-sensitive. Add focused tests before changing it.

### 40. Make Gym lifecycle process helpers consistent

File: `src/gym/lifecycle.ts:73-119`

Change: Use parallel names and signatures for process and process-group operations, for example `isProcessAlive`, `signalProcess`, `isProcessGroupAlive`, and `signalProcessGroup`. Consider one private helper if it genuinely removes duplicated try/catch logic.

Why: `alive`, `signal`, `groupAlive`, and `signalGroup` are related but use inconsistent specificity. These names occur in safety-critical shutdown code where explicit ownership matters.

Risk: Low for naming, medium for structural changes.

### 41. Reduce one-line JSX in dense tables

Files: `src/views/tabs/DataForge.tsx:95-129,280-287`, `src/views/tabs/Results.tsx:182-194`, `src/views/tabs/Benchmarks.tsx:125-152`

Change: Format table headers, rows, forms, and document cards with one meaningful element per line. Extract a component only when it represents a named concept.

Why: Several sections are technically below line limits because many JSX elements are compressed onto single lines. This defeats the repository’s “read in one sitting” goal and makes diffs harder to review.

Risk: Low. Expect line counts to rise, which reinforces the need for the splits above.

### 42. Avoid comments as substitutes for domain names

Files: `src/domain/runs/repo.ts:45`, abbreviations and short aliases across repos

Change: Replace comments such as `br = benchmark runs` by using the full SQL alias where query readability permits. Keep short aliases only in joins where full names would materially obscure the query.

Why: If an alias needs a glossary comment, the name is costing more than it saves. SQL is a major part of this codebase and should be readable without decoding local abbreviations.

Risk: Low.

## Priority 8: Tests and Tooling

### 43. Add tests for import boundaries and ignored failure modes

Files: `src/lib/archive.ts`, `src/lib/tabular.ts`, `src/lib/harbor.ts`, `src/lib/source.ts`

Change: Add small fixture-based tests for hostile archive paths, truncated JSONL, malformed task files, immutable-ref resolution, and size limits.

Why: These modules have careful comments and defensive branches but little visible test coverage. Tests would let later readability refactors simplify control flow without weakening hostile-input guarantees.

Risk: Low.

### 44. Add tests before refactoring boot and lifecycle code

Files: `src/boot.ts`, `src/gym/lifecycle.ts`, `src/gym/spawn.ts`

Change: Isolate pure decisions where possible and test stale locks, invalid component names, missing Gym CLI, process discovery parsing, and shutdown escalation.

Why: These are the least safe areas for a readability-only rewrite because they coordinate real processes and `/proc`. Tests should precede restructuring.

Risk: Low for tests, high for untested refactors.

### 45. Add a CSS/JavaScript size check or broaden the existing check

File: `scripts/check-size.ts:14`

Change: Include first-party `.js` and `.css`, with thresholds appropriate to those file types, or add a separate readability report.

Why: The current rule catches 486-line TypeScript but ignores a 486-line browser script and a 2,168-line stylesheet. The enforcement does not match the stated goal.

Risk: Low. Introduce warnings before hard failures so existing large files can be split deliberately.

### 46. Add a dead-code/reference audit to `check`

Files: `package.json`, `tsconfig.json`

Change: Start with TypeScript unused checks. Consider a tool such as Knip only if it can be configured without false positives from Elysia route registration, JSX, Bun scripts, and static assets.

Why: The current audit found unused imports, locals, parameters, exports, and an entire unused browser interaction. A lightweight automated check would keep future cleanups small.

Risk: Low for compiler checks; medium for adding a new dependency.

## Suggested Execution Order

1. Fix `.gitignore`, make all intended source visible, and verify the diff.
2. Fix the test script and enable unused checks after deleting the seven current findings.
3. Remove confirmed dead code: hold-to-confirm, unused exports/types, unused reads, and unused props.
4. Resolve product decisions around the recurse placeholder, design-study routes, mockups, and tracked outputs.
5. Apply low-risk shared helpers and naming improvements.
6. Split `ledger.css` and `app.js` with manual browser verification.
7. Split near-limit domain services without violating the three-file domain rule.
8. Improve request schemas and boundary types.
9. Refactor process/archive code only after adding focused tests.

## Verification Per Batch

- Run `bun run check`.
- Run `bun test ./tests` until the package script is corrected, then run `bun test`.
- For schema changes, run `bun run db:reset` and rerun checks/tests.
- For frontend changes, exercise desktop and mobile layouts, theme and density controls, task filtering, dialogs, settings save/test, document review, and HTMX `outerHTML` swaps.
- For Gym lifecycle changes, do not kill a running process without asking. Test start/stop only when the environment is intentionally available.
