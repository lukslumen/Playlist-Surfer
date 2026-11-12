import { QuoteRef } from '../../types';

export function NotesPreview({
  quoteRefs,
  onQuoteClick,
  timestamps = [],
  onTimestampClick,
}: {
  quoteRefs: QuoteRef[];
  onQuoteClick: (quote: QuoteRef) => void;
  /** Timestamp annotations in the notes; clicking one jumps the player there. */
  timestamps?: Array<{ id: string; time_seconds: number; time_label: string; preview: string }>;
  onTimestampClick?: (seconds: number) => void;
}) {
  if (quoteRefs.length === 0 && timestamps.length === 0) return null;

  return (
    <div className="space-y-3 pt-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Interactive note links</div>

      {timestamps.length > 0 ? (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">Timestamps</div>
          <div className="space-y-1.5">
            {[...timestamps].sort((a, b) => a.time_seconds - b.time_seconds).map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => onTimestampClick?.(entry.time_seconds)}
                disabled={!onTimestampClick}
                className="flex w-full items-baseline gap-2 border-b border-[var(--border-color)]/60 px-0 py-1.5 text-left text-[13px] leading-5 text-[var(--text-main)] hover:text-[var(--accent)]"
                title={`Play from ${entry.time_label}`}
              >
                <span className="timestamp-link shrink-0">{entry.time_label}</span>
                <span className="min-w-0 truncate text-[var(--text-muted)]">{entry.preview || 'No note yet'}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {quoteRefs.length > 0 ? (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">Quotes</div>
          <div className="space-y-1.5">
            {quoteRefs.map((quote) => (
              <button
                key={quote.id}
                type="button"
                onClick={() => onQuoteClick(quote)}
                className="block w-full border-b border-[var(--border-color)]/60 px-0 py-1.5 text-left text-[13px] leading-5 text-[var(--text-main)] hover:text-[var(--accent)]"
              >
                {`"${quote.text}"`}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
