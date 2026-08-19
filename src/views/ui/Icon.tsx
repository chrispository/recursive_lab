type IconName = 'alert' | 'arrow' | 'back' | 'check' | 'chevron' | 'close' | 'dash' | 'help' | 'settings' | 'spark';

type IconProps = {
  name: IconName;
  label?: string;
  class?: string;
};

/** The only icon primitive: 16px, hairline, currentColor, and no fills. */
export function Icon({ name, label, class: className }: IconProps) {
  return (
    <svg
      class={`m-icon${className ? ` ${className}` : ''}`}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden={label ? undefined : 'true'}
      aria-label={label}
      role={label ? 'img' : undefined}
    >
      {name === 'arrow' ? <><path d="M2 8h11" /><path d="m9.5 4.5 3.5 3.5-3.5 3.5" /></> : null}
      {name === 'alert' ? <><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3.5" /><path d="M8 11h.01" /></> : null}
      {name === 'back' ? <><path d="M14 8H3" /><path d="m6.5 4.5-3.5 3.5 3.5 3.5" /></> : null}
      {name === 'check' ? <path d="m3.5 8.5 3 3 6-7" /> : null}
      {name === 'chevron' ? <path d="m5.5 3.5 4.5 4.5-4.5 4.5" /> : null}
      {name === 'close' ? <><path d="m4 4 8 8" /><path d="m12 4-8 8" /></> : null}
      {name === 'dash' ? <path d="M4 8h8" /> : null}
      {name === 'help' ? <><circle cx="8" cy="8" r="5.5" /><path d="M6.4 6.3a1.7 1.7 0 1 1 2.8 1.3c-.8.6-1.2.9-1.2 1.8" /><path d="M8 11.7h.01" /></> : null}
      {name === 'settings' ? <><path d="M6.8 2.5h2.4l.5 1.7 1.5.9 1.7-.4 1.2 2.1-1.2 1.3v1.8l1.2 1.3-1.2 2.1-1.7-.4-1.5.9-.5 1.7H6.8l-.5-1.7-1.5-.9-1.7.4-1.2-2.1 1.2-1.3V8.1L1.9 6.8l1.2-2.1 1.7.4 1.5-.9.5-1.7Z" /><circle cx="8" cy="8.9" r="2.1" /></> : null}
      {name === 'spark' ? <><path d="M8 2.5v11" /><path d="M2.5 8h11" /><path d="m4.1 4.1 7.8 7.8" /><path d="m11.9 4.1-7.8 7.8" /></> : null}
    </svg>
  );
}
