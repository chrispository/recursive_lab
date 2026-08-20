import type { PropsWithChildren } from '@kitajs/html';

type BtnProps = PropsWithChildren<{
  primary?: boolean;
  class?: string;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
}>;

export function Btn({ primary, class: className, disabled, type = 'button', children }: BtnProps) {
  return (
    <button
      class={`${primary ? 'primary ' : ''}${className ?? ''}`.trim() || undefined}
      disabled={disabled}
      type={type}
    >
      {children}
    </button>
  );
}
