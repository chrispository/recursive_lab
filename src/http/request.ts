/**
 * Request/response normalizations shared by every HTTP surface.
 *
 * Handlers receive untyped bodies from forms and JSON alike; these helpers give
 * them a plain shape to read from without repeating the same defensive checks
 * in each route.
 */

/** A human-readable message from an unknown thrown value. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error.';
}

/** An unknown body coerced to a record, or `{}` when it is not one. */
export function recordBody(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** The run id shared by API and form bodies, from either of its two names. */
export function benchmarkRunIdOf(body: unknown): number {
  const source = recordBody(body);
  const raw = source.benchmark_run_id ?? source.run_id;
  return typeof raw === 'number' ? raw : Number(raw);
}

/** Parse a data-forge start request from an API or form body. */
export function dataForgeInput(body: unknown): {
  benchmarkRunId: number;
  promptRevisionId?: number;
  backend?: 'data_designer' | 'frontier';
  providerModel?: string;
  docsPerTopic?: number;
  noveltyThreshold?: number;
  autoApprove?: boolean;
} {
  const source = recordBody(body);
  const rawPrompt = source.prompt_revision_id;
  const rawDocs = source.docs_per_topic;
  const rawThreshold = source.novelty_threshold;
  return {
    benchmarkRunId: benchmarkRunIdOf(body),
    promptRevisionId: typeof rawPrompt === 'number' ? rawPrompt : Number(rawPrompt),
    backend: source.backend === 'frontier' ? 'frontier' : source.backend === 'data_designer' ? 'data_designer' : undefined,
    providerModel: typeof source.provider_model === 'string' ? source.provider_model.trim() : undefined,
    docsPerTopic: typeof rawDocs === 'number' ? rawDocs : Number(rawDocs),
    noveltyThreshold: typeof rawThreshold === 'number' ? rawThreshold : Number(rawThreshold),
    autoApprove: source.auto_approve === true || source.auto_approve === 'on' || source.auto_approve === 'true',
  };
}
