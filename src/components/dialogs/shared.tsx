import { useState, useEffect, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ColumnSchema, SpecialMappings } from '../../types';
import { getColumnDisplayName } from '../../lib/data';

export function uniqueOrdered(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

export const SPECIAL_FIELD_CONFIG: Array<{ key: SpecialFieldKey; label: string; help: string; }> = [
  { key: 'transcriptColumn', label: 'Transcript', help: 'Used in the right panel so the app can display and search transcript text.' },
  { key: 'descriptionColumn', label: 'Video description', help: 'Used in the Description tab so the app can show imported video descriptions.' },
  { key: 'tagColumn', label: 'Imported tags', help: 'Used for tags shown above the video description and for tag-based filtering. This does not affect user-created tags.' },
];

export function SmartSection({
  title,
  subtitle,
  children,
  defaultOpen = true,
  count,
}: { title: string; subtitle?: string; children: ReactNode; defaultOpen?: boolean; count?: string | number; }) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen, title]);
  return (
    <section className="border border-[var(--border-color)] bg-[var(--bg-primary)]">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-[var(--grid-hover)]">
        <div>
          <div className="text-sm font-semibold text-[var(--text-main)]">{title}</div>
          {subtitle && <div className="mt-1 text-[11px] text-[var(--text-muted)]">{subtitle}</div>}
        </div>
        <div className="flex items-center gap-2 text-[var(--text-muted)]">
          {count !== undefined && <span className="text-[11px] font-medium">{count}</span>}
          <ChevronRight size={14} className={cn('transition-transform', open && 'rotate-90')} />
        </div>
      </button>
      {open && <div className="border-t border-[var(--border-color)] p-4">{children}</div>}
    </section>
  );
}

export type SpecialFieldKey = keyof Pick<SpecialMappings, 'transcriptColumn' | 'descriptionColumn' | 'tagColumn'>;

export function formatColumnOptionLabel(columnName: string, schema?: ColumnSchema[]) {
  const display = getColumnDisplayName(columnName, schema);
  return display === columnName ? columnName : `${display} (${columnName})`;
}
