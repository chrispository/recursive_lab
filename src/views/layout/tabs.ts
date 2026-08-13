/**
 * The five pipeline stages plus settings.
 *
 * Order is the pipeline order and is load bearing: the rail numbers stages
 * 01–05 by position, and `gates` counts how far down this list the current
 * lineage reaches. `settings` is deliberately not a stage — it is reached from
 * the rail head, not the numbered list.
 */

export const STAGES = [
  { tab: 'benchmarks', label: 'Benchmarks', title: 'Run the model through NeMo Gym' },
  { tab: 'results', label: 'Results', title: 'Verified benchmark results' },
  { tab: 'failures', label: 'Failure map', title: 'Turn misses into capability topics' },
  { tab: 'forge', label: 'Data forge', title: 'Forge novel training documents' },
  { tab: 'env-lab', label: 'Env lab', title: 'Prove environments locally' },
] as const;

export type Stage = (typeof STAGES)[number];
export type Tab = Stage['tab'] | 'settings';

export const TABS: readonly Tab[] = [...STAGES.map((s) => s.tab), 'settings'];

export const isTab = (value: string): value is Tab => TABS.includes(value as Tab);

/** Zero-padded stage number as shown in the rail: 1 -> "01". */
export const stageNumber = (index: number) => String(index + 1).padStart(2, '0');

/** Page <title> and the h2 at the top of each tab. */
export const titleOf = (tab: Tab) =>
  tab === 'settings'
    ? 'Provider and platform settings'
    : (STAGES.find((s) => s.tab === tab)?.title ?? '');

export const labelOf = (tab: Tab) =>
  tab === 'settings' ? 'Settings' : (STAGES.find((s) => s.tab === tab)?.label ?? '');
