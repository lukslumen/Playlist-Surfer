import { cn } from '../lib/utils';
import { LongTaskProgress } from '../types';

export function LongTaskOverlay({ progress }: { progress: LongTaskProgress | null; }) {
  if (!progress) return null;
  const total = Math.max(progress.total, 1);
  const completed = Math.min(Math.max(progress.completed, 0), total);
  const ratio = completed / total;
  const percent = Math.max(0, Math.min(100, Math.round(ratio * 100)));

  return (
    <div className="pointer-events-none fixed inset-0 z-[140] flex items-center justify-center bg-black/18 px-4">
      <div className="pointer-events-auto w-full max-w-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-5 shadow-2xl">
        <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-[var(--text-muted)]">Working</div>
        <div className="mt-2 text-lg font-semibold text-[var(--text-main)]">{progress.title}</div>
        {progress.detail ? <div className="mt-1 text-sm text-[var(--text-muted)]">{progress.detail}</div> : null}
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--bg-primary)]">
          <div
            className={cn('h-full rounded-full bg-[var(--accent)] transition-all duration-200', progress.indeterminate && 'animate-pulse')}
            style={{ width: `${Math.max(ratio * 100, completed > 0 ? 6 : 2)}%` }} />
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
          <span>{completed.toLocaleString()} / {total.toLocaleString()} steps</span>
          <span>{percent}%</span>
        </div>
      </div>
    </div>
  );
}
