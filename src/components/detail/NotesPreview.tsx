import { QuoteRef } from '../../types';

export function NotesPreview({
  quoteRefs,
  onQuoteClick,
}: {
  quoteRefs: QuoteRef[];
  onQuoteClick: (quote: QuoteRef) => void;
}) {
  if (quoteRefs.length === 0) return null;

  return (
    <div className="space-y-3 pt-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Interactive note links</div>

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
    </div>
  );
}
