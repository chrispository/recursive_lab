import type { PropsWithChildren } from '@kitajs/html';

/** `id` is for in-page anchors only — a fragment target is the region's own root. */
type PanelProps = PropsWithChildren<{ title: string; code?: string; class?: string; id?: string }>;

export function Panel({ title, code, class: className, id, children }: PanelProps) {
  return (
    <section id={id} class={`m-panel${className ? ` ${className}` : ''}`}>
      <div class="m-panel-head">
        <h3>{title}</h3>
        {code ? <span class="m-code">{code}</span> : null}
      </div>
      <div class="m-body">{children}</div>
    </section>
  );
}
