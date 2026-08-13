import type { PropsWithChildren } from '@kitajs/html';

type TableBoxProps = PropsWithChildren<{ class?: string }>;

export function TableBox({ class: className, children }: TableBoxProps) {
  return <section class={`m-tablebox${className ? ` ${className}` : ''}`}>{children}</section>;
}
