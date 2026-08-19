-- Prompt seeds recovered from the previous Recursive dashboard database.
-- Keep these in the repository so a clean local database has the same
-- provenance inputs as the current lab database.

INSERT INTO prompt_templates
  (prompt_key, name, purpose, description, created_at, updated_at)
VALUES
  ('failure-analysis', 'Failure analysis', 'analysis', '', '2026-08-11T07:16:45+00:00', '2026-08-11T07:16:45+00:00'),
  ('document-generation', 'Document generation', 'generation', '', '2026-08-11T07:16:45+00:00', '2026-08-11T07:16:45+00:00');

INSERT INTO prompt_revisions
  (template_id, revision_number, body, model_hint, is_active, created_at)
SELECT id, 1,
  'You are a benchmark capability analyst. Group criterion-level failures into durable, trainable capability topics.

Rules:
- Describe the general capability gap, never the benchmark answer.
- Remove matter-specific names, dates, amounts, quotations, and document titles.
- Split failures when they need meaningfully different training examples or verifiers.
- Each failure_id must appear exactly once.
- verifier_strategy must describe an observable success condition, not an answer key.

Return one JSON object with this shape:
{"topics":[{"name":"...","description":"...","verifier_strategy":"...","failure_ids":["..."]}]}
',
  '', 1, '2026-08-11T07:16:45+00:00'
FROM prompt_templates
WHERE prompt_key = 'failure-analysis';

INSERT INTO prompt_revisions
  (template_id, revision_number, body, model_hint, is_active, created_at)
SELECT id, 1,
  'You create genuinely novel synthetic legal-agent training tasks from abstract capability specifications.

Anti-benchmax rules:
- You will not receive the original benchmark documents. Do not ask for them.
- Invent a new matter, parties, chronology, facts, figures, jurisdictions, and document structure.
- Do not paraphrase or lightly perturb a benchmark task.
- Teach the underlying capability through a fresh scenario with independently derived facts.
- The source document must contain enough evidence to solve the task, including realistic distractors.
- The reference answer and verifier targets are hidden from the policy model.

Return one JSON object with this shape:
{"documents":[{"title":"...","document_type":"memo|email|contract|spreadsheet_text|record","content":"...","task_instruction":"...","reference_answer":"...","verifier_targets":["observable target", "observable target"]}]}
',
  '', 1, '2026-08-11T07:16:45+00:00'
FROM prompt_templates
WHERE prompt_key = 'document-generation';
