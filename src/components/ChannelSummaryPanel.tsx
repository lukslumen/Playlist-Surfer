import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Tag, StickyNote, Quote, ExternalLink } from 'lucide-react';
import { appendQuotedText } from '../lib/detailNotes';
import { CHANNEL_HEADER_META_KEYS, CHANNEL_KPI_KEYS, EMPTY_PLACEHOLDER, METADATA_HIDDEN_KEYS, MetadataBucket, PROFILE_SNAPSHOT_KEYS, SECTION_PRIORITY, bucketForKey, buildChannelMonogram, dedupeMetadataKeys, fieldLabel, formatMetadataDisplay, formatValue, isEmptyValue, isLongTextFieldKey, orderKeysByPriority, parseArrayLikeValue, resolveChannelDescription, resolveChannelKey } from '../lib/channelFieldFormatting';
import { resolveChannelThumbnailCandidates } from '../lib/channelThumbnails';
import { ChannelBatchPanel, type BatchNoteApplyResult } from './channel/ChannelBatchPanel';

// Shared empty values: a fresh [] or {} on every render would defeat the memos that depend on them.
const NO_TAGS: string[] = [];

type Props = {
  row: any | null;
  defaultRow?: any | null;
  selectedRows?: any[];
  hasChannelRows: boolean;
  isGenerating?: boolean;
  onGenerate?: () => void;
  channelNotesById?: Record<string, string>;
  channelTagsById?: Record<string, string[]>;
  onUpdateChannelNotes?: (channelKey: string, notes: string) => void;
  onReplaceChannelTags?: (channelKey: string, tags: string[]) => void;
  onBatchAddChannelTag?: (tag: string) => void;
  onBatchRemoveChannelTag?: (tag: string) => void;
  onBatchApplyChannelNotes?: (notes: string) => BatchNoteApplyResult | Promise<BatchNoteApplyResult>;
  inclusionView?: 'included' | 'excluded';
  onBatchExcludeChannels?: () => void;
  onBatchCopySelection?: (mode: 'channelIds' | 'channelUrls' | 'videoIds' | 'videoUrls') => Promise<{
    status: 'success' | 'error' | 'empty';
    copiedCount: number;
    message: string;
  }>;
  onChannelNavigateToVideos?: (channelRow: any) => void;
};

export default function ChannelSummaryPanel({
  row,
  defaultRow = null,
  selectedRows = [],
  hasChannelRows,
  isGenerating = false,
  onGenerate,
  channelNotesById = {},
  channelTagsById = {},
  onUpdateChannelNotes,
  onReplaceChannelTags,
  onBatchAddChannelTag,
  onBatchRemoveChannelTag,
  onBatchApplyChannelNotes,
  inclusionView = 'included',
  onBatchExcludeChannels,
  onBatchCopySelection,
  onChannelNavigateToVideos,
}: Props) {
  const [tab, setTab] = useState<'metadata' | 'annotations'>('metadata');
  const [tagInput, setTagInput] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const [thumbIndex, setThumbIndex] = useState(0);
  const [thumbStatus, setThumbStatus] = useState<'loading' | 'loaded' | 'fallback'>('fallback');

  const descriptionRef = useRef<HTMLDivElement | null>(null);
  const notesRef = useRef<HTMLTextAreaElement | null>(null);
  const thumbIndexRef = useRef(0);

  const activeRow = row || defaultRow;
  const selectedCount = selectedRows.length || (activeRow ? 1 : 0);
  const activeKey = resolveChannelKey(activeRow);
  const description = resolveChannelDescription(activeRow);
  const thumbnailCandidates = useMemo(
    () => resolveChannelThumbnailCandidates([activeRow, row, defaultRow]),
    [activeRow, defaultRow, row],
  );
  const thumbnailCandidateSignature = useMemo(() => thumbnailCandidates.join('|'), [thumbnailCandidates]);
  const channelThumbnailUrl = thumbStatus === 'fallback' ? '' : (thumbnailCandidates[thumbIndex] || '');
  const monogram = useMemo(() => buildChannelMonogram(activeRow?.channel_name), [activeRow?.channel_name]);
  const channelId = String(activeRow?.channel_id || '').trim();
  const youtubeChannelUrl = channelId ? `https://www.youtube.com/channel/${channelId}` : '';

  const currentTags = (activeKey && channelTagsById[activeKey]) || NO_TAGS;
  const selectedKeys = useMemo(() => selectedRows.map(resolveChannelKey).filter(Boolean), [selectedRows]);
  const sharedTags = useMemo(() => {
    if (selectedKeys.length <= 1) return currentTags;
    return Array.from(new Set(selectedKeys.flatMap((key): string[] => channelTagsById[key] || []))).sort((a, b) => String(a).localeCompare(String(b)));
  }, [channelTagsById, currentTags, selectedKeys]);

  useEffect(() => {
    setNotesDraft(activeKey ? (channelNotesById[activeKey] || '') : '');
  }, [activeKey, channelNotesById]);

  useEffect(() => {
    if (!thumbnailCandidates.length) {
      thumbIndexRef.current = 0;
      setThumbIndex(0);
      setThumbStatus('fallback');
      return;
    }
    thumbIndexRef.current = 0;
    setThumbIndex(0);
    setThumbStatus('loading');
  }, [activeKey, thumbnailCandidateSignature]);

  useEffect(() => {
    if (selectedKeys.length > 1) setTab('annotations');
  }, [selectedKeys]);

  const metadataSourceKeys = useMemo(
    () => Object.keys(activeRow || {}).filter((key) => !METADATA_HIDDEN_KEYS.has(key) && !isEmptyValue(activeRow[key])),
    [activeRow],
  );

  const metadataSections = useMemo(() => {
    const reservedKeys = new Set<string>([
      ...CHANNEL_KPI_KEYS,
      ...CHANNEL_HEADER_META_KEYS,
    ]);
    const pruneReserved = (keys: string[]) => keys.filter((key) => !reservedKeys.has(key));
    const orderAndDedupe = (keys: string[], priority: string[]) => dedupeMetadataKeys(orderKeysByPriority(keys, priority), activeRow);

    const buckets: Record<MetadataBucket, string[]> = {
      publishing: [],
      performance: [],
      linking: [],
      profile: [],
      imported: [],
    };
    metadataSourceKeys.forEach((key) => {
      buckets[bucketForKey(key)].push(key);
    });

    return {
      publishing: orderAndDedupe(pruneReserved(buckets.publishing), SECTION_PRIORITY.publishing),
      performance: orderAndDedupe(pruneReserved(buckets.performance), SECTION_PRIORITY.performance),
      linking: orderAndDedupe(pruneReserved(buckets.linking), SECTION_PRIORITY.linking),
      profile: orderAndDedupe(pruneReserved(buckets.profile), SECTION_PRIORITY.profile),
      imported: orderAndDedupe(pruneReserved(buckets.imported), []),
    };
  }, [activeRow, metadataSourceKeys]);

  const profileSnapshotKeys = useMemo(
    () => PROFILE_SNAPSHOT_KEYS.filter((key) => metadataSections.profile.includes(key)),
    [metadataSections.profile],
  );

  const profileDetailsKeys = useMemo(
    () => metadataSections.profile.filter((key) => !profileSnapshotKeys.includes(key)),
    [metadataSections.profile, profileSnapshotKeys],
  );

  const mergedProfileTags = useMemo(
    () => Array.from(new Set([...parseArrayLikeValue('channel_user_tags', activeRow?.channel_user_tags), ...currentTags])).sort((a, b) => a.localeCompare(b)),
    [activeRow?.channel_user_tags, currentTags],
  );

  const metricCards = useMemo(() => ([
    { key: 'video_count_in_dataset', label: 'Videos', context: 'In dataset', value: activeRow?.video_count_in_dataset },
    { key: 'channel_video_count', label: 'Uploads', context: 'Imported metadata', value: activeRow?.channel_video_count },
    { key: 'total_views_in_dataset', label: 'Views', context: 'In dataset', value: activeRow?.total_views_in_dataset },
    { key: 'total_likes_in_dataset', label: 'Likes', context: 'In dataset', value: activeRow?.total_likes_in_dataset },
    { key: 'total_comments_in_dataset', label: 'Comments', context: 'In dataset', value: activeRow?.total_comments_in_dataset },
    { key: 'channel_unique_domains', label: 'Linked domains', context: 'Unique', value: activeRow?.channel_unique_domains },
  ]), [activeRow]);

  const handleNavigateToVideos = () => {
    if (!activeRow) return;
    onChannelNavigateToVideos?.(activeRow);
  };

  const handleThumbnailError = useCallback((candidateIndex: number) => {
    if (candidateIndex !== thumbIndexRef.current) return;
    setThumbIndex((current) => {
      if (current !== candidateIndex) return current;
      const next = current + 1;
      if (next < thumbnailCandidates.length) {
        thumbIndexRef.current = next;
        setThumbStatus('loading');
        return next;
      }
      thumbIndexRef.current = current;
      setThumbStatus('fallback');
      return current;
    });
  }, [thumbnailCandidates.length]);

  const handleThumbnailLoad = useCallback((candidateIndex: number) => {
    if (candidateIndex !== thumbIndexRef.current) return;
    setThumbStatus('loaded');
  }, []);

  const focusNotesEditor = () => {
    window.requestAnimationFrame(() => {
      const textarea = notesRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      textarea.scrollTop = textarea.scrollHeight;
    });
  };

  const addDescriptionQuote = () => {
    if (!activeKey || !descriptionRef.current || !onUpdateChannelNotes) return;
    const selection = window.getSelection();
    const text = selection?.toString().trim() || '';
    if (!text) return;
    const next = appendQuotedText(channelNotesById[activeKey] || '', 'Description Quotes', text);
    onUpdateChannelNotes(activeKey, next);
    setNotesDraft(next);
    setTab('annotations');
    focusNotesEditor();
  };

  const submitTag = () => {
    const trimmed = tagInput.trim();
    if (!trimmed) return;
    if (activeKey) {
      onReplaceChannelTags?.(activeKey, Array.from(new Set([...(channelTagsById[activeKey] || []), trimmed])));
    }
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    if (activeKey) {
      onReplaceChannelTags?.(activeKey, (channelTagsById[activeKey] || []).filter((item) => item !== tag));
    }
  };

  const renderMetadataValue = (key: string, value: unknown, options?: { metric?: boolean; compactRows?: boolean }) => {
    const display = formatMetadataDisplay(key, value);

    if (Array.isArray(display)) {
      if (!display.length) return <span className="text-[var(--text-muted)]">{EMPTY_PLACEHOLDER}</span>;
      return (
        <div className="custom-scrollbar flex max-h-20 min-w-0 flex-wrap gap-1.5 overflow-y-auto pr-1">
          {display.map((entry) => (
            <span key={`${key}-${entry}`} className="inline-flex max-w-full items-center rounded-[6px] border border-[var(--border-color)]/70 bg-[var(--bg-primary)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-main)]">
              <span className="break-words [overflow-wrap:anywhere]">{entry}</span>
            </span>
          ))}
        </div>
      );
    }

    if (display === EMPTY_PLACEHOLDER) return <span className="text-[var(--text-muted)]">{EMPTY_PLACEHOLDER}</span>;

    if (options?.metric) {
      return <span className="font-mono text-[20px] font-semibold leading-tight tracking-tight text-[var(--text-main)]">{display}</span>;
    }

    if (isLongTextFieldKey(key)) {
      return (
        <p className={`min-w-0 whitespace-pre-wrap break-words font-mono text-[13px] text-[var(--text-muted)] [overflow-wrap:anywhere] ${options?.compactRows ? 'leading-5' : 'leading-5'}`}>
          {display}
        </p>
      );
    }

    return (
      <span className={`block min-w-0 break-words font-mono text-[var(--text-muted)] [overflow-wrap:anywhere] ${options?.compactRows ? 'text-[13px] leading-5' : 'text-[13px] leading-5'}`}>
        {display}
      </span>
    );
  };

  const renderCompactSection = (title: string, keys: string[]) => {
    if (!keys.length) return null;
    return (
      <section className="rounded-[6px] border border-[var(--border-color)]/70 bg-[var(--bg-primary)]">
        <div className="border-b border-[var(--border-color)] px-3 py-2">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">{title}</h3>
        </div>
        <div className="space-y-2 px-3 py-3">
          {keys.map((key) => (
            <div key={key} className="grid min-w-0 gap-1.5 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)] sm:items-start">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">{fieldLabel(key)}</div>
              <div className="min-w-0">{renderMetadataValue(key, activeRow?.[key], { compactRows: true })}</div>
            </div>
          ))}
        </div>
      </section>
    );
  };

  if (!hasChannelRows) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--bg-secondary)] px-6 text-center text-[var(--text-muted)]">
        <div className="max-w-sm space-y-4">
          <div className="text-[16px] font-bold text-[var(--text-main)]">Channel metadata has not been generated yet</div>
          <p className="text-[13px] leading-5">
            Generate channel metadata to inspect channel summaries, linking metrics, and imported channel fields.
          </p>
          {onGenerate ? (
            <button
              type="button"
              onClick={onGenerate}
              disabled={isGenerating}
              className="rounded-[6px] border border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)] px-4 py-2 text-[12px] font-semibold text-[var(--text-main)] transition-colors hover:bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] disabled:opacity-50"
            >
              {isGenerating ? 'Generating...' : 'Generate channel metadata'}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (!activeRow) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--bg-secondary)] px-6 text-center text-[var(--text-muted)]">
        <div className="max-w-sm space-y-3">
          <div className="text-[16px] font-bold text-[var(--text-main)]">Select a channel</div>
          <p className="text-[13px] leading-5">Choose a channel row to inspect metadata and annotations here.</p>
        </div>
      </div>
    );
  }

  if (selectedCount > 1) {
    return (
      <ChannelBatchPanel
        selectedCount={selectedCount}
        isExcludedView={inclusionView === 'excluded'}
        sharedTags={sharedTags}
        onBatchAddChannelTag={onBatchAddChannelTag}
        onBatchRemoveChannelTag={onBatchRemoveChannelTag}
        onBatchApplyChannelNotes={onBatchApplyChannelNotes}
        onBatchExcludeChannels={onBatchExcludeChannels}
        onBatchCopySelection={onBatchCopySelection}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--bg-secondary)]">
      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="min-w-0 space-y-4 px-4 pb-4 pt-2">
          <header className="sticky top-0 z-20 -mx-4 min-w-0 border-b border-[var(--border-color)] bg-[color-mix(in_oklab,var(--bg-primary)_94%,transparent)] px-4 pb-3 pt-2 backdrop-blur">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className="relative mt-0.5 h-[129px] w-[129px] shrink-0 overflow-hidden rounded-full border border-[var(--border-color)]/70 bg-[var(--bg-primary)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--text-main)_6%,transparent)]">
                  <span className="absolute inset-0 flex items-center justify-center text-[13px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                    {monogram}
                  </span>
                  {channelThumbnailUrl ? (
                    <img
                      key={channelThumbnailUrl}
                      src={channelThumbnailUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      onError={() => handleThumbnailError(thumbIndex)}
                      onLoad={() => handleThumbnailLoad(thumbIndex)}
                      className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${thumbStatus === 'loaded' ? 'opacity-100' : 'opacity-0'}`}
                    />
                  ) : null}
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Channel viewer</div>
                  <button
                    type="button"
                    onClick={handleNavigateToVideos}
                    className="min-w-0 max-w-full text-left text-[22px] font-bold leading-tight text-[var(--text-main)] transition-colors hover:text-[var(--accent)] hover:underline"
                    title="Show videos for this channel"
                  >
                    <span className="break-words [overflow-wrap:anywhere]">{formatValue(activeRow.channel_name)}</span>
                  </button>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {youtubeChannelUrl ? (
                  <a
                    href={youtubeChannelUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 rounded-[6px] border border-[var(--border-color)]/70 bg-[var(--bg-primary)] px-2.5 py-1.5 text-[12px] font-semibold text-[var(--text-main)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                    title="Open channel on YouTube"
                  >
                    <ExternalLink size={13} /> Open
                  </a>
                ) : null}
              </div>
            </div>

            <div className="mt-2 flex min-w-0 flex-wrap gap-1.5 text-[11px] text-[var(--text-muted)]">
              <span className="min-w-0 rounded-[6px] border border-[var(--border-color)]/70 bg-[var(--bg-primary)] px-2.5 py-1.5 font-mono text-[12px] text-[var(--text-muted)]">ID: {formatValue(activeRow.channel_id)}</span>
              <span className="min-w-0 rounded-[6px] border border-[var(--border-color)]/70 bg-[var(--bg-primary)] px-2.5 py-1.5 font-mono text-[12px] text-[var(--text-muted)]">Selected: {selectedCount.toLocaleString()}</span>
              {activeRow.earliest_publish_date ? (
                <span className="min-w-0 rounded-[6px] border border-[var(--border-color)]/70 bg-[var(--bg-primary)] px-2.5 py-1.5 font-mono text-[12px] text-[var(--text-muted)]">From: {formatValue(activeRow.earliest_publish_date)}</span>
              ) : null}
              {activeRow.latest_publish_date ? (
                <span className="min-w-0 rounded-[6px] border border-[var(--border-color)]/70 bg-[var(--bg-primary)] px-2.5 py-1.5 font-mono text-[12px] text-[var(--text-muted)]">To: {formatValue(activeRow.latest_publish_date)}</span>
              ) : null}
            </div>

            <div className="mt-2 inline-flex overflow-hidden rounded-[6px] border border-[var(--border-color)] bg-[var(--bg-primary)]">
              {(['metadata', 'annotations'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTab(value)}
                  className={`min-w-[6rem] border-l border-[var(--border-color)] px-3 py-1.5 text-[11px] font-semibold transition-colors first:border-l-0 ${
                    tab === value
                      ? 'bg-[var(--grid-hover)] text-[var(--text-main)]'
                      : 'text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-main)]'
                  }`}
                >
                  {value === 'metadata' ? 'Metadata' : 'Annotations'}
                </button>
              ))}
            </div>
          </header>

          {tab === 'metadata' ? (
            <div className="space-y-3 min-w-0">
              <section className="grid min-w-0 grid-cols-2 gap-2">
                {metricCards.map((metric) => (
                  <article key={metric.key} className="min-w-0 rounded-[6px] border border-[var(--border-color)]/70 bg-[var(--bg-primary)] px-2.5 py-1.5">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">{metric.label}</div>
                    <div className="mt-0.5 font-mono text-[11px] leading-4 text-[var(--text-muted)]">{metric.context}</div>
                    <div className="mt-1 min-w-0">{renderMetadataValue(metric.key, metric.value, { metric: true })}</div>
                  </article>
                ))}
              </section>

              <section className="min-w-0 rounded-[6px] border border-[var(--border-color)]/70 bg-[var(--bg-primary)]">
                <div className="flex min-w-0 items-center justify-between gap-2 border-b border-[var(--border-color)] px-3 py-2.5">
                  <div>
                    <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Description</h3>
                    <p className="mt-0.5 font-mono text-[12px] leading-5 text-[var(--text-muted)]">Qualitative summary for quick context.</p>
                  </div>
                  {description ? (
                    <button type="button" onClick={addDescriptionQuote} className="inline-flex shrink-0 items-center gap-1 border-b border-[var(--border-color)]/50 px-1 py-1 text-[12px] font-medium text-[var(--text-muted)] hover:text-[var(--text-main)]">
                      <Quote size={12} /> Quote
                    </button>
                  ) : null}
                </div>
                <div
                  ref={descriptionRef}
                  className="custom-scrollbar max-h-[18rem] min-h-[8rem] overflow-y-auto overflow-x-hidden px-3 py-2 font-mono text-[13px] leading-5 text-[var(--text-muted)]"
                >
                  <div className="min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                    {description || <span className="text-[var(--text-muted)]">No channel description available.</span>}
                  </div>
                </div>
              </section>

              <section className="min-w-0 rounded-[6px] border border-[var(--border-color)]/70 bg-[var(--bg-primary)]">
                <div className="border-b border-[var(--border-color)] px-3 py-2.5">
                  <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Profile snapshot</h3>
                  <p className="mt-0.5 font-mono text-[12px] leading-5 text-[var(--text-muted)]">Identity metadata, taxonomy, and channel-level tags.</p>
                </div>
                <div className="space-y-3 px-3 py-3">
                  <div className="rounded-[6px] border border-[var(--border-color)]/70 bg-[var(--bg-primary)] px-3 py-2.5">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Channel user tags</div>
                    <div className="mt-1.5 min-w-0">
                      {mergedProfileTags.length ? (
                        <div className="custom-scrollbar flex max-h-20 min-w-0 flex-wrap gap-1.5 overflow-y-auto pr-1">
                          {mergedProfileTags.map((tag) => (
                            <span key={tag} className="inline-flex max-w-full items-center rounded-[6px] border border-[var(--border-color)]/70 bg-[var(--bg-primary)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-main)]">
                              <span className="break-words [overflow-wrap:anywhere]">{tag}</span>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[12px] text-[var(--text-muted)]">No channel tags yet.</span>
                      )}
                    </div>
                  </div>

                  {profileSnapshotKeys.length ? (
                    <div className="rounded-[6px] border border-[var(--border-color)]/70 bg-[var(--bg-primary)] px-3 py-2.5">
                      <div className="space-y-2">
                        {profileSnapshotKeys.map((key) => (
                          <div key={key} className="grid min-w-0 gap-1 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)] sm:items-start">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">{fieldLabel(key)}</div>
                            <div className="min-w-0">{renderMetadataValue(key, activeRow?.[key], { compactRows: true })}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {profileDetailsKeys.length ? renderCompactSection('Additional profile details', profileDetailsKeys) : null}
                </div>
              </section>

              {renderCompactSection('Publishing', metadataSections.publishing)}
              {renderCompactSection('Performance', metadataSections.performance)}
              {renderCompactSection('Linking', metadataSections.linking)}

              {metadataSections.imported.length ? (
                <details className="rounded-[6px] border border-[var(--border-color)]/70 bg-[var(--bg-primary)]">
                  <summary className="cursor-pointer list-none px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    Imported fields ({metadataSections.imported.length.toLocaleString()})
                  </summary>
                  <div className="space-y-2 border-t border-[var(--border-color)] px-3 py-3">
                    {metadataSections.imported.map((key) => (
                      <div key={key} className="grid min-w-0 gap-1.5 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)] sm:items-start">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">{fieldLabel(key)}</div>
                        <div className="min-w-0">{renderMetadataValue(key, activeRow?.[key], { compactRows: true })}</div>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3 min-w-0">
              <section className="rounded-[6px] border border-[var(--border-color)]/70 bg-[var(--bg-primary)] p-3">
                <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                  <Tag size={14} /> Channel tags
                </div>
                <div className="mb-3 flex min-w-0 flex-wrap gap-2">
                  {sharedTags.map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-1 rounded-[6px] border border-[var(--border-color)]/70 bg-[var(--bg-primary)] px-2 py-1 text-[12px] text-[var(--text-main)]">
                      {tag}
                      <button type="button" onClick={() => removeTag(tag)} className="text-[var(--text-muted)] hover:text-[var(--text-main)]">x</button>
                    </span>
                  ))}
                  {sharedTags.length === 0 ? <span className="font-mono text-[13px] leading-5 text-[var(--text-muted)]">No tags yet.</span> : null}
                </div>
                <div className="grid min-w-0 gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                  <input
                    value={tagInput}
                    onChange={(event) => setTagInput(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submitTag(); } }}
                    placeholder="Add channel tag"
                    className="min-w-0 rounded-[6px] border border-[var(--border-color)]/70 bg-[var(--bg-primary)] px-3 py-2 font-mono text-[13px] leading-5 text-[var(--text-muted)] placeholder:text-[var(--text-muted)] focus:outline-none"
                  />
                  <button type="button" onClick={submitTag} className="inline-flex items-center gap-1 rounded-[6px] border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-[12px] font-semibold text-white hover:opacity-90">
                    <Plus size={14} /> Add
                  </button>
                </div>
              </section>

              <section className="rounded-[6px] border border-[var(--border-color)]/70 bg-[var(--bg-primary)] p-3">
                <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                  <StickyNote size={14} /> Channel notes
                </div>
                <textarea
                  ref={notesRef}
                  value={notesDraft}
                  onChange={(event) => {
                    const next = event.target.value;
                    setNotesDraft(next);
                    if (activeKey) onUpdateChannelNotes?.(activeKey, next);
                  }}
                  placeholder="# Notes\n\nAdd channel-level observations, quotes, and coding decisions here..."
                  className="custom-scrollbar min-h-[14rem] w-full rounded-[6px] border border-[var(--border-color)]/70 bg-[var(--bg-primary)] px-3 py-2 font-mono text-[13px] leading-5 text-[var(--text-muted)] placeholder:text-[var(--text-muted)] focus:outline-none"
                />
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
