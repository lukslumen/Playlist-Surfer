import { useEffect, useRef, useState } from 'react';
import { Ban, ChevronDown, Copy, Plus, StickyNote, X } from 'lucide-react';

type CopyMode = 'channelIds' | 'channelUrls' | 'videoIds' | 'videoUrls';

export type BatchNoteApplyResult = {
  status: 'success' | 'error' | 'empty';
  appliedCount: number;
  message: string;
};

const CHANNEL_BATCH_COPY_OPTIONS: Array<{ mode: CopyMode; label: string }> = [
  { mode: 'channelIds', label: 'Copy channel IDs' },
  { mode: 'channelUrls', label: 'Copy channel URLs' },
  { mode: 'videoIds', label: 'Copy related video IDs' },
  { mode: 'videoUrls', label: 'Copy related video URLs' },
];

/** The channel panel while several channels are selected: tag, annotate, copy or exclude them together. */
export function ChannelBatchPanel({
  selectedCount,
  isExcludedView,
  sharedTags,
  onBatchAddChannelTag,
  onBatchRemoveChannelTag,
  onBatchApplyChannelNotes,
  onBatchExcludeChannels,
  onBatchCopySelection,
}: {
  selectedCount: number;
  /** In the Excluded view the batch action restores the channels' videos instead. */
  isExcludedView: boolean;
  sharedTags: string[];
  onBatchAddChannelTag?: (tag: string) => void;
  onBatchRemoveChannelTag?: (tag: string) => void;
  onBatchApplyChannelNotes?: (notes: string) => BatchNoteApplyResult | Promise<BatchNoteApplyResult>;
  onBatchExcludeChannels?: () => void;
  onBatchCopySelection?: (mode: CopyMode) => Promise<{ status: 'success' | 'error' | 'empty'; copiedCount: number; message: string }>;
}) {
  const [tagInput, setTagInput] = useState('');
  const [batchNotesDraft, setBatchNotesDraft] = useState('');
  const [isBatchCopyMenuOpen, setIsBatchCopyMenuOpen] = useState(false);
  const [batchCopyFeedback, setBatchCopyFeedback] = useState<{ status: 'success' | 'error' | 'empty'; message: string } | null>(null);
  const [batchNotesFeedback, setBatchNotesFeedback] = useState<BatchNoteApplyResult | null>(null);
  const batchCopyMenuRef = useRef<HTMLDivElement | null>(null);
  const batchCopyButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isBatchCopyMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      const insideMenu = !!batchCopyMenuRef.current && batchCopyMenuRef.current.contains(target);
      const insideButton = !!batchCopyButtonRef.current && batchCopyButtonRef.current.contains(target);
      if (!insideMenu && !insideButton) setIsBatchCopyMenuOpen(false);
    };
    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [isBatchCopyMenuOpen]);

  useEffect(() => {
    if (!batchCopyFeedback) return;
    const timeout = window.setTimeout(() => setBatchCopyFeedback(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [batchCopyFeedback]);

  useEffect(() => {
    if (!batchNotesFeedback) return;
    const timeout = window.setTimeout(() => setBatchNotesFeedback(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [batchNotesFeedback]);

  const submitTag = () => {
    const trimmed = tagInput.trim();
    if (!trimmed) return;
    onBatchAddChannelTag?.(trimmed);
    setTagInput('');
  };

  async function submitBatchCopy(mode: CopyMode) {
    if (!onBatchCopySelection || selectedCount === 0) return;
    setBatchCopyFeedback({ status: 'empty', message: 'Preparing copy...' });
    setIsBatchCopyMenuOpen(false);
    const result = await onBatchCopySelection(mode);
    setBatchCopyFeedback({ status: result.status, message: result.message });
  }

  async function submitBatchNotes() {
    if (!onBatchApplyChannelNotes || selectedCount === 0) return;
    const result = await onBatchApplyChannelNotes(batchNotesDraft);
    setBatchNotesFeedback(result);
    if (result.status === 'success') setBatchNotesDraft('');
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--bg-secondary)]">
      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="space-y-4 p-4">
          <section className="space-y-3 rounded-[6px] border border-[var(--border-color)]/70 bg-[var(--bg-primary)] p-4">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Batch actions</div>
              <div className="mt-1 text-[13px] font-semibold text-[var(--text-main)]">{selectedCount.toLocaleString()} channels selected</div>
              <p className="mt-2 text-[12px] leading-5 text-[var(--text-muted)]">
                Tag selected channels, copy channel or related video IDs/URLs, or {isExcludedView ? 'restore' : 'exclude'} all associated videos in one step.
              </p>
            </div>
            <div className="grid min-w-0 gap-2 md:grid-cols-[minmax(0,1fr)_auto] xl:grid-cols-[minmax(0,1fr)_auto_auto]">
              <input
                value={tagInput}
                onChange={(event) => setTagInput(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submitTag(); } }}
                placeholder="Add tag to selected channels"
                className="min-w-0 rounded-[6px] border border-[var(--border-color)]/70 bg-[var(--bg-primary)] px-3 py-2 font-mono text-[13px] leading-5 text-[var(--text-muted)] placeholder:text-[var(--text-muted)] focus:outline-none"
              />
              <button type="button" onClick={submitTag} className="inline-flex items-center gap-1 rounded-[6px] border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-[12px] font-semibold text-white hover:opacity-90">
                <Plus size={14} /> Add
              </button>
              <button
                type="button"
                onClick={() => onBatchExcludeChannels?.()}
                disabled={!onBatchExcludeChannels}
                className="shrink-0 rounded-[6px] border border-[var(--border-color)]/70 bg-[var(--bg-primary)] px-3 py-2 text-[12px] font-semibold text-[var(--text-main)] transition-colors hover:border-red-500 hover:text-red-600 disabled:opacity-50"
                title={isExcludedView ? 'Restore associated videos for selected channels' : 'Exclude associated videos for selected channels'}
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
                  onClick={() => setIsBatchCopyMenuOpen((current) => !current)}
                  disabled={!onBatchCopySelection}
                  className="inline-flex items-center gap-1.5 rounded-[6px] border border-[var(--border-color)]/70 bg-[var(--bg-primary)] px-3 py-2 text-[12px] font-semibold text-[var(--text-main)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
                  aria-expanded={isBatchCopyMenuOpen}
                >
                  <Copy size={13} />
                  Copy
                  <ChevronDown size={12} className={isBatchCopyMenuOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
                </button>
                {isBatchCopyMenuOpen ? (
                  <div ref={batchCopyMenuRef} className="absolute right-0 top-full z-30 mt-1 w-52 rounded-[6px] border border-[var(--border-color)]/70 bg-[var(--bg-primary)] p-1 shadow-xl">
                    {CHANNEL_BATCH_COPY_OPTIONS.map((option) => (
                      <button
                        key={option.mode}
                        type="button"
                        onClick={() => { void submitBatchCopy(option.mode); }}
                        className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-left text-[11px] text-[var(--text-main)] transition-colors hover:bg-[var(--grid-hover)]"
                      >
                        <Copy size={12} className="shrink-0 text-[var(--text-muted)]" />
                        {option.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="space-y-2 border-t border-[var(--border-color)] pt-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Shared tags across selection</div>
              {sharedTags.length > 0 ? (
                <div className="flex min-h-[1.75rem] flex-wrap gap-2">
                  {sharedTags.map((tag) => (
                    <span key={tag} className="flex items-center gap-1 rounded-[6px] border border-[var(--border-color)]/70 bg-[var(--bg-primary)] px-2.5 py-1 text-[12px] text-[var(--text-main)]">
                      <span>{tag}</span>
                      <button type="button" onClick={() => onBatchRemoveChannelTag?.(tag)} className="text-[var(--text-muted)] transition-colors hover:text-red-500">
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="font-mono text-[13px] leading-5 text-[var(--text-muted)]">No shared channel tags across the current selection.</p>
              )}
            </div>
            {batchCopyFeedback ? (
              <p className={`text-[11px] ${batchCopyFeedback.status === 'success' ? 'text-[var(--accent)]' : batchCopyFeedback.status === 'error' ? 'text-red-500' : 'text-[var(--text-muted)]'}`}>
                {batchCopyFeedback.message}
              </p>
            ) : null}
          </section>

          <section className="rounded-[6px] border border-[var(--border-color)]/70 bg-[var(--bg-primary)] p-4">
            <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
              <StickyNote size={14} /> Batch channel notes
            </div>
            <p className="font-mono text-[13px] leading-5 text-[var(--text-muted)]">Apply the same note block to all selected channels.</p>
            <textarea
              value={batchNotesDraft}
              onChange={(event) => setBatchNotesDraft(event.target.value)}
              placeholder="Apply the same note block to all selected channels..."
              className="custom-scrollbar min-h-[12rem] w-full rounded-[6px] border border-[var(--border-color)]/70 bg-[var(--bg-primary)] px-3 py-2 font-mono text-[13px] leading-5 text-[var(--text-muted)] placeholder:text-[var(--text-muted)] focus:outline-none"
            />
            <div className="mt-3 flex justify-end">
              <button type="button" onClick={() => { void submitBatchNotes(); }} disabled={!batchNotesDraft.trim() || !onBatchApplyChannelNotes} className="rounded-[6px] border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
                Apply to selected channels
              </button>
            </div>
            {batchNotesFeedback ? (
              <p className={`text-[11px] ${batchNotesFeedback.status === 'success' ? 'text-[var(--accent)]' : batchNotesFeedback.status === 'error' ? 'text-red-500' : 'text-[var(--text-muted)]'}`}>
                {batchNotesFeedback.message}
              </p>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
