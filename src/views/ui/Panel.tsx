import type { PropsWithChildren } from '@kitajs/html';

type PanelProps = PropsWithChildren<{ title: string; code?: string; class?: string }>;

export function Panel({ title, code, class: className, children }: PanelProps) {
  return (
    <section class={`m-panel${className ? ` ${className}` : ''}`}>
      <div class="m-panel-head">
        <h3>{title}</h3>
        {code ? <span class="m-code">{code}</span> : null}
      </div>
      <div class="m-body">{children}</div>
    </section>
  );
}
