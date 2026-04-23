import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Youtube, Tag, X, Search, Plus, Clock3, Pencil, Save, Ban, Copy, ChevronDown } from 'lucide-react';
import { Annotation, QuoteRef, TimestampRef } from '../types';
import {
  BatchCopyExportMode,
  formatTimestampLabel,
  resolvePublishedAt,
  resolveTranscript,
  resolveVideoDescription,
  resolveVideoId,
  resolveVideoTags,
  resolveVideoTitle,
  resolveViews,
  sortQuoteRefs,
  sortTimestampRefs,
  TRANSCRIPT_COLUMN,
} from '../lib/data';

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface DetailPanelProps {
  row: any | null;
  annotation: Annotation | undefined;
  savedNotes: string;
  selectedCount?: number;
  batchSelectionKey?: string;
  onUpdateAnnotation: (videoId: string, annotation: Partial<Annotation>) => void;
  onUpdateNotes: (videoId: string, notes: string) => void;
  onApplyTagFilter: (tag: string, source: 'imported' | 'user', append?: boolean) => void;
  onBatchAddTag?: (tag: string) => void;
  batchSharedTags?: string[];
  onBatchRemoveTag?: (tag: string) => void;
  onBatchApplyNotes?: (notes: string) => {
    status: 'success' | 'empty' | 'error';
    appliedCount: number;
    message: string;
  } | Promise<{
    status: 'success' | 'empty' | 'error';
    appliedCount: number;
    message: string;
  }>;
  onBatchExclude?: () => void;
  onBatchCopySelection?: (mode: BatchCopyExportMode) => Promise<{
    status: 'success' | 'empty' | 'error';
    copiedCount: number;
    message: string;
  }>;
  isBatchTagging?: boolean;
  onWatchSession?: (session: {
    videoId: string;
    title: string;
    startedAt: string;
    endedAt: string;
    watchedSeconds: number;
    durationSeconds: number | null;
    qualifies: boolean;
  }) => void;
  openAnnotateRequestKey?: number;
}

type DetailMode = 'description' | 'annotate' | 'transcript';
type BatchCopyFeedbackStatus = 'success' | 'empty' | 'error';

const BATCH_COPY_OPTIONS: Array<{ mode: BatchCopyExportMode; label: string }> = [
  { mode: 'videoIds', label: 'Copy video IDs' },
  { mode: 'videoUrls', label: 'Copy video URLs' },
  { mode: 'channelIds', label: 'Copy channel IDs' },
  { mode: 'channelUrls', label: 'Copy channel URLs' },
];

type TranscriptSelection = {
  text: string;
  startIndex: number;
  endIndex: number;
  top: number;
  left: number;
};

let ytApiPromise: Promise<any> | null = null;
const YT_API_TIMEOUT_MS = 12000;

function loadYouTubeApi(): Promise<any> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('YouTube API can only load in the browser.'));
  }

  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId: number | null = null;
    const existingScript = document.querySelector('script[data-yt-api="true"]') as HTMLScriptElement | null;
    const script = existingScript || document.createElement('script');

    const settleSuccess = () => {
      if (settled) return;
      settled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      script.removeEventListener('error', handleScriptError);
      resolve(window.YT);
    };

    const settleFailure = (error: Error) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      script.removeEventListener('error', handleScriptError);
      ytApiPromise = null;
      reject(error);
    };

    const handleScriptError = () => {
      settleFailure(new Error('Failed to load YouTube iframe API script.'));
    };

    if (!existingScript) {
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.dataset.ytApi = 'true';
      document.body.appendChild(script);
    }

    script.addEventListener('error', handleScriptError, { once: true });

    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) {
        settleSuccess();
      }
    };

    const waitForApi = () => {
      if (settled) return;
      if (window.YT?.Player) {
        settleSuccess();
      } else {
        window.setTimeout(waitForApi, 50);
      }
    };

    timeoutId = window.setTimeout(() => {
      settleFailure(new Error(`Timed out loading YouTube player API after ${YT_API_TIMEOUT_MS}ms.`));
    }, YT_API_TIMEOUT_MS);

    waitForApi();
  });

  return ytApiPromise;
}

function renderQueryHighlights(text: string, query: string) {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return text;

  const escapedQuery = normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'ig');
  const parts = text.split(regex);

  return parts.map((part, index) => (
    index % 2 === 1
      ? <mark key={`${part}-${index}`} className="bg-amber-300/70 px-0.5 text-stone-900">{part}</mark>
      : <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>
  ));
}

function appendQuotedText(existing: string, heading: string, text: string) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return existing;
  const entry = `- "${cleaned.replace(/"/g, '\\"')}"`;
  const sectionHeader = `## ${heading}`;
  const trimmed = existing.replace(/\s+$/, '');
  if (!trimmed) return `${sectionHeader}\n${entry}\n`;

  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(^|\\n)## ${escapedHeading}\\n([\\s\\S]*?)(?=\\n## |$)`, 'm');
  const match = pattern.exec(trimmed);
  if (!match) return `${trimmed}\n\n${sectionHeader}\n${entry}\n`;

  const prefix = trimmed.slice(0, match.index + match[1].length);
  const suffix = trimmed.slice(match.index + match[0].length);
  const existingEntries = match[2]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!existingEntries.includes(entry)) existingEntries.push(entry);
  const rebuiltSection = `${sectionHeader}\n${existingEntries.join('\n')}`;
  return `${prefix}${rebuiltSection}${suffix ? suffix : ''}`.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function appendTimestampMarkdown(existing: string, label: string) {
  const normalizedLabel = String(label || '').trim().replace(/^\[(.+)\]$/, '$1').trim();
  if (!normalizedLabel) return existing;
  const entry = `- {${normalizedLabel}]`;
  const trimmed = existing.replace(/\s+$/, '');
  if (!trimmed) return `${entry}\n`;
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines[lines.length - 1] === entry) return `${trimmed}\n`;
  return `${trimmed}\n\n${entry}\n`;
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

function shouldIgnorePlayerShortcut(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || ['input', 'textarea', 'select', 'button'].includes(tagName);
}

function TranscriptViewer({
  transcript,
  query,
  activeRange,
  onAddQuote,
}: {
  transcript: string;
  query: string;
  activeRange: { startIndex: number; endIndex: number } | null;
  onAddQuote: (selection: { text: string; startIndex: number; endIndex: number }) => void;
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
    if (!activeRange || activeRange.endIndex <= activeRange.startIndex) {
      return renderQueryHighlights(transcript, query);
    }

    const before = transcript.slice(0, activeRange.startIndex);
    const selected = transcript.slice(activeRange.startIndex, activeRange.endIndex);
    const after = transcript.slice(activeRange.endIndex);

    return (
      <>
        {renderQueryHighlights(before, query)}
        <mark ref={activeRef} className="bg-[var(--accent)]/25 px-0.5 text-[var(--text-main)] ring-1 ring-[var(--accent)]">
          {selected}
        </mark>
        {renderQueryHighlights(after, query)}
      </>
    );
  }, [activeRange, query, transcript]);

  return (
    <div className="relative">
      <div
        ref={containerRef}
        onMouseUp={handleMouseUp}
        className="custom-scrollbar min-h-[14rem] max-h-[26rem] overflow-auto border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-3 font-mono text-[13px] leading-6 whitespace-pre-wrap text-[var(--text-main)]"
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

function InputRow({
  icon,
  value,
  onChange,
  placeholder,
  onSubmit,
  inputRef,
}: {
  icon: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  onSubmit?: () => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.();
      }}
      onMouseDownCapture={(event) => event.stopPropagation()}
      onPointerDownCapture={(event) => event.stopPropagation()}
      onClickCapture={(event) => event.stopPropagation()}
      className="flex items-center gap-2 border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2"
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
        autoFocus={Boolean(inputRef)}
        className="w-full bg-transparent text-[13px] text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none"
      />
    </form>
  );
}

function NotesPreview({
  quoteRefs,
  timestampRefs,
  onQuoteClick,
  onTimestampClick,
  onRemoveTimestamp,
}: {
  quoteRefs: QuoteRef[];
  timestampRefs: TimestampRef[];
  onQuoteClick: (quote: QuoteRef) => void;
  onTimestampClick: (timestamp: TimestampRef) => void;
  onRemoveTimestamp: (timestampId: string) => void;
}) {
  if (quoteRefs.length === 0 && timestampRefs.length === 0) return null;

  return (
    <div className="space-y-4 border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
      <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Interactive note links</div>

      {quoteRefs.length > 0 && (
        <div className="space-y-2">
          <div className="text-[12px] font-semibold text-[var(--text-main)]">Quotes</div>
          <div className="space-y-1.5">
            {quoteRefs.map((quote) => (
              <button
                key={quote.id}
                type="button"
                onClick={() => onQuoteClick(quote)}
                className="block w-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-left text-[12px] text-[var(--text-main)] hover:border-[var(--accent)]"
              >
                “{quote.text}”
              </button>
            ))}
          </div>
        </div>
      )}

      {timestampRefs.length > 0 && (
        <div className="space-y-2">
          <div className="text-[12px] font-semibold text-[var(--text-main)]">Timestamps</div>
          <div className="flex flex-wrap gap-2">
            {timestampRefs.map((timestamp) => (
              <span
                key={timestamp.id}
                className="inline-flex items-center overflow-hidden border border-[var(--border-color)] bg-[var(--bg-secondary)] text-[12px] text-[var(--text-main)]"
              >
                <button
                  type="button"
                  onClick={() => onTimestampClick(timestamp)}
                  className="px-2.5 py-1 transition-colors hover:bg-[var(--grid-hover)]"
                >
                  {timestamp.label}
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemoveTimestamp(timestamp.id);
                  }}
                  className="border-l border-[var(--border-color)] px-1.5 py-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--grid-hover)] hover:text-[var(--text-main)]"
                  title={`Remove ${timestamp.label}`}
                  aria-label={`Remove ${timestamp.label}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function DetailPanel({
  row,
  annotation,
  savedNotes,
  selectedCount = 0,
  batchSelectionKey = '',
  onUpdateAnnotation,
  onUpdateNotes,
  onApplyTagFilter,
  onBatchAddTag,
  batchSharedTags = [],
  onBatchRemoveTag,
  onBatchApplyNotes,
  onBatchExclude,
  onBatchCopySelection,
  isBatchTagging = false,
  onWatchSession,
  openAnnotateRequestKey = 0,
}: DetailPanelProps) {
  const hasMultiSelection = selectedCount > 1;
  const effectiveRow = hasMultiSelection ? null : row;
  const videoId = effectiveRow ? resolveVideoId(effectiveRow) : null;
  const [tagInput, setTagInput] = useState('');
  const [batchTagInput, setBatchTagInput] = useState('');
  const [batchNotesDraft, setBatchNotesDraft] = useState('');
  const [isBatchCopyMenuOpen, setIsBatchCopyMenuOpen] = useState(false);
  const [batchCopyFeedback, setBatchCopyFeedback] = useState<{ status: BatchCopyFeedbackStatus; message: string } | null>(null);
  const [batchNotesFeedback, setBatchNotesFeedback] = useState<{ status: BatchCopyFeedbackStatus; message: string } | null>(null);
  const [detailMode, setDetailMode] = useState<DetailMode>('description');
  const [transcriptSearch, setTranscriptSearch] = useState('');
  const [isEditingTranscript, setIsEditingTranscript] = useState(false);
  const [transcriptEditValue, setTranscriptEditValue] = useState('');
  const [activeRange, setActiveRange] = useState<{ startIndex: number; endIndex: number } | null>(null);
  const playerShellRef = useRef<HTMLDivElement | null>(null);
  const playerFrameRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);
  const notesTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const descriptionRef = useRef<HTMLDivElement | null>(null);
  const [playerDuration, setPlayerDuration] = useState(0);
  const [playerState, setPlayerState] = useState<number | null>(null);
  const [playerLoadError, setPlayerLoadError] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [isNotesDirty, setIsNotesDirty] = useState(false);
  const focusNotesEditor = useCallback((cursorPosition?: number) => {
    window.requestAnimationFrame(() => {
      const textarea = notesTextareaRef.current;
      if (!textarea) return;
      const nextCursorPosition = Math.max(0, Math.min(cursorPosition ?? textarea.value.length, textarea.value.length));
      textarea.focus();
      textarea.setSelectionRange(nextCursorPosition, nextCursorPosition);
      textarea.scrollTop = textarea.scrollHeight;
    });
  }, []);
  const notesDraftRef = useRef('');
  const isNotesDirtyRef = useRef(false);
  const activeVideoIdRef = useRef<string | null>(null);
  const watchSessionRef = useRef<{
    videoId: string | null;
    title: string;
    startedAtMs: number | null;
    accumulatedSeconds: number;
    segmentStartedAtMs: number | null;
    segmentStartedPlayerSeconds: number | null;
    durationSeconds: number | null;
  }>({
    videoId: null,
    title: '',
    startedAtMs: null,
    accumulatedSeconds: 0,
    segmentStartedAtMs: null,
    segmentStartedPlayerSeconds: null,
    durationSeconds: null,
  });
  const batchTagInputRef = useRef<HTMLInputElement | null>(null);
  const batchCopyMenuRef = useRef<HTMLDivElement | null>(null);
  const batchCopyButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousMultiSelectionKeyRef = useRef(batchSelectionKey);

  useEffect(() => {
    setDetailMode('description');
    setTagInput('');
    setTranscriptSearch('');
    setActiveRange(null);
    setIsEditingTranscript(false);
  }, [hasMultiSelection, videoId]);

  useEffect(() => {
    if (previousMultiSelectionKeyRef.current !== batchSelectionKey) {
      setBatchTagInput('');
      setBatchNotesDraft('');
      setIsBatchCopyMenuOpen(false);
      setBatchCopyFeedback(null);
      setBatchNotesFeedback(null);
      previousMultiSelectionKeyRef.current = batchSelectionKey;
    }
  }, [batchSelectionKey]);

  useEffect(() => {
    if (!hasMultiSelection) {
      setBatchNotesDraft('');
      setIsBatchCopyMenuOpen(false);
      setBatchCopyFeedback(null);
      setBatchNotesFeedback(null);
    }
  }, [hasMultiSelection]);

  useEffect(() => {
    if (!isBatchCopyMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const insideMenu = !!batchCopyMenuRef.current && batchCopyMenuRef.current.contains(target);
      const insideButton = !!batchCopyButtonRef.current && batchCopyButtonRef.current.contains(target);
      if (!insideMenu && !insideButton) {
        setIsBatchCopyMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsBatchCopyMenuOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isBatchCopyMenuOpen]);

  useEffect(() => {
    if (!batchCopyFeedback) return;
    const timeout = window.setTimeout(() => setBatchCopyFeedback(null), 2500);
    return () => window.clearTimeout(timeout);
  }, [batchCopyFeedback]);

  useEffect(() => {
    if (!batchNotesFeedback) return;
    const timeout = window.setTimeout(() => setBatchNotesFeedback(null), 2500);
    return () => window.clearTimeout(timeout);
  }, [batchNotesFeedback]);

  useEffect(() => {
    if (hasMultiSelection || !row || !openAnnotateRequestKey) return;
    setDetailMode('annotate');
    focusNotesEditor();
  }, [focusNotesEditor, hasMultiSelection, openAnnotateRequestKey, row]);

  const transcript = useMemo(() => resolveTranscript(effectiveRow, annotation), [annotation, effectiveRow]);
  const importedTranscript = useMemo(() => {
    const base = effectiveRow?.[TRANSCRIPT_COLUMN] ?? effectiveRow?.text ?? effectiveRow?.Text ?? '';
    return base == null ? '' : String(base);
  }, [effectiveRow]);
  const videoTitle = useMemo(() => resolveVideoTitle(effectiveRow), [effectiveRow]);
  const currentNotes = savedNotes || '';

  const closeActiveWatchSegment = (player?: any) => {
    const session = watchSessionRef.current;
    if (session.segmentStartedAtMs === null) return;
    const nowMs = Date.now();
    const currentPlayerSeconds = Number(player?.getCurrentTime?.() ?? Number.NaN);
    const hasPlayerDelta = Number.isFinite(currentPlayerSeconds) && session.segmentStartedPlayerSeconds !== null;
    const delta = hasPlayerDelta
      ? Math.max(0, currentPlayerSeconds - Number(session.segmentStartedPlayerSeconds))
      : Math.max(0, (nowMs - session.segmentStartedAtMs) / 1000);
    session.accumulatedSeconds += delta;
    session.segmentStartedAtMs = null;
    session.segmentStartedPlayerSeconds = null;
  };

  const flushWatchSession = (player?: any) => {
    const session = watchSessionRef.current;
    closeActiveWatchSegment(player);
    if (!session.videoId || session.startedAtMs === null || session.accumulatedSeconds <= 0) {
      watchSessionRef.current = {
        videoId: null,
        title: '',
        startedAtMs: null,
        accumulatedSeconds: 0,
        segmentStartedAtMs: null,
        segmentStartedPlayerSeconds: null,
        durationSeconds: null,
      };
      return;
    }

    const durationSeconds = session.durationSeconds && session.durationSeconds > 0
      ? session.durationSeconds
      : null;
    const watchedSeconds = Number(session.accumulatedSeconds.toFixed(1));
    const qualifies = watchedSeconds > 30 || (
      durationSeconds !== null
      && durationSeconds <= 30
      && watchedSeconds >= Math.max(durationSeconds * 0.9, durationSeconds - 1)
    );

    onWatchSession?.({
      videoId: session.videoId,
      title: session.title || 'Untitled Video',
      startedAt: new Date(session.startedAtMs).toISOString(),
      endedAt: new Date().toISOString(),
      watchedSeconds,
      durationSeconds,
      qualifies,
    });

    watchSessionRef.current = {
      videoId: null,
      title: '',
      startedAtMs: null,
      accumulatedSeconds: 0,
      segmentStartedAtMs: null,
      segmentStartedPlayerSeconds: null,
      durationSeconds: null,
    };
  };

  const setNotesDraftState = useCallback((nextNotes: string, dirty: boolean) => {
    setNotesDraft(nextNotes);
    notesDraftRef.current = nextNotes;
    isNotesDirtyRef.current = dirty;
    setIsNotesDirty(dirty);
  }, []);

  const flushNotesDraft = (targetVideoId: string | null, nextValue?: string) => {
    if (!targetVideoId) return;
    const value = nextValue ?? notesDraftRef.current;
    onUpdateNotes(targetVideoId, value);
  };

  useEffect(() => {
    const previousVideoId = activeVideoIdRef.current;
    if (previousVideoId && previousVideoId !== videoId && isNotesDirtyRef.current) {
      flushNotesDraft(previousVideoId);
    }

    activeVideoIdRef.current = videoId;
    setNotesDraftState(currentNotes, false);
  }, [videoId, currentNotes, onUpdateNotes, setNotesDraftState]);

  useEffect(() => {
    if (activeVideoIdRef.current === videoId && !isNotesDirtyRef.current && notesDraftRef.current !== currentNotes) {
      setNotesDraftState(currentNotes, false);
    }
  }, [currentNotes, videoId, setNotesDraftState]);

  useEffect(() => {
    if (!videoId || !isNotesDirty) return;
    const timeout = window.setTimeout(() => {
      flushNotesDraft(videoId);
      isNotesDirtyRef.current = false;
      setIsNotesDirty(false);
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [videoId, isNotesDirty, onUpdateNotes]);

  useEffect(() => () => {
    if (activeVideoIdRef.current && isNotesDirtyRef.current) {
      flushNotesDraft(activeVideoIdRef.current);
    }
  }, [onUpdateNotes]);

  useEffect(() => {
    if (!isEditingTranscript) {
      setTranscriptEditValue(transcript);
    }
  }, [isEditingTranscript, transcript]);

  useEffect(() => {
    let cancelled = false;
    flushWatchSession(playerRef.current);
    setPlayerDuration(0);
    setPlayerLoadError(null);

    if (hasMultiSelection || !videoId || !playerShellRef.current) {
      playerRef.current?.destroy?.();
      playerRef.current = null;
      setPlayerState(null);
      return;
    }

    loadYouTubeApi().then((YT) => {
      if (cancelled || !playerShellRef.current) return;

      playerRef.current?.destroy?.();
      playerRef.current = null;
      playerShellRef.current.innerHTML = '';

      const mountNode = document.createElement('div');
      mountNode.style.width = '100%';
      mountNode.style.height = '100%';
      mountNode.className = 'yt-player-host';
      playerShellRef.current.appendChild(mountNode);

      playerRef.current = new YT.Player(mountNode, {
        width: '100%',
        height: '100%',
        videoId,
        playerVars: {
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
        },
        events: {
          onReady: (event: any) => {
            setPlayerLoadError(null);
            const duration = Number(event.target?.getDuration?.() || 0);
            setPlayerDuration(duration);
            setPlayerState(Number(event.target?.getPlayerState?.() ?? null));
            watchSessionRef.current.durationSeconds = Number.isFinite(duration) ? duration : null;
            const iframe = event.target?.getIframe?.();
            if (iframe) {
              iframe.style.width = '100%';
              iframe.style.height = '100%';
              iframe.style.position = 'absolute';
              iframe.style.inset = '0';
              iframe.style.border = '0';
            }
            playerFrameRef.current?.setAttribute('tabindex', '-1');
          },
          onStateChange: (event: any) => {
            const duration = Number(event.target?.getDuration?.() || 0);
            const nextState = Number(event?.data ?? event.target?.getPlayerState?.() ?? null);
            setPlayerDuration(duration);
            setPlayerState(nextState);
            watchSessionRef.current.durationSeconds = Number.isFinite(duration) ? duration : null;

            const ytState = window.YT?.PlayerState;
            const session = watchSessionRef.current;
            if (nextState === ytState?.PLAYING) {
              if (!session.videoId) {
                session.videoId = videoId;
                session.title = videoTitle;
                session.startedAtMs = Date.now();
                session.accumulatedSeconds = 0;
              }
              if (session.segmentStartedAtMs === null) {
                session.segmentStartedAtMs = Date.now();
                const playerSeconds = Number(event.target?.getCurrentTime?.() ?? Number.NaN);
                session.segmentStartedPlayerSeconds = Number.isFinite(playerSeconds) ? playerSeconds : null;
              }
              window.setTimeout(() => playerFrameRef.current?.focus({ preventScroll: true }), 0);
            } else {
              closeActiveWatchSegment(event.target);
              if (nextState === ytState?.PAUSED || nextState === ytState?.ENDED) {
                flushWatchSession(event.target);
              }
            }

            const iframe = event.target?.getIframe?.();
            if (iframe) {
              iframe.style.width = '100%';
              iframe.style.height = '100%';
            }
          },
        },
      });
    }).catch((error) => {
      console.error('Failed to initialize YouTube player', error);
      setPlayerLoadError('Unable to load the YouTube player. Check browser tracking/privacy settings and reload the page.');
    });

    return () => {
      cancelled = true;
      flushWatchSession(playerRef.current);
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
  }, [hasMultiSelection, onWatchSession, videoId, videoTitle]);

  useEffect(() => {
    if (hasMultiSelection || !videoId) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnorePlayerShortcut(event.target)) return;
      if (!playerRef.current) return;

      if (event.code === 'Space') {
        event.preventDefault();
        const ytState = window.YT?.PlayerState;
        if (playerState === ytState?.ENDED) {
          playerRef.current.seekTo?.(0, true);
          playerRef.current.playVideo?.();
        } else if (playerState === ytState?.PLAYING) {
          playerRef.current.pauseVideo?.();
        } else {
          playerRef.current.playVideo?.();
        }
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'k') {
        event.preventDefault();
        const ytState = window.YT?.PlayerState;
        if (playerState === ytState?.ENDED) {
          playerRef.current.seekTo?.(0, true);
          playerRef.current.playVideo?.();
        } else if (playerState === ytState?.PLAYING) {
          playerRef.current.pauseVideo?.();
        } else {
          playerRef.current.playVideo?.();
        }
        return;
      }

      if (key === 'j' || key === 'l') {
        event.preventDefault();
        const currentTime = Number(playerRef.current.getCurrentTime?.() || 0);
        const delta = event.shiftKey ? 30 : 10;
        playerRef.current.seekTo?.(Math.max(0, currentTime + (key === 'l' ? delta : -delta)), true);
        return;
      }

      if (event.key.toLowerCase() === 'f' && playerFrameRef.current) {
        event.preventDefault();
        if (document.fullscreenElement) {
          document.exitFullscreen?.();
        } else {
          playerFrameRef.current.requestFullscreen?.();
        }
        return;
      }

      const code = event.code.toLowerCase();
      const isTimestampShortcut = (key === 't' || code === 'keyt')
        && event.shiftKey
        && !event.altKey
        && !event.ctrlKey
        && !event.metaKey;
      if (isTimestampShortcut) {
        event.preventDefault();
        setDetailMode('annotate');
        handleAddTimestamp();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasMultiSelection, playerState, videoId]);


  if (hasMultiSelection) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--bg-secondary)]">
        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-6 p-6">
            <section
              className="space-y-3 border border-[var(--border-color)] bg-[var(--bg-primary)] p-4"
              onMouseDownCapture={(event) => event.stopPropagation()}
              onPointerDownCapture={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Batch actions</div>
                <div className="mt-1 text-sm font-medium text-[var(--text-main)]">{selectedCount.toLocaleString()} videos selected</div>
                <p className="mt-2 text-xs text-[var(--text-muted)]">Tag selected videos, copy video or channel IDs/URLs, or exclude the current selection (Ctrl/Cmd + Delete).</p>
              </div>
              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] xl:grid-cols-[minmax(0,1fr)_auto_auto]">
                <InputRow
                  icon={<Tag size={14} />}
                  value={batchTagInput}
                  onChange={setBatchTagInput}
                  placeholder="Add tag to selected videos"
                  onSubmit={submitBatchTag}
                  inputRef={batchTagInputRef}
                />
                <button
                  type="button"
                  onClick={submitBatchTag}
                  disabled={!batchTagInput.trim() || isBatchTagging}
                  className="shrink-0 border border-[var(--accent)] bg-[var(--accent)] px-3 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  title="Apply tag to selected videos"
                >
                  {isBatchTagging ? 'Applying…' : 'Apply tag'}
                </button>
                <button
                  type="button"
                  onClick={submitBatchExclude}
                  disabled={selectedCount === 0 || !onBatchExclude}
                  className="shrink-0 border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 text-[12px] font-medium text-[var(--text-main)] transition-colors hover:border-red-500 hover:text-red-600 disabled:opacity-50"
                  title="Exclude selected videos"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Ban size={13} />
                    Exclude
                  </span>
                </button>
                <div className="relative shrink-0">
                  <button
                    ref={batchCopyButtonRef}
                    type="button"
                    onClick={() => {
                      if (selectedCount === 0 || !onBatchCopySelection) return;
                      setIsBatchCopyMenuOpen((current) => !current);
                    }}
                    disabled={selectedCount === 0 || !onBatchCopySelection}
                    className="inline-flex items-center gap-1.5 border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-[12px] font-medium text-[var(--text-main)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
                    title="Copy comma-separated values from current selection"
                    aria-label="Copy selected values"
                    aria-expanded={isBatchCopyMenuOpen}
                  >
                    <Copy size={13} />
                    Copy
                    <ChevronDown size={12} className={isBatchCopyMenuOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
                  </button>
                  {isBatchCopyMenuOpen && (
                    <div
                      ref={batchCopyMenuRef}
                      className="absolute right-0 top-full z-30 mt-1 w-48 border border-[var(--border-color)] bg-[var(--bg-primary)] p-1 shadow-xl"
                    >
                      {BATCH_COPY_OPTIONS.map((option) => (
                        <button
                          key={option.mode}
                          type="button"
                          onClick={() => {
                            void submitBatchCopy(option.mode);
                          }}
                          className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-[11px] text-[var(--text-main)] transition-colors hover:bg-[var(--grid-hover)]"
                        >
                          <Copy size={12} className="shrink-0 text-[var(--text-muted)]" />
                          {option.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-2 border-t border-[var(--border-color)] pt-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Shared tags across selection
                </div>
                {batchSharedTags.length > 0 ? (
                  <div className="flex min-h-[1.75rem] flex-wrap gap-2">
                    {batchSharedTags.map((tag) => (
                      <span
                        key={tag}
                        className="flex items-center gap-1 border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2.5 py-1 text-[11px] text-[var(--text-main)]"
                      >
                        <span>{tag}</span>
                        <button
                          type="button"
                          onClick={() => onBatchRemoveTag?.(tag)}
                          disabled={!onBatchRemoveTag || isBatchTagging}
                          className="text-[var(--text-muted)] transition-colors hover:text-red-500 disabled:opacity-50"
                          title={`Remove ${tag} from all selected rows`}
                          aria-label={`Remove ${tag} from all selected rows`}
                        >
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-[var(--text-muted)]">
                    No shared user tags across the current selection.
                  </p>
                )}
              </div>
              {batchCopyFeedback && (
                <p
                  className={[
                    'text-[11px]',
                    batchCopyFeedback.status === 'success'
                      ? 'text-[var(--accent)]'
                      : batchCopyFeedback.status === 'error'
                        ? 'text-red-500'
                        : 'text-[var(--text-muted)]',
                  ].join(' ')}
                >
                  {batchCopyFeedback.message}
                </p>
              )}
            </section>

            <section className="space-y-3 border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Batch video notes</div>
              <p className="text-xs text-[var(--text-muted)]">Apply the same note block to all selected videos.</p>
              <textarea
                value={batchNotesDraft}
                onChange={(event) => setBatchNotesDraft(event.target.value)}
                placeholder="Apply the same note block to all selected videos..."
                className="custom-scrollbar min-h-[9rem] w-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 font-mono text-[12px] leading-5 text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => { void submitBatchNotes(); }}
                  disabled={!batchNotesDraft.trim() || !onBatchApplyNotes}
                  className="shrink-0 border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  Apply to selected videos
                </button>
              </div>
              {batchNotesFeedback ? (
                <p
                  className={[
                    'text-[11px]',
                    batchNotesFeedback.status === 'success'
                      ? 'text-[var(--accent)]'
                      : batchNotesFeedback.status === 'error'
                        ? 'text-red-500'
                        : 'text-[var(--text-muted)]',
                  ].join(' ')}
                >
                  {batchNotesFeedback.message}
                </p>
              ) : null}
            </section>

            <div className="border border-[var(--border-color)] bg-[var(--bg-primary)] p-4 text-sm text-[var(--text-muted)]">
              Select a single row to return to the video detail view.
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!row) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-[var(--bg-secondary)] p-8 text-center text-[var(--text-muted)]">
        <Youtube size={48} className="mb-4 opacity-20" />
        <p className="text-sm font-medium text-[var(--text-main)]">No video selected</p>
        <p className="mt-1 text-xs">Select a row in the grid to view details</p>
      </div>
    );
  }

  const title = resolveVideoTitle(effectiveRow);
  const publishedAt = resolvePublishedAt(effectiveRow);
  const views = resolveViews(effectiveRow);
  const description = resolveVideoDescription(effectiveRow);
  const videoTags = resolveVideoTags(effectiveRow);
  const hasTranscript = transcript.trim().length > 0;
  const currentTags = annotation?.tags || [];
  const quoteRefs = sortQuoteRefs(annotation?.quoteRefs || []);
  const timestampRefs = sortTimestampRefs(annotation?.timestampRefs || []);

  const submitTag = () => {
    const trimmed = tagInput.trim();
    if (!trimmed || !videoId) return;

    if (!currentTags.includes(trimmed)) {
      onUpdateAnnotation(videoId, { tags: [...currentTags, trimmed] });
    }

    setTagInput('');
    setDetailMode('annotate');
  };

  function submitBatchTag() {
    const trimmed = batchTagInput.trim();
    if (!trimmed || selectedCount === 0 || !onBatchAddTag) return;
    onBatchAddTag(trimmed);
    setBatchTagInput('');
    window.requestAnimationFrame(() => batchTagInputRef.current?.focus());
  }

  function submitBatchExclude() {
    if (selectedCount === 0 || !onBatchExclude) return;
    onBatchExclude();
  }

  async function submitBatchCopy(mode: BatchCopyExportMode) {
    if (selectedCount === 0 || !onBatchCopySelection) return;
    const result = await onBatchCopySelection(mode);
    setBatchCopyFeedback({ status: result.status, message: result.message });
    setIsBatchCopyMenuOpen(false);
  }

  async function submitBatchNotes() {
    if (selectedCount === 0 || !onBatchApplyNotes) return;
    const result = await onBatchApplyNotes(batchNotesDraft);
    setBatchNotesFeedback({ status: result.status, message: result.message });
    if (result.status === 'success') setBatchNotesDraft('');
  }

  const removeTag = (tagToRemove: string) => {
    if (!videoId) return;
    onUpdateAnnotation(videoId, { tags: currentTags.filter((tag) => tag !== tagToRemove) });
  };

  const updateNotes = (notes: string) => {
    setNotesDraftState(notes, true);
  };

  const handleQuoteDescriptionSelection = () => {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim() || '';
    const container = descriptionRef.current;
    if (!selectedText || !container || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return;
    const nextNotes = appendQuotedText(notesDraftRef.current, 'Description Quotes', selectedText);
    updateNotes(nextNotes);
    setDetailMode('annotate');
    focusNotesEditor();
    selection.removeAllRanges();
  };

  const persistManagedNotes = (nextQuoteRefs: QuoteRef[], nextTimestampRefs: TimestampRef[]) => {
    if (!videoId) return;
    onUpdateAnnotation(videoId, {
      quoteRefs: nextQuoteRefs,
      timestampRefs: nextTimestampRefs,
    });
  };

  const addQuoteFromSelection = (selection: { text: string; startIndex: number; endIndex: number }) => {
    if (!videoId) return;
    const nextQuote: QuoteRef = {
      id: Math.random().toString(36).slice(2),
      text: selection.text,
      startIndex: selection.startIndex,
      endIndex: selection.endIndex,
      createdAt: Date.now(),
    };
    const nextQuoteRefs = sortQuoteRefs([...(annotation?.quoteRefs || []), nextQuote]);
    const nextNotes = appendQuotedText(notesDraftRef.current, 'Transcript Quotes', selection.text);
    updateNotes(nextNotes);
    persistManagedNotes(nextQuoteRefs, timestampRefs);
    setActiveRange({ startIndex: nextQuote.startIndex, endIndex: nextQuote.endIndex });
    setDetailMode('annotate');
    focusNotesEditor();
  };

  const handleQuoteClick = (quote: QuoteRef) => {
    setDetailMode('transcript');
    setActiveRange({ startIndex: quote.startIndex, endIndex: quote.endIndex });
  };

  const handleSaveTranscript = () => {
    if (!videoId) return;
    onUpdateAnnotation(videoId, {
      transcriptOverride: transcriptEditValue.trim() === importedTranscript.trim() ? undefined : transcriptEditValue,
    });
    setIsEditingTranscript(false);
  };

  const handleCancelTranscriptEdit = () => {
    setTranscriptEditValue(transcript);
    setIsEditingTranscript(false);
  };

  const handleAddTimestamp = () => {
    if (!videoId || !playerRef.current?.getCurrentTime) return;
    const seconds = Number(playerRef.current.getCurrentTime() || 0);
    const nextTimestamp: TimestampRef = {
      id: Math.random().toString(36).slice(2),
      seconds,
      label: formatTimestampLabel(seconds, playerDuration),
      createdAt: Date.now(),
    };
    const nextTimestampRefs = sortTimestampRefs([...(annotation?.timestampRefs || []), nextTimestamp]);
    const nextNotes = appendTimestampMarkdown(notesDraftRef.current, nextTimestamp.label);
    updateNotes(nextNotes);
    flushNotesDraft(videoId, nextNotes);
    persistManagedNotes(quoteRefs, nextTimestampRefs);
    setDetailMode('annotate');
    focusNotesEditor(nextNotes.length);
  };

  const handleTimestampClick = (timestamp: TimestampRef) => {
    playerRef.current?.seekTo?.(timestamp.seconds, true);
  };

  const handleRemoveTimestamp = (timestampId: string) => {
    const nextTimestampRefs = timestampRefs.filter((timestamp) => timestamp.id !== timestampId);
    persistManagedNotes(quoteRefs, nextTimestampRefs);
  };

  const tabs: Array<{ key: DetailMode; label: string; disabled?: boolean }> = [
    { key: 'description', label: 'Description' },
    { key: 'transcript', label: 'Transcript', disabled: !hasTranscript },
    { key: 'annotate', label: 'Annotate' },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--bg-secondary)]">
      <div className="shrink-0 border-b border-[var(--border-color)] bg-black">
        <div ref={playerFrameRef} className="relative aspect-video w-full overflow-hidden bg-black" tabIndex={-1}>
          {videoId ? (
            <>
              <div ref={playerShellRef} className="yt-player-shell absolute inset-0" />
              {playerLoadError ? (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80 p-4 text-center text-xs text-white/80">
                  {playerLoadError}
                </div>
              ) : null}
            </>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-white/70">
              No valid Video ID found in this row
            </div>
          )}
        </div>
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-6 p-6">
          <section>
            <div className="mb-2 flex items-start gap-2">
              <span className="mt-1 h-2 w-2 shrink-0 bg-[var(--accent)]" />
              <h2 className="min-w-0 flex-1 text-[16px] font-bold leading-tight text-[var(--text-main)]">{title}</h2>
              <button
                type="button"
                onClick={handleAddTimestamp}
                className="inline-flex shrink-0 items-center gap-1 px-0 py-0 text-[11px] font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)]"
                title="Add current playhead timestamp to notes"
              >
                <Clock3 size={12} /> Timestamp
              </button>
            </div>
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border-color)] pb-4 text-[12px] text-[var(--text-muted)]">
              <div className="flex flex-wrap gap-4">
                <span>{views !== undefined ? Number(views).toLocaleString() : '0'} views</span>
                <span>{publishedAt ? new Date(publishedAt).toLocaleDateString() : 'N/A'}</span>
              </div>
              <div className="inline-flex overflow-hidden border border-[var(--border-color)] bg-[var(--bg-primary)]">
                {tabs.map((tab) => {
                  const isActive = detailMode === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => !tab.disabled && setDetailMode(tab.key)}
                      disabled={tab.disabled}
                      className={`min-w-[5.75rem] border-l border-[var(--border-color)] px-3 py-1.5 text-[11px] font-semibold transition-colors first:border-l-0 ${
                        isActive
                          ? 'bg-[var(--accent)] text-white'
                          : 'text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-[var(--text-muted)]'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="space-y-4">
            {detailMode === 'description' && (
              <>
                {videoTags.length > 0 && (
                  <div className="flex min-h-[2.25rem] flex-wrap gap-2 border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
                    {videoTags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={(event) => onApplyTagFilter(tag, 'imported', event.ctrlKey || event.metaKey)}
                        className="border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2.5 py-1 text-[11px] text-[var(--text-main)] hover:border-[var(--accent)]"
                        title="Filter by this imported tag"
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                )}

                <div className="space-y-2 border-t border-[var(--border-color)] pt-4">
                  <div className="flex items-center justify-between gap-3 text-[14px] font-mono text-[var(--text-main)]">
                    <div className="flex items-center gap-2">
                      <span className="text-[var(--text-muted)]">#</span> Video Description
                    </div>
                    {description ? (
                      <button
                        type="button"
                        onClick={handleQuoteDescriptionSelection}
                        className="inline-flex items-center gap-1 border border-[var(--border-color)] bg-[var(--bg-primary)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-main)] hover:border-[var(--accent)]"
                        title="Quote selected description text into notes"
                      >
                        <Plus size={12} /> Quote selection
                      </button>
                    ) : null}
                  </div>
                  <div ref={descriptionRef} className="min-h-[14rem] whitespace-pre-wrap border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-3 text-[13px] leading-6 text-[var(--text-main)]">
                    {description || <span className="text-[var(--text-muted)]">No video description was imported for this video.</span>}
                  </div>
                </div>
              </>
            )}

            {detailMode === 'transcript' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <InputRow
                    icon={<Search size={14} />}
                    value={transcriptSearch}
                    onChange={setTranscriptSearch}
                    placeholder="Search transcript"
                  />
                  {!isEditingTranscript ? (
                    <button
                      type="button"
                      onClick={() => setIsEditingTranscript(true)}
                      className="inline-flex shrink-0 items-center gap-1 border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-[12px] font-semibold text-[var(--text-main)] hover:border-[var(--accent)]"
                    >
                      <Pencil size={13} /> Edit Transcript
                    </button>
                  ) : (
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={handleCancelTranscriptEdit}
                        className="inline-flex items-center gap-1 border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-[12px] font-semibold text-[var(--text-main)] hover:border-[var(--accent)]"
                      >
                        <Ban size={13} /> Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveTranscript}
                        className="inline-flex items-center gap-1 border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-[12px] font-semibold text-white hover:opacity-90"
                      >
                        <Save size={13} /> Save
                      </button>
                    </div>
                  )}
                </div>

                {isEditingTranscript ? (
                  <textarea
                    value={transcriptEditValue}
                    onChange={(event) => setTranscriptEditValue(event.target.value)}
                    className="custom-scrollbar min-h-[18rem] w-full border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-3 font-mono text-[13px] leading-6 text-[var(--text-main)] focus:outline-none"
                  />
                ) : (
                  <TranscriptViewer
                    transcript={transcript}
                    query={transcriptSearch}
                    activeRange={activeRange}
                    onAddQuote={addQuoteFromSelection}
                  />
                )}
              </div>
            )}

            {detailMode === 'annotate' && (
              <>
                <InputRow
                  icon={<Tag size={14} />}
                  value={tagInput}
                  onChange={setTagInput}
                  onSubmit={submitTag}
                  placeholder="Type user tag and press Enter..."
                />

                {currentTags.length > 0 && (
                  <div className="flex min-h-[1.75rem] flex-wrap gap-2">
                    {currentTags.map((tag) => (
                      <span key={tag} className="flex items-center gap-1 border border-[var(--border-color)] bg-[var(--bg-primary)] px-2.5 py-1 text-[11px] text-[var(--text-main)]">
                        <button
                          type="button"
                          onClick={(event) => onApplyTagFilter(tag, 'user', event.ctrlKey || event.metaKey)}
                          className="text-left transition-colors hover:text-[var(--accent)]"
                          title="Filter by this user tag"
                        >
                          {tag}
                        </button>
                        <button type="button" onClick={() => removeTag(tag)} className="text-[var(--text-muted)] transition-colors hover:text-[var(--text-main)]" title={`Remove ${tag}`}>
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="space-y-3 border-t border-[var(--border-color)] pt-4">
                  <div className="flex items-center gap-2 text-[14px] font-mono text-[var(--text-main)]">
                    <span className="text-[var(--text-muted)]">#</span> Notes Markdown
                  </div>
                  <textarea
                    ref={notesTextareaRef}
                    value={notesDraft}
                    onChange={(event) => updateNotes(event.target.value)}
                    onBlur={() => {
                      if (videoId && isNotesDirtyRef.current) {
                        flushNotesDraft(videoId);
                        isNotesDirtyRef.current = false;
                        setIsNotesDirty(false);
                      }
                    }}
                    placeholder="# Notes\n\nAdd observations, ideas, and references here..."
                    className="custom-scrollbar min-h-[14rem] w-full border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-3 font-mono text-[13px] leading-6 text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none"
                  />
                  <NotesPreview
                    quoteRefs={quoteRefs}
                    timestampRefs={timestampRefs}
                    onQuoteClick={handleQuoteClick}
                    onTimestampClick={handleTimestampClick}
                    onRemoveTimestamp={handleRemoveTimestamp}
                  />
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
