export type TallyItem = { value: string | number; label: string; hot?: boolean };

export function Tally({ items }: { items: TallyItem[] }) {
  return (
    <div class="m-tally">
      {items.map((item) => (
        <span class={item.hot ? 'hot' : undefined}>
          <b>{item.value}</b>
          <i>{item.label}</i>
        </span>
      ))}
    </div>
  );
}
