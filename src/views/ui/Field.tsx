import type { PropsWithChildren } from '@kitajs/html';

type FieldProps = PropsWithChildren<{ label: string; note?: string }>;

export function Field({ label, note, children }: FieldProps) {
  return (
    <div class="m-field">
      <label>{label}</label>
      {children}
      {note ? <div class="m-note">{note}</div> : null}
    </div>
  );
}
