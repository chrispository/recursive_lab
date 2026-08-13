import type { PropsWithChildren } from '@kitajs/html';

type CapProps = PropsWithChildren<{ title: string; code?: string }>;

export function Cap({ title, code, children }: CapProps) {
  return (
    <div class="m-cap">
      <h3>{title}</h3>
      {children}
      {code ? <span class="m-code">{code}</span> : null}
    </div>
  );
}
