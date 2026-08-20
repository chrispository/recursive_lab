import type { PropsWithChildren } from '@kitajs/html';

export function Table({ children }: PropsWithChildren) {
  return (
    <div class="m-tablewrap">
      <table class="m-table">{children}</table>
    </div>
  );
}
