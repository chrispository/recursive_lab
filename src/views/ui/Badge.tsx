import type { PropsWithChildren } from '@kitajs/html';

type BadgeProps = PropsWithChildren<{ state: string }>;

export function Badge({ state, children }: BadgeProps) {
  return (
    <span class="m-badge" data-state={state}>
      {children ?? state}
    </span>
  );
}
