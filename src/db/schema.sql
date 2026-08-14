-- ============================================================================
-- The whole domain schema.
--
-- Conventions (AGENTS.md § Database conventions):
--   * id INTEGER PRIMARY KEY AUTOINCREMENT; display codes come from ids.ts
--   * timestamps are TEXT ISO-8601 UTC, named created_at/updated_at/
--     started_at/finished_at and nothing else
--   * JSON columns end in _json and are NOT NULL DEFAULT '{}' + json_valid
--   * execution status lives on `jobs`; entities carry lifecycle status only
--   * no views
--
-- The pipeline chain, which `scripts/check-chain.ts` asserts every link of:
--
--   benchmarks
--     ├─ benchmark_tasks ─ benchmark_task_criteria
--     └─ benchmark_runs
--          ├─ benchmark_run_tasks ──▶ benchmark_tasks     (what it was asked to run)
--          └─ benchmark_results                           (one rollup per run)
--               ├─ task_results                 (one per task/trial)
--               │    └─ criterion_results ──▶ benchmark_task_criteria
--               └─ failure_maps
--                    ├─ topics
--                    └─ failure_items ──▶ criterion_results, topics
--
-- and onward: failure_maps -> data_forge_runs -> documents -> verifiers/environments
-- ============================================================================

-- Execution ------------------------------------------------------------------
-- One table for every long-running thing. Replaces six near-identical tables in
-- the previous schema, each with its own runner and its own log column.

CREATE TABLE jobs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  -- What kind of work this is. Widen this list rather than adding a table.
  kind         TEXT    NOT NULL CHECK (kind IN (
                 'benchmark_import','benchmark_run','failure_map','data_forge_run',
                 'env_build','env_eval','env_publish','training')),
  -- The domain row this job acts on: table name + its integer id.
  subject_type TEXT    NOT NULL,
  subject_id   INTEGER NOT NULL,
  status       TEXT    NOT NULL CHECK (status IN
                 ('queued','running','succeeded','failed','cancelled')),
  step         TEXT    NOT NULL DEFAULT '',   -- human label of the current phase
  progress     REAL    NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 1),
  pgid         INTEGER,                       -- process group, so cancel can kill children
  exit_code    INTEGER,
  error        TEXT,
  params_json  TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(params_json)),
  result_json  TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(result_json)),
  created_at   TEXT    NOT NULL,
  started_at   TEXT,
  finished_at  TEXT
);
CREATE INDEX idx_jobs_subject ON jobs(subject_type, subject_id, created_at DESC);
CREATE INDEX idx_jobs_active  ON jobs(status, created_at DESC);

-- Log lines as rows, not an appended TEXT column: tailing is a LIMIT, and
-- incremental fetch is `seq > ?`, so appending never rewrites a large string.
CREATE TABLE job_log_lines (
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  seq    INTEGER NOT NULL,
  at     TEXT    NOT NULL,
  stream TEXT    NOT NULL CHECK (stream IN ('out','err')),
  line   TEXT    NOT NULL,
  PRIMARY KEY (job_id, seq)
);

-- Prompt provenance ----------------------------------------------------------
-- Every LLM call records which prompt revision produced it, so a result can
-- always be traced back to the exact text that generated it.

CREATE TABLE prompt_templates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt_key TEXT    NOT NULL UNIQUE,   -- 'failure-analysis' | 'document-generation'
  name       TEXT    NOT NULL,
  purpose    TEXT    NOT NULL CHECK (purpose IN ('analysis','generation','verifier')),
  description TEXT   NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);

CREATE TABLE prompt_revisions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id     INTEGER NOT NULL REFERENCES prompt_templates(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  body            TEXT    NOT NULL CHECK (length(trim(body)) > 0),
  model_hint      TEXT    NOT NULL DEFAULT '',
  is_active       INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1)),
  created_at      TEXT    NOT NULL,
  UNIQUE (template_id, revision_number)
);
-- Exactly one active revision per template.
CREATE UNIQUE INDEX idx_prompt_active ON prompt_revisions(template_id) WHERE is_active = 1;

-- Benchmarks -----------------------------------------------------------------

CREATE TABLE benchmarks (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL,
  lab               TEXT    NOT NULL DEFAULT '',
  source_url        TEXT    NOT NULL DEFAULT '',
  source_kind       TEXT    NOT NULL CHECK (source_kind IN ('github','huggingface','builtin')),
  source_identifier TEXT    NOT NULL DEFAULT '',
  revision          TEXT    NOT NULL DEFAULT '',
  detected_format   TEXT    NOT NULL DEFAULT '',   -- e.g. 'harbor'
  adapter           TEXT    NOT NULL,              -- gym resources server / agent to use
  status            TEXT    NOT NULL CHECK (status IN ('importing','ready','failed')),
  runnable          INTEGER NOT NULL DEFAULT 0 CHECK (runnable IN (0,1)),
  snapshot_path     TEXT,
  input_path        TEXT,
  description       TEXT    NOT NULL DEFAULT '',
  metadata_json     TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL
);

CREATE TABLE benchmark_tasks (
  benchmark_id  INTEGER NOT NULL REFERENCES benchmarks(id) ON DELETE CASCADE,
  dataset       TEXT    NOT NULL DEFAULT 'validation',
  task_id       TEXT    NOT NULL,           -- the benchmark's own opaque id
  name          TEXT    NOT NULL,
  source_path   TEXT    NOT NULL DEFAULT '',
  position      INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  PRIMARY KEY (benchmark_id, dataset, task_id)
);

-- Criterion catalog ---------------------------------------------------------
-- Criteria are part of a task definition, not of a run result. A task may
-- have dozens of criteria, and criterion ids such as C-001 are only unique
-- within that task.

CREATE TABLE benchmark_task_criteria (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  benchmark_id  INTEGER NOT NULL,
  dataset       TEXT    NOT NULL DEFAULT 'validation',
  task_id       TEXT    NOT NULL,
  criterion_id  TEXT    NOT NULL,
  title         TEXT    NOT NULL,
  match_criteria TEXT   NOT NULL DEFAULT '',
  position      INTEGER NOT NULL DEFAULT 0,
  source_json   TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(source_json)),
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  FOREIGN KEY (benchmark_id, dataset, task_id)
    REFERENCES benchmark_tasks(benchmark_id, dataset, task_id)
    ON DELETE CASCADE,
  UNIQUE (benchmark_id, dataset, task_id, criterion_id)
);
CREATE INDEX idx_task_criteria_task
  ON benchmark_task_criteria(benchmark_id, dataset, task_id, position);
-- Parent key for the composite FK on criterion_results. `id` is
-- already unique on its own; pairing it with task_id is what lets a child row
-- prove its criterion and its task result refer to the same task.
CREATE UNIQUE INDEX idx_task_criteria_id_task ON benchmark_task_criteria(id, task_id);

-- Leakage control: fingerprints of the benchmark's own source documents, so the
-- forge can prove a generated document is not a paraphrase of one.
CREATE TABLE benchmark_sources (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id           TEXT    NOT NULL,
  relative_path     TEXT    NOT NULL,
  content_sha256    TEXT    NOT NULL UNIQUE,
  normalized_sha256 TEXT    NOT NULL,
  word_count        INTEGER NOT NULL CHECK (word_count >= 0),
  shingles_json     TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(shingles_json)),
  created_at        TEXT    NOT NULL,
  UNIQUE (task_id, relative_path)
);
CREATE INDEX idx_sources_task ON benchmark_sources(task_id);

-- BR — benchmark run ---------------------------------------------------------
-- Exactly one model per run. See AGENTS.md § Domain rules.

CREATE TABLE benchmark_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  benchmark_id  INTEGER NOT NULL REFERENCES benchmarks(id) ON DELETE RESTRICT,
  label         TEXT    NOT NULL DEFAULT '',   -- human name, e.g. "harvey_001"
  model         TEXT    NOT NULL,              -- the single model under test
  task_count    INTEGER NOT NULL DEFAULT 0,
  -- Sampling knobs, judge parallelism, agent budget. No credentials, ever.
  settings_json TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(settings_json)),
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
);
CREATE INDEX idx_runs_created ON benchmark_runs(created_at DESC);

-- Which catalog tasks this run was asked to execute. Written when the run is
-- created, before anything has executed, so a run that fails early still says
-- what it was meant to do. This is the benchmark_runs -> benchmark_tasks edge;
-- task_results below says what actually happened to each of them.
CREATE TABLE benchmark_run_tasks (
  benchmark_run_id INTEGER NOT NULL REFERENCES benchmark_runs(id) ON DELETE CASCADE,
  benchmark_id     INTEGER NOT NULL,
  dataset          TEXT    NOT NULL DEFAULT 'validation',
  task_id          TEXT    NOT NULL,
  position         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (benchmark_run_id, dataset, task_id),
  FOREIGN KEY (benchmark_id, dataset, task_id)
    REFERENCES benchmark_tasks(benchmark_id, dataset, task_id)
    ON DELETE CASCADE
);
CREATE INDEX idx_run_tasks_task ON benchmark_run_tasks(benchmark_id, dataset, task_id);

-- BR — aggregate result -----------------------------------------------------
-- One normalized result envelope belongs to one benchmark run. It is the
-- benchmark-wide sum of all task results and the owner of failure analysis.
CREATE TABLE benchmark_results (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  benchmark_run_id INTEGER NOT NULL UNIQUE REFERENCES benchmark_runs(id) ON DELETE CASCADE,
  benchmark_id    INTEGER NOT NULL REFERENCES benchmarks(id) ON DELETE CASCADE,
  result          TEXT    NOT NULL CHECK (result IN ('passed','failed','error','skipped')),
  tasks_total     INTEGER NOT NULL DEFAULT 0 CHECK (tasks_total >= 0),
  tasks_passed    INTEGER NOT NULL DEFAULT 0 CHECK (tasks_passed >= 0),
  tasks_failed    INTEGER NOT NULL DEFAULT 0 CHECK (tasks_failed >= 0),
  tasks_error     INTEGER NOT NULL DEFAULT 0 CHECK (tasks_error >= 0),
  tasks_skipped   INTEGER NOT NULL DEFAULT 0 CHECK (tasks_skipped >= 0),
  criteria_total  INTEGER CHECK (criteria_total IS NULL OR criteria_total >= 0),
  criteria_passed INTEGER CHECK (criteria_passed IS NULL OR criteria_passed >= 0),
  criteria_failed INTEGER CHECK (criteria_failed IS NULL OR criteria_failed >= 0),
  pass_rate       REAL CHECK (pass_rate IS NULL OR (pass_rate >= 0 AND pass_rate <= 1)),
  reward          REAL,
  result_path     TEXT,
  metrics_json    TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(metrics_json)),
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL
);
CREATE INDEX idx_benchmark_results_run ON benchmark_results(benchmark_run_id);

-- One task result per aggregate result and trial. The catalog task row above
-- says what exists; this row says what happened for a particular run.
CREATE TABLE task_results (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  benchmark_result_id INTEGER NOT NULL REFERENCES benchmark_results(id) ON DELETE CASCADE,
  benchmark_id    INTEGER NOT NULL REFERENCES benchmarks(id) ON DELETE CASCADE,
  dataset         TEXT    NOT NULL DEFAULT 'validation',
  task_id         TEXT    NOT NULL,
  trial_name      TEXT    NOT NULL DEFAULT 'trial-1',
  result          TEXT    NOT NULL CHECK (result IN ('passed','failed','error','skipped')),
  reward          REAL,
  criteria_total  INTEGER CHECK (criteria_total IS NULL OR criteria_total >= 0),
  criteria_passed INTEGER CHECK (criteria_passed IS NULL OR criteria_passed >= 0),
  criteria_failed INTEGER CHECK (criteria_failed IS NULL OR criteria_failed >= 0),
  result_path     TEXT,
  metrics_json    TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(metrics_json)),
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL,
  FOREIGN KEY (benchmark_id, dataset, task_id)
    REFERENCES benchmark_tasks(benchmark_id, dataset, task_id)
    ON DELETE CASCADE,
  UNIQUE (benchmark_result_id, dataset, task_id, trial_name)
);
CREATE INDEX idx_task_results_result
  ON task_results(benchmark_result_id, created_at DESC);
CREATE INDEX idx_task_results_task
  ON task_results(benchmark_id, dataset, task_id, created_at DESC);
-- The other half of that composite parent key. See the criterion table above.
CREATE UNIQUE INDEX idx_task_results_id_task
  ON task_results(id, task_id);

-- Criterion inspection ------------------------------------------------------
-- Preserve the judge's result and explanation for one task result against
-- one static task criterion.
CREATE TABLE criterion_results (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_result_id              INTEGER NOT NULL,
  benchmark_task_criterion_id INTEGER NOT NULL,
  -- Not a copy: `task_id` is part of both foreign keys below, so the criterion
  -- being judged and the task result being judged must agree on the task. Two
  -- independent single-column FKs would each be satisfied by a criterion
  -- belonging to a *different* task, and because criterion ids repeat across
  -- tasks that mistake would reconcile perfectly in every count.
  task_id                     TEXT    NOT NULL,
  trial_name                  TEXT    NOT NULL DEFAULT '',
  criterion_id                TEXT    NOT NULL,
  criterion_title             TEXT    NOT NULL,
  -- Same vocabulary as task_results.result and benchmark_results.result, one
  -- level down: pass/fail is per criterion, passed/failed is per task and run.
  result                      TEXT    NOT NULL CHECK (result IN ('pass','fail','error')),
  reasoning                   TEXT    NOT NULL DEFAULT '',
  match_criteria              TEXT    NOT NULL DEFAULT '',
  judge_model                 TEXT    NOT NULL DEFAULT '',
  judge_error                 INTEGER NOT NULL DEFAULT 0 CHECK (judge_error IN (0,1)),
  error_type                  TEXT,
  source_json                 TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(source_json)),
  created_at                  TEXT    NOT NULL,
  updated_at                  TEXT    NOT NULL,
  FOREIGN KEY (task_result_id, task_id)
    REFERENCES task_results(id, task_id) ON DELETE CASCADE,
  FOREIGN KEY (benchmark_task_criterion_id, task_id)
    REFERENCES benchmark_task_criteria(id, task_id) ON DELETE RESTRICT,
  UNIQUE (task_result_id, benchmark_task_criterion_id)
);
CREATE INDEX idx_criterion_results_task_result
  ON criterion_results(task_result_id, criterion_id);
CREATE INDEX idx_criterion_results_criterion
  ON criterion_results(benchmark_task_criterion_id);

-- FM — failure map -----------------------------------------------------------

CREATE TABLE failure_maps (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  benchmark_result_id INTEGER NOT NULL REFERENCES benchmark_results(id) ON DELETE CASCADE,
  prompt_revision_id INTEGER NOT NULL REFERENCES prompt_revisions(id) ON DELETE RESTRICT,
  provider_model     TEXT    NOT NULL,          -- the analyst model that grouped the failures
  usage_json         TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(usage_json)),
  raw_output_json    TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(raw_output_json)),
  created_at         TEXT    NOT NULL,
  updated_at         TEXT    NOT NULL
);
-- One failure map per benchmark result.
CREATE UNIQUE INDEX idx_fm_one_per_result ON failure_maps(benchmark_result_id);

-- TP — topic. Topics are extracted from one failure map's failed criteria.
CREATE TABLE topics (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  failure_map_id    INTEGER NOT NULL REFERENCES failure_maps(id) ON DELETE CASCADE,
  name              TEXT    NOT NULL,
  slug              TEXT    NOT NULL,
  description       TEXT    NOT NULL DEFAULT '',
  -- The observable behaviour a verifier should check. This, the name and the
  -- description are the ONLY things the document generator may see.
  verifier_strategy TEXT    NOT NULL DEFAULT '',
  status            TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL,
  UNIQUE (failure_map_id, slug)
);
CREATE INDEX idx_topics_failure_map ON topics(failure_map_id);

-- FI — failure item. One failed grading criterion on one task.
CREATE TABLE failure_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  failure_map_id  INTEGER NOT NULL REFERENCES failure_maps(id) ON DELETE CASCADE,
  benchmark_result_id INTEGER NOT NULL REFERENCES benchmark_results(id) ON DELETE CASCADE,
  criterion_result_id INTEGER NOT NULL REFERENCES criterion_results(id) ON DELETE RESTRICT,
  topic_id        INTEGER REFERENCES topics(id) ON DELETE SET NULL,
  task_id         TEXT    NOT NULL,
  trial_name      TEXT    NOT NULL DEFAULT '',
  criterion_id    TEXT    NOT NULL,
  criterion_title TEXT    NOT NULL,
  reasoning       TEXT    NOT NULL,           -- the judge's prose for this miss
  capability      TEXT    NOT NULL DEFAULT '',
  severity        TEXT    NOT NULL DEFAULT 'medium'
                    CHECK (severity IN ('low','medium','high','critical')),
  status          TEXT    NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','approved','ignored')),
  occurrences     INTEGER NOT NULL DEFAULT 1 CHECK (occurrences > 0),
  source_json     TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(source_json)),
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL,
  UNIQUE (failure_map_id, criterion_result_id)
);
CREATE INDEX idx_failure_items_map   ON failure_items(failure_map_id);
CREATE INDEX idx_failure_items_result ON failure_items(benchmark_result_id);
CREATE INDEX idx_failure_items_criterion_result ON failure_items(criterion_result_id);
CREATE INDEX idx_failure_items_topic ON failure_items(topic_id, status);

-- DF — data forge run --------------------------------------------------------

CREATE TABLE data_forge_runs (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  failure_map_id     INTEGER NOT NULL REFERENCES failure_maps(id) ON DELETE RESTRICT,
  prompt_revision_id INTEGER NOT NULL REFERENCES prompt_revisions(id) ON DELETE RESTRICT,
  backend            TEXT    NOT NULL DEFAULT 'data_designer'
                       CHECK (backend IN ('data_designer','frontier')),
  provider_model     TEXT    NOT NULL,
  docs_per_topic     INTEGER NOT NULL DEFAULT 3 CHECK (docs_per_topic BETWEEN 1 AND 100),
  -- A generated document scoring above this similarity to any known source is
  -- rejected outright and can never be approved.
  novelty_threshold  REAL    NOT NULL DEFAULT 0.22
                       CHECK (novelty_threshold > 0 AND novelty_threshold < 1),
  auto_approve       INTEGER NOT NULL DEFAULT 0 CHECK (auto_approve IN (0,1)),
  requested_documents INTEGER NOT NULL DEFAULT 0,
  usage_json         TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(usage_json)),
  created_at         TEXT    NOT NULL,
  updated_at         TEXT    NOT NULL
);
-- One data forge run per failure map.
CREATE UNIQUE INDEX idx_data_forge_one_per_map ON data_forge_runs(failure_map_id);

-- Which failure items this forge run was asked to address.
CREATE TABLE data_forge_run_items (
  data_forge_run_id    INTEGER NOT NULL REFERENCES data_forge_runs(id) ON DELETE CASCADE,
  failure_item_id INTEGER NOT NULL REFERENCES failure_items(id) ON DELETE RESTRICT,
  PRIMARY KEY (data_forge_run_id, failure_item_id)
);

-- DOC — synthetic document ---------------------------------------------------

CREATE TABLE documents (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  data_forge_run_id     INTEGER NOT NULL REFERENCES data_forge_runs(id) ON DELETE CASCADE,
  failure_item_id       INTEGER NOT NULL REFERENCES failure_items(id) ON DELETE RESTRICT,
  topic_id              INTEGER REFERENCES topics(id) ON DELETE SET NULL,
  ordinal               INTEGER NOT NULL CHECK (ordinal > 0),

  title                 TEXT    NOT NULL,
  document_type         TEXT    NOT NULL,     -- memo | email | contract | record | ...
  content               TEXT    NOT NULL,     -- the synthetic source document
  task_instruction      TEXT    NOT NULL,
  reference_answer      TEXT    NOT NULL,     -- never shown to the agent
  verifier_targets_json TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(verifier_targets_json)),

  -- Novelty fingerprint.
  content_sha256        TEXT    NOT NULL,
  normalized_sha256     TEXT    NOT NULL,
  shingles_json         TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(shingles_json)),
  word_count            INTEGER NOT NULL CHECK (word_count > 0),
  max_similarity        REAL    NOT NULL DEFAULT 0 CHECK (max_similarity BETWEEN 0 AND 1),
  nearest_source        TEXT,
  -- One-way gate: 'rejected' can never become approved. See AGENTS.md.
  novelty_status        TEXT    NOT NULL CHECK (novelty_status IN ('passed','rejected','review')),
  novelty_json          TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(novelty_json)),

  -- Human gate, then the split it lands in.
  review_status         TEXT    NOT NULL DEFAULT 'pending'
                          CHECK (review_status IN ('pending','approved','rejected')),
  role                  TEXT    NOT NULL DEFAULT 'train'
                          CHECK (role IN ('train','canary','heldout','excluded')),

  generation_attempt    INTEGER NOT NULL DEFAULT 1 CHECK (generation_attempt > 0),
  retry_of_document_id  INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  retry_reason          TEXT,
  created_at            TEXT    NOT NULL,
  reviewed_at           TEXT,
  UNIQUE (data_forge_run_id, failure_item_id, ordinal)
);
CREATE INDEX idx_documents_data_forge_run ON documents(data_forge_run_id);
CREATE INDEX idx_documents_topic ON documents(topic_id, novelty_status, review_status, role);
CREATE INDEX idx_documents_hash  ON documents(content_sha256);

-- VF / ENV — verifiers and environments --------------------------------------
-- One topic = one verifier = one environment package.

CREATE TABLE verifiers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id       INTEGER NOT NULL REFERENCES topics(id) ON DELETE RESTRICT,
  name           TEXT    NOT NULL,
  version        INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  kind           TEXT    NOT NULL CHECK (kind IN ('rules','llm','hybrid','python')),
  status         TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','archived')),
  description    TEXT    NOT NULL DEFAULT '',
  rubric_json    TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(rubric_json)),
  code           TEXT    NOT NULL DEFAULT '',   -- optional python score(task, state)
  -- A floor, not a quality bar. The learnability signal is the real gate.
  pass_threshold REAL    NOT NULL DEFAULT 0.3 CHECK (pass_threshold BETWEEN 0 AND 1),
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL,
  UNIQUE (topic_id, name, version)
);

CREATE TABLE environments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  benchmark_run_id INTEGER NOT NULL REFERENCES benchmark_runs(id) ON DELETE RESTRICT,
  topic_id        INTEGER NOT NULL REFERENCES topics(id) ON DELETE RESTRICT,
  verifier_id     INTEGER NOT NULL REFERENCES verifiers(id) ON DELETE RESTRICT,
  name            TEXT    NOT NULL,
  slug            TEXT    NOT NULL UNIQUE,
  status          TEXT    NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','built','ready','failed')),
  base_model      TEXT    NOT NULL DEFAULT '',
  inference_model TEXT    NOT NULL DEFAULT '',
  harness         TEXT    NOT NULL DEFAULT 'endpoint',
  local_path      TEXT,
  package_hash    TEXT,
  -- Set only once local validation shows a learnable reward signal.
  scale_ready     INTEGER NOT NULL DEFAULT 0 CHECK (scale_ready IN (0,1)),
  scale_ready_at  TEXT,
  taskset_json    TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(taskset_json)),
  training_toml   TEXT    NOT NULL DEFAULT '',
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL
);
CREATE INDEX idx_environments_benchmark_run ON environments(benchmark_run_id, updated_at DESC);

CREATE TABLE environment_documents (
  environment_id INTEGER NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  document_id    INTEGER NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
  role           TEXT    NOT NULL CHECK (role IN ('train','canary','heldout')),
  PRIMARY KEY (environment_id, document_id)
);

-- The outcome of one local proof pass over a set of environments. Execution
-- state lives on the owning job; this table holds only results.
CREATE TABLE environment_evaluations (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  benchmark_run_id     INTEGER NOT NULL REFERENCES benchmark_runs(id) ON DELETE CASCADE,
  kind                 TEXT    NOT NULL CHECK (kind IN ('rl_test','validation')),
  model                TEXT    NOT NULL,
  endpoint_label       TEXT    NOT NULL DEFAULT '',
  rollouts_per_example INTEGER NOT NULL DEFAULT 1 CHECK (rollouts_per_example BETWEEN 1 AND 20),
  max_concurrent       INTEGER NOT NULL DEFAULT 1 CHECK (max_concurrent BETWEEN 1 AND 32),
  environment_ids_json TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(environment_ids_json)),
  -- Includes the learnability signal: within_task_std, saturated_fraction, ...
  metrics_json         TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(metrics_json)),
  result_paths_json    TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(result_paths_json)),
  created_at           TEXT    NOT NULL,
  updated_at           TEXT    NOT NULL
);
CREATE INDEX idx_env_evals_benchmark_run ON environment_evaluations(benchmark_run_id, created_at DESC);

-- Audit ----------------------------------------------------------------------

CREATE TABLE audit_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type  TEXT    NOT NULL,
  entity_id    INTEGER NOT NULL,
  action       TEXT    NOT NULL,
  details_json TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(details_json)),
  created_at   TEXT    NOT NULL
);
CREATE INDEX idx_audit_entity ON audit_events(entity_type, entity_id, created_at DESC);
