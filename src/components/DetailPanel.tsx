import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Youtube, Tag, X, Search, Plus, Pencil, Save, Ban, Clock3, Trash2 } from 'lucide-react';
import { Annotation, InclusionView, QuoteRef, TimestampRef } from '../types';
import { BatchCopyExportMode, resolvePublishedAt, resolveTranscript, resolveVideoDescription, resolveVideoId, resolveVideoTags, resolveVideoTitle, resolveViews, sortQuoteRefs, TRANSCRIPT_COLUMN } from '../lib/data';
import { buildMarkerPreview, insertAtPlayhead, parseTimestampDocument, removeById } from '../lib/timestampNotes';
import { appendQuotedText, timestampRefsEqual } from '../lib/detailNotes';
import { shouldIgnorePlayerShortcut } from '../lib/youtubeApi';
import { useYouTubePlayer } from './detail/useYouTubePlayer';
import { InputRow } from './detail/InputRow';
import { TimestampMarkerRail } from './detail/TimestampMarkerRail';
import { TranscriptViewer } from './detail/TranscriptViewer';
import { NotesPreview } from './detail/NotesPreview';
import { BatchSelectionPanel } from './detail/BatchSelectionPanel';

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
  /** In the Excluded view the batch action restores instead of excluding. */
  inclusionView?: InclusionView;
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
  inclusionView = 'included',
  onBatchCopySelection,
  isBatchTagging = false,
  onWatchSession,
  openAnnotateRequestKey = 0,
}: DetailPanelProps) {
  type TimestampUndoState = {
    notes: string;
    timestampRefs: TimestampRef[];
    deletedLabel: string;
  };

  const hasMultiSelection = selectedCount > 1;
  const isExcludedView = inclusionView === 'excluded';
  const effectiveRow = hasMultiSelection ? null : row;
  const videoId = effectiveRow ? resolveVideoId(effectiveRow) : null;
  const [tagInput, setTagInput] = useState('');
  const [detailMode, setDetailMode] = useState<DetailMode>('description');
  const [transcriptSearch, setTranscriptSearch] = useState('');
  const [isEditingTranscript, setIsEditingTranscript] = useState(false);
  const [transcriptEditValue, setTranscriptEditValue] = useState('');
  const [activeRange, setActiveRange] = useState<{ startIndex: number; endIndex: number } | null>(null);
  const notesTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const transcriptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const descriptionRef = useRef<HTMLDivElement | null>(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [isNotesDirty, setIsNotesDirty] = useState(false);
  const [timestampUndoState, setTimestampUndoState] = useState<TimestampUndoState | null>(null);
  const timestampUndoTimeoutRef = useRef<number | null>(null);
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
  const autoSizeTextarea = useCallback((textarea: HTMLTextAreaElement | null) => {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(textarea.scrollHeight, 224)}px`;
  }, []);
  const notesDraftRef = useRef('');
  const isNotesDirtyRef = useRef(false);
  const activeVideoIdRef = useRef<string | null>(null);

  useEffect(() => {
    setDetailMode('description');
    setTagInput('');
    setTranscriptSearch('');
    setActiveRange(null);
    setIsEditingTranscript(false);
  }, [hasMultiSelection, videoId]);

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
  const {
    playerShellRef,
    playerFrameRef,
    playerRef,
    playerState,
    playerDuration,
    playerLoadError,
  } = useYouTubePlayer({ enabled: !hasMultiSelection, videoId, videoTitle, onWatchSession });
  const currentNotes = savedNotes || '';
  const parsedTimestampDocument = useMemo(
    () => parseTimestampDocument(notesDraft, annotation?.timestampRefs || [], playerDuration),
    [annotation?.timestampRefs, notesDraft, playerDuration],
  );

  const setNotesDraftState = useCallback((nextNotes: string, dirty: boolean) => {
    setNotesDraft(nextNotes);
    notesDraftRef.current = nextNotes;
    isNotesDirtyRef.current = dirty;
    setIsNotesDirty(dirty);
  }, []);

  const flushNotesDraft = useCallback((targetVideoId: string | null, nextValue?: string) => {
    if (!targetVideoId) return;
    const value = nextValue ?? notesDraftRef.current;
    onUpdateNotes(targetVideoId, value);
  }, [onUpdateNotes]);

  const clearTimestampUndo = useCallback(() => {
    if (timestampUndoTimeoutRef.current !== null) {
      window.clearTimeout(timestampUndoTimeoutRef.current);
      timestampUndoTimeoutRef.current = null;
    }
    setTimestampUndoState(null);
  }, []);

  const startTimestampUndo = useCallback((payload: TimestampUndoState) => {
    if (timestampUndoTimeoutRef.current !== null) {
      window.clearTimeout(timestampUndoTimeoutRef.current);
    }
    setTimestampUndoState(payload);
    timestampUndoTimeoutRef.current = window.setTimeout(() => {
      timestampUndoTimeoutRef.current = null;
      setTimestampUndoState(null);
    }, 5200);
  }, []);

  const applyTimestampMutation = useCallback((
    nextNotes: string,
    nextTimestampRefs: TimestampRef[],
    options?: { cursorPosition?: number | null; focus?: boolean },
  ) => {
    if (!videoId) return;
    setNotesDraftState(nextNotes, false);
    onUpdateNotes(videoId, nextNotes);
    onUpdateAnnotation(videoId, { timestampRefs: nextTimestampRefs });
    setDetailMode('annotate');
    const shouldFocus = options?.focus !== false;
    if (!shouldFocus) return;
    const cursorPosition = options?.cursorPosition;
    if (cursorPosition !== undefined && cursorPosition !== null) {
      focusNotesEditor(cursorPosition);
      return;
    }
    focusNotesEditor();
  }, [focusNotesEditor, onUpdateAnnotation, onUpdateNotes, setNotesDraftState, videoId]);

  const handleAddTimestamp = useCallback(() => {
    if (!videoId || !playerRef.current?.getCurrentTime) return;
    const playheadSeconds = Number(playerRef.current.getCurrentTime() || 0);
    const result = insertAtPlayhead({
      notes: notesDraftRef.current,
      timestampRefs: parsedTimestampDocument.timestampRefs,
      playheadSeconds,
      durationSeconds: playerDuration,
    });
    clearTimestampUndo();
    applyTimestampMutation(result.notes, result.timestampRefs, { cursorPosition: result.cursorPosition });
  }, [applyTimestampMutation, clearTimestampUndo, parsedTimestampDocument.timestampRefs, playerDuration, playerRef, videoId]);

  const handleDeleteTimestamp = useCallback((entryId: string) => {
    if (!videoId) return;
    const snapshotNotes = notesDraftRef.current;
    const snapshotRefs = parsedTimestampDocument.timestampRefs;
    const result = removeById({
      notes: snapshotNotes,
      timestampRefs: snapshotRefs,
      entryId,
      durationSeconds: playerDuration,
    });
    if (!result.removed || !result.removedEntry) return;
    applyTimestampMutation(result.notes, result.timestampRefs, { focus: false });
    startTimestampUndo({
      notes: snapshotNotes,
      timestampRefs: snapshotRefs,
      deletedLabel: result.removedEntry.time_label,
    });
  }, [
    applyTimestampMutation,
    parsedTimestampDocument.timestampRefs,
    playerDuration,
    startTimestampUndo,
    videoId,
  ]);

  const handleUndoTimestampDelete = useCallback(() => {
    if (!videoId || !timestampUndoState) return;
    applyTimestampMutation(timestampUndoState.notes, timestampUndoState.timestampRefs, { focus: false });
    clearTimestampUndo();
  }, [applyTimestampMutation, clearTimestampUndo, timestampUndoState, videoId]);

  useEffect(() => {
    const previousVideoId = activeVideoIdRef.current;
    const switchedVideo = previousVideoId !== videoId;

    if (previousVideoId && switchedVideo && isNotesDirtyRef.current) {
      flushNotesDraft(previousVideoId);
    }

    if (switchedVideo) {
      activeVideoIdRef.current = videoId;
      setNotesDraftState(currentNotes, false);
      return;
    }

    activeVideoIdRef.current = videoId;
  }, [videoId, currentNotes, flushNotesDraft, setNotesDraftState]);

  useEffect(() => {
    if (activeVideoIdRef.current === videoId && !isNotesDirtyRef.current && notesDraftRef.current !== currentNotes) {
      setNotesDraftState(currentNotes, false);
    }
  }, [currentNotes, videoId, setNotesDraftState]);

  useEffect(() => {
    clearTimestampUndo();
  }, [clearTimestampUndo, videoId, hasMultiSelection]);

  useEffect(() => () => {
    if (timestampUndoTimeoutRef.current !== null) {
      window.clearTimeout(timestampUndoTimeoutRef.current);
      timestampUndoTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!videoId || hasMultiSelection) return;
    const timeout = window.setTimeout(() => {
      const nextTimestampRefs = parsedTimestampDocument.timestampRefs;
      if (timestampRefsEqual(annotation?.timestampRefs || [], nextTimestampRefs)) return;
      onUpdateAnnotation(videoId, { timestampRefs: nextTimestampRefs });
    }, 260);
    return () => window.clearTimeout(timeout);
  }, [
    annotation?.timestampRefs,
    hasMultiSelection,
    onUpdateAnnotation,
    parsedTimestampDocument.timestampRefs,
    videoId,
  ]);

  useEffect(() => {
    if (!videoId || !isNotesDirty) return;
    const timeout = window.setTimeout(() => {
      flushNotesDraft(videoId);
      isNotesDirtyRef.current = false;
      setIsNotesDirty(false);
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [videoId, isNotesDirty, flushNotesDraft]);

  useEffect(() => () => {
    if (activeVideoIdRef.current && isNotesDirtyRef.current) {
      flushNotesDraft(activeVideoIdRef.current);
    }
  }, [flushNotesDraft]);

  useEffect(() => {
    if (!isEditingTranscript) {
      setTranscriptEditValue(transcript);
    }
  }, [isEditingTranscript, transcript]);

  useEffect(() => {
    autoSizeTextarea(notesTextareaRef.current);
  }, [autoSizeTextarea, detailMode, notesDraft, videoId]);

  useEffect(() => {
    if (!isEditingTranscript) return;
    autoSizeTextarea(transcriptTextareaRef.current);
  }, [autoSizeTextarea, isEditingTranscript, transcriptEditValue, videoId]);

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

      const isTimestampShortcut = (key === 't' || event.code.toLowerCase() === 'keyt')
        && event.shiftKey
        && !event.altKey
        && !event.ctrlKey
        && !event.metaKey;
      if (isTimestampShortcut) {
        event.preventDefault();
        handleAddTimestamp();
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

    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleAddTimestamp, hasMultiSelection, playerFrameRef, playerRef, playerState, videoId]);

  if (hasMultiSelection) {
    return (
      <BatchSelectionPanel
        selectedCount={selectedCount}
        batchSelectionKey={batchSelectionKey}
        isExcludedView={isExcludedView}
        batchSharedTags={batchSharedTags}
        isBatchTagging={isBatchTagging}
        onBatchAddTag={onBatchAddTag}
        onBatchRemoveTag={onBatchRemoveTag}
        onBatchApplyNotes={onBatchApplyNotes}
        onBatchExclude={onBatchExclude}
        onBatchCopySelection={onBatchCopySelection}
      />
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
  const timestampEntries = parsedTimestampDocument.entries;
  const markerDurationSeconds = Math.max(
    playerDuration,
    timestampEntries.reduce((maxValue, entry) => Math.max(maxValue, entry.time_seconds), 0),
  );

  const submitTag = () => {
    const trimmed = tagInput.trim();
    if (!trimmed || !videoId) return;

    if (!currentTags.includes(trimmed)) {
      onUpdateAnnotation(videoId, { tags: [...currentTags, trimmed] });
    }

    setTagInput('');
    setDetailMode('annotate');
  };





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

  const persistManagedNotes = (nextQuoteRefs: QuoteRef[]) => {
    if (!videoId) return;
    onUpdateAnnotation(videoId, {
      quoteRefs: nextQuoteRefs,
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
    persistManagedNotes(nextQuoteRefs);
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
        {videoId && markerDurationSeconds > 0 && timestampEntries.length > 0 && (
          <TimestampMarkerRail
            markers={timestampEntries}
            durationSeconds={markerDurationSeconds}
            onDeleteMarker={handleDeleteTimestamp}
          />
        )}
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-6 p-6">
          <section>
            <div className="mb-3 flex items-start gap-2">
              <h2 className="min-w-0 flex-1 text-[16px] font-bold leading-tight text-[var(--text-main)]">{title}</h2>
            </div>
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border-color)] pb-5 text-[12px] text-[var(--text-muted)]">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 leading-snug">
                <span className="whitespace-nowrap">{views !== undefined ? Number(views).toLocaleString() : '0'} views</span>
                <span className="whitespace-nowrap">{publishedAt ? new Date(publishedAt).toLocaleDateString() : 'N/A'}</span>
              </div>
              <div className="inline-flex overflow-hidden rounded-[6px] border border-[var(--border-color)] bg-[var(--bg-primary)]">
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
                          ? 'bg-[var(--grid-hover)] text-[var(--text-main)]'
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
                  <div className="space-y-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Imported tags</div>
                    <div className="flex min-h-[1.75rem] flex-wrap gap-2">
                      {videoTags.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={(event) => onApplyTagFilter(tag, 'imported', event.ctrlKey || event.metaKey)}
                          className="border border-[var(--border-color)]/70 bg-[var(--bg-primary)] px-2.5 py-1 text-[12px] text-[var(--text-main)] hover:border-[var(--accent)]"
                          title="Filter by this imported tag"
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Video description</div>
                    {description ? (
                      <button
                        type="button"
                        onClick={handleQuoteDescriptionSelection}
                        className="inline-flex items-center gap-1 border-b border-[var(--border-color)]/50 px-1 py-1 text-[12px] font-medium text-[var(--text-muted)] hover:text-[var(--text-main)]"
                        title="Quote selected description text into notes"
                      >
                        <Plus size={12} /> Quote selection
                      </button>
                    ) : null}
                  </div>
                  <div ref={descriptionRef} className="min-h-[14rem] whitespace-pre-wrap rounded-[6px] border border-[var(--border-color)]/70 bg-[var(--bg-primary)] px-3 py-2 font-mono text-[13px] leading-5 text-[var(--text-muted)]">
                    {description || <span className="text-[var(--text-muted)]">No video description was imported for this video.</span>}
                  </div>
                </div>
              </>
            )}

            {detailMode === 'transcript' && (
              <div className="space-y-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Video transcript</div>
                <div className="flex items-center justify-between gap-3">
                  <InputRow
                    icon={<Search size={14} />}
                    value={transcriptSearch}
                    onChange={setTranscriptSearch}
                    placeholder="Search transcript"
                    variant="panel"
                  />
                  {!isEditingTranscript ? (
                    <button
                      type="button"
                      onClick={() => setIsEditingTranscript(true)}
                      className="inline-flex shrink-0 items-center gap-1 px-1 py-1 text-[12px] font-medium text-[var(--text-muted)] hover:text-[var(--text-main)]"
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
                    ref={transcriptTextareaRef}
                    value={transcriptEditValue}
                    onChange={(event) => {
                      setTranscriptEditValue(event.target.value);
                      autoSizeTextarea(event.currentTarget);
                    }}
                    className="min-h-[14rem] w-full overflow-hidden rounded-[6px] border border-[var(--border-color)]/70 bg-[var(--bg-primary)] px-3 py-2 font-mono text-[13px] leading-5 text-[var(--text-muted)] focus:outline-none"
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
              <div className="space-y-5">
                <div className="space-y-2">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">User tags</div>
                  <div className="flex min-h-[1.75rem] flex-wrap items-center gap-2">
                    {currentTags.map((tag) => (
                      <span key={tag} className="flex items-center gap-1 border border-[var(--border-color)]/70 bg-[var(--bg-primary)] px-2.5 py-1 text-[12px] text-[var(--text-main)]">
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
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        submitTag();
                      }}
                      onMouseDownCapture={(event) => event.stopPropagation()}
                      onPointerDownCapture={(event) => event.stopPropagation()}
                      onClickCapture={(event) => event.stopPropagation()}
                      className="flex min-w-[14rem] flex-1 items-center gap-2 rounded-[6px] border border-[var(--border-color)]/70 bg-[var(--bg-primary)] px-2.5 py-1"
                    >
                      <span className="text-[var(--text-muted)]"><Tag size={13} /></span>
                      <input
                        type="text"
                        value={tagInput}
                        onChange={(event) => setTagInput(event.target.value)}
                        onMouseDownCapture={(event) => event.stopPropagation()}
                        onPointerDownCapture={(event) => event.stopPropagation()}
                        onClickCapture={(event) => event.stopPropagation()}
                        placeholder="Type user tag and press Enter..."
                        className="w-full bg-transparent text-[12px] leading-5 text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none"
                      />
                    </form>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Timestamp annotations</div>
                    <button
                      type="button"
                      onClick={handleAddTimestamp}
                      disabled={!videoId}
                      className="inline-flex items-center gap-1 border-b border-[var(--border-color)]/50 px-1 py-1 text-[12px] font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] disabled:opacity-40"
                      title="Add timestamp at current playhead"
                    >
                      <Clock3 size={11} />
                      Add
                    </button>
                  </div>
                  {timestampEntries.length > 0 ? (
                    <div className="flex min-h-[1.75rem] flex-wrap gap-2">
                      {timestampEntries.map((entry) => (
                        <div key={entry.id} className="flex items-start gap-2 border border-[var(--border-color)]/70 bg-[var(--bg-primary)] px-2.5 py-1.5 text-[12px]">
                          <div className="min-w-0">
                            <div className="font-mono text-[12px] font-semibold text-[var(--text-main)]">{entry.time_label}</div>
                            <div className="max-w-[16rem] truncate text-[13px] leading-5 text-[var(--text-muted)]">{buildMarkerPreview(entry.body)}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteTimestamp(entry.id)}
                            className="mt-0.5 shrink-0 text-[var(--text-muted)] transition-colors hover:text-red-500"
                            aria-label={`Delete timestamp ${entry.time_label}`}
                            title={`Delete timestamp ${entry.time_label}`}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-[6px] border border-[var(--border-color)]/70 bg-[var(--bg-primary)] px-2.5 py-1.5">
                      <p className="text-[13px] leading-5 text-[var(--text-muted)]">No timestamp annotations yet. Use Shift + T while watching or click Add.</p>
                    </div>
                  )}
                </div>

                <div className="space-y-3 pt-2">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Notes markdown</div>
                  <div className="rounded-[6px] border border-[var(--border-color)]/70 bg-[var(--bg-primary)] px-2.5 py-1.5">
                    <textarea
                      ref={notesTextareaRef}
                      value={notesDraft}
                      onChange={(event) => {
                        updateNotes(event.target.value);
                        autoSizeTextarea(event.currentTarget);
                      }}
                      onBlur={() => {
                        if (videoId && isNotesDirtyRef.current) {
                          flushNotesDraft(videoId);
                          isNotesDirtyRef.current = false;
                          setIsNotesDirty(false);
                        }
                      }}
                      placeholder="# Notes\n\nAdd observations, ideas, and references here..."
                      className="min-h-[14rem] w-full overflow-hidden bg-transparent px-0 py-0 text-[13px] leading-5 text-[var(--text-muted)] placeholder:text-[var(--text-muted)] focus:outline-none"
                    />
                  </div>
                  <NotesPreview
                    quoteRefs={quoteRefs}
                    onQuoteClick={handleQuoteClick}
                  />
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
      {timestampUndoState && (
        <div className="shrink-0 border-t border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-2">
          <div className="flex items-center justify-between gap-3 text-[11px] text-[var(--text-main)]">
            <span>Timestamp {timestampUndoState.deletedLabel} deleted.</span>
            <button
              type="button"
              onClick={handleUndoTimestampDelete}
              className="border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1 font-semibold text-[var(--text-main)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              Undo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

