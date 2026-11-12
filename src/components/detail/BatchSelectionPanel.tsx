import { useEffect, useRef, useState } from 'react';
import { Ban, ChevronDown, Copy, Tag, X } from 'lucide-react';
import type { BatchCopyExportMode } from '../../lib/data';
import { InputRow } from './InputRow';

type BatchCopyFeedbackStatus = 'success' | 'empty' | 'error';

const BATCH_COPY_OPTIONS: Array<{ mode: BatchCopyExportMode; label: string }> = [
  { mode: 'videoIds', label: 'Copy video IDs' },
  { mode: 'videoUrls', label: 'Copy video URLs' },
  { mode: 'channelIds', label: 'Copy channel IDs' },
  { mode: 'channelUrls', label: 'Copy channel URLs' },
];

export interface BatchSelectionPanelProps {
  selectedCount: number;
  /** Changes whenever the selection changes; resets drafts and feedback. */
  batchSelectionKey: string;
  /** In the Excluded view the batch action restores instead of excluding. */
  isExcludedView: boolean;
  batchSharedTags: string[];
  isBatchTagging: boolean;
  onBatchAddTag?: (tag: string) => void;
  onBatchRemoveTag?: (tag: string) => void;
  onBatchApplyNotes?: (notes: string) => { status: BatchCopyFeedbackStatus; appliedCount: number; message: string }
    | Promise<{ status: BatchCopyFeedbackStatus; appliedCount: number; message: string }>;
  onBatchExclude?: () => void;
  onBatchCopySelection?: (mode: BatchCopyExportMode) => Promise<{ status: BatchCopyFeedbackStatus; copiedCount: number; message: string }>;
}

/** The right panel while several videos are selected: tag, annotate, copy or exclude them together. */
export function BatchSelectionPanel({
  selectedCount,
  batchSelectionKey,
  isExcludedView,
  batchSharedTags,
  isBatchTagging,
  onBatchAddTag,
  onBatchRemoveTag,
  onBatchApplyNotes,
  onBatchExclude,
  onBatchCopySelection,
}: BatchSelectionPanelProps) {
  const [batchTagInput, setBatchTagInput] = useState('');
  const [batchNotesDraft, setBatchNotesDraft] = useState('');
  const [isBatchCopyMenuOpen, setIsBatchCopyMenuOpen] = useState(false);
  const [batchCopyFeedback, setBatchCopyFeedback] = useState<{ status: BatchCopyFeedbackStatus; message: string } | null>(null);
  const [batchNotesFeedback, setBatchNotesFeedback] = useState<{ status: BatchCopyFeedbackStatus; message: string } | null>(null);
  const batchTagInputRef = useRef<HTMLInputElement | null>(null);
  const batchCopyMenuRef = useRef<HTMLDivElement | null>(null);
  const batchCopyButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousMultiSelectionKeyRef = useRef(batchSelectionKey);

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
              <p className="mt-2 text-xs text-[var(--text-muted)]">Tag selected videos, copy video or channel IDs/URLs, or {isExcludedView ? 'restore' : 'exclude'} the current selection (Ctrl/Cmd + Delete).</p>
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
                title={isExcludedView ? 'Restore selected videos to Included' : 'Exclude selected videos'}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Ban size={13} />
                  {isExcludedView ? 'Restore' : 'Exclude'}
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
