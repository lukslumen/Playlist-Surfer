import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { TimestampText } from './TimestampText';

type TranscriptSelection = {
  text: string;
  startIndex: number;
  endIndex: number;
  top: number;
  left: number;
};

type SeekOptions = { onSeek?: (seconds: number) => void; maxSeconds?: number | null };

function renderQueryHighlights(text: string, query: string, seek: SeekOptions = {}) {
  const plain = (part: string) => <TimestampText text={part} onSeek={seek.onSeek} maxSeconds={seek.maxSeconds} />;
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return plain(text);

  const escapedQuery = normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'ig');
  const parts = text.split(regex);

  return parts.map((part, index) => (
    index % 2 === 1
      ? <mark key={`${part}-${index}`} className="bg-amber-300/70 px-0.5 text-stone-900">{part}</mark>
      : <React.Fragment key={`${part}-${index}`}>{plain(part)}</React.Fragment>
  ));
}

function getTextOffset(root: HTMLElement, node: Node, offset: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let currentOffset = 0;

  while (walker.nextNode()) {
    const textNode = walker.currentNode;
    const length = textNode.textContent?.length || 0;

    if (textNode === node) {
      return currentOffset + offset;
    }

    currentOffset += length;
  }

  return currentOffset;
}

export function TranscriptViewer({
  transcript,
  query,
  activeRange,
  onAddQuote,
  onSeek,
  maxSeconds,
}: {
  transcript: string;
  query: string;
  activeRange: { startIndex: number; endIndex: number } | null;
  onAddQuote: (selection: { text: string; startIndex: number; endIndex: number }) => void;
  /** Timestamps in the transcript ("12:34") jump the player there. */
  onSeek?: (seconds: number) => void;
  maxSeconds?: number | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLSpanElement | null>(null);
  const [selection, setSelection] = useState<TranscriptSelection | null>(null);

  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [activeRange]);

  useEffect(() => {
    setSelection(null);
  }, [transcript, query, activeRange]);

  const handleMouseUp = () => {
    const container = containerRef.current;
    const currentSelection = window.getSelection();
    if (!container || !currentSelection || currentSelection.rangeCount === 0) {
      setSelection(null);
      return;
    }

    const selectedText = currentSelection.toString();
    if (!selectedText.trim()) {
      setSelection(null);
      return;
    }

    const range = currentSelection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      setSelection(null);
      return;
    }

    const rect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const startIndex = getTextOffset(container, range.startContainer, range.startOffset);
    const endIndex = getTextOffset(container, range.endContainer, range.endOffset);

    setSelection({
      text: selectedText.trim(),
      startIndex,
      endIndex,
      top: rect.top - containerRect.top + container.scrollTop - 34,
      left: Math.max(0, rect.left - containerRect.left + container.scrollLeft),
    });
  };

  const content = useMemo(() => {
    const seek = { onSeek, maxSeconds };
    if (!activeRange || activeRange.endIndex <= activeRange.startIndex) {
      return transcript ? renderQueryHighlights(transcript, query, seek) : null;
    }

    const before = transcript.slice(0, activeRange.startIndex);
    const selected = transcript.slice(activeRange.startIndex, activeRange.endIndex);
    const after = transcript.slice(activeRange.endIndex);

    return (
      <>
        {renderQueryHighlights(before, query, seek)}
        <mark ref={activeRef} className="bg-[var(--accent)]/25 px-0.5 text-[var(--text-main)] ring-1 ring-[var(--accent)]">
          {selected}
        </mark>
        {renderQueryHighlights(after, query, seek)}
      </>
    );
  }, [activeRange, maxSeconds, onSeek, query, transcript]);

  return (
    <div className="relative">
      <div
        ref={containerRef}
        onMouseUp={handleMouseUp}
        className="min-h-[14rem] whitespace-pre-wrap rounded-[6px] border border-[var(--border-color)]/70 bg-[var(--bg-primary)] px-3 py-2 font-mono text-[13px] leading-5 text-[var(--text-muted)]"
      >
        {content || <span className="text-[var(--text-muted)]">No transcript was imported for this video.</span>}
      </div>

      {selection && (
        <button
          type="button"
          onClick={() => {
            onAddQuote(selection);
            setSelection(null);
            window.getSelection()?.removeAllRanges();
          }}
          className="absolute z-20 inline-flex h-7 w-7 items-center justify-center border border-[var(--accent)] bg-[var(--accent)] text-white shadow-lg"
          style={{ top: `${Math.max(0, selection.top)}px`, left: `${selection.left}px` }}
          title="Add selected quote to notes"
        >
          <Plus size={14} />
        </button>
      )}
    </div>
  );
}
