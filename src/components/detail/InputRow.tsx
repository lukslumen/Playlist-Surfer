import React from 'react';

export function InputRow({
  icon,
  value,
  onChange,
  placeholder,
  onSubmit,
  inputRef,
  variant = 'boxed',
}: {
  icon: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  onSubmit?: () => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  variant?: 'boxed' | 'flat' | 'panel';
}) {
  const formClassName = variant === 'flat'
    ? 'flex items-center gap-2 px-0 py-2'
    : variant === 'panel'
      ? 'flex min-w-0 flex-1 items-center gap-2 rounded-[6px] border border-[var(--border-color)]/70 bg-[var(--bg-primary)] px-3 py-2'
      : 'flex items-center gap-2 border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2';

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.();
      }}
      onMouseDownCapture={(event) => event.stopPropagation()}
      onPointerDownCapture={(event) => event.stopPropagation()}
      onClickCapture={(event) => event.stopPropagation()}
      className={formClassName}
    >
      <span className="text-[var(--text-muted)]">{icon}</span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onMouseDownCapture={(event) => event.stopPropagation()}
        onPointerDownCapture={(event) => event.stopPropagation()}
        onClickCapture={(event) => event.stopPropagation()}
        placeholder={placeholder}
        className="w-full bg-transparent text-[13px] leading-5 text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none"
      />
    </form>
  );
}
