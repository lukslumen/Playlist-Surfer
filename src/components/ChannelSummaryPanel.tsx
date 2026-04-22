import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { Plus, Tag, StickyNote, Quote, Ban, Copy, ChevronDown, X, ExternalLink } from 'lucide-react';
import { formatDateDisplay } from '../lib/data';

type BatchNoteApplyResult = {
  status: 'success' | 'error' | 'empty';
  appliedCount: number;
  message: string;
};

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

type MetadataBucket = 'publishing' | 'performance' | 'linking' | 'profile' | 'imported';

const EMPTY_PLACEHOLDER = 'N/A';

const CHANNEL_BATCH_COPY_OPTIONS: Array<{ mode: 'channelIds' | 'channelUrls' | 'videoIds' | 'videoUrls'; label: string }> = [
  { mode: 'channelIds', label: 'Copy channel IDs' },
  { mode: 'channelUrls', label: 'Copy channel URLs' },
  { mode: 'videoIds', label: 'Copy related video IDs' },
  { mode: 'videoUrls', label: 'Copy related video URLs' },
];

const FIELD_LABELS: Record<string, string> = {
  channel_name: 'Channel name',
  channel_id: 'Channel ID',
  channel_user_tags: 'Channel user tags',
  channel_created_at: 'Channel created',
  channel_subscriber_count: 'Subscribers',
  channel_video_count: 'Channel video count',
  channel_total_views: 'Channel total views',
  channel_country: 'Country',
  channel_default_language: 'Default language',
  channel_keywords: 'Keywords',
  channel_topics: 'Topics',
  channel_description: 'Description',
  channel_linked_video_count: 'Linked videos',
  channel_total_urls: 'Total outgoing URLs',
  channel_unique_domains: 'Unique linked domains',
  channel_top_domains: 'Top linked domains',
  channel_linking_recipe_mix: 'Linking recipe mix',
  video_count_in_dataset: 'Videos in dataset',
  total_views_in_dataset: 'Total views in dataset',
  total_likes_in_dataset: 'Total likes in dataset',
  total_comments_in_dataset: 'Total comments in dataset',
  earliest_publish_date: 'Earliest publish date',
  latest_publish_date: 'Latest publish date',
};

const SECTION_PRIORITY: Record<'publishing' | 'performance' | 'linking' | 'profile', string[]> = {
  publishing: [
    'earliest_publish_date',
    'latest_publish_date',
    'channel_created_at',
    'video_count_in_dataset',
    'channel_video_count',
  ],
  performance: [
    'total_views_in_dataset',
    'total_likes_in_dataset',
    'total_comments_in_dataset',
    'channel_subscriber_count',
    'channel_total_views',
  ],
  linking: [
    'channel_linked_video_count',
    'channel_unique_domains',
    'channel_total_urls',
    'channel_top_domains',
    'channel_linking_recipe_mix',
  ],
  profile: [
    'channel_country',
    'channel_default_language',
    'channel_keywords',
    'channel_topics',
    'channel_thumbnail_url',
  ],
};

const PROFILE_SNAPSHOT_KEYS = [
  'channel_country',
  'channel_default_language',
  'channel_subscriber_count',
  'channel_video_count',
  'channel_total_views',
  'channel_created_at',
  'channel_keywords',
  'channel_topics',
];

const METADATA_HIDDEN_KEYS = new Set([
  'channel_name',
  'channel_id',
  'channel_key',
  'channel_user_tags',
  'channel_description',
  'description',
  'about',
  'channel_about',
  'channelDescription',
  'aboutText',
]);

function isEmptyValue(value: unknown) {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

function fieldLabel(key: string) {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  return key
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function isNumericFieldKey(key: string) {
  return /(count|views?|likes?|comments?|subscribers?|followers?|score|avg|average|rate|ratio|urls?|domains?|videos?)/i.test(key);
}

function isDateFieldKey(key: string) {
  return /(date|published|publish|created|updated|time)$/i.test(key);
}

function isListFieldKey(key: string) {
  return /(tags?|topics?|keywords?|domains?|languages?|countries?|categories?|recipes?|mix|urls?)/i.test(key);
}

function isLongTextFieldKey(key: string) {
  return /(description|about|notes?|summary|bio|transcript)/i.test(key);
}

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === '') return EMPTY_PLACEHOLDER;
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'number') return Number.isFinite(value) ? value.toLocaleString() : EMPTY_PLACEHOLDER;
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return formatDateDisplay(text);
  return text.trim() || EMPTY_PLACEHOLDER;
}

function parseArrayLikeValue(key: string, value: unknown): string[] {
  if (value === null || value === undefined || value === '') return [];
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);

  const text = String(value).trim();
  if (!text) return [];

  if (text.startsWith('[') && text.endsWith(']')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map((entry) => String(entry).trim()).filter(Boolean);
    } catch {
      // fall through
    }
  }

  if (text.includes('|')) return text.split('|').map((entry) => entry.trim()).filter(Boolean);
  if (text.includes(';')) return text.split(';').map((entry) => entry.trim()).filter(Boolean);
  if (isListFieldKey(key) && text.includes(',')) return text.split(',').map((entry) => entry.trim()).filter(Boolean);
  return [];
}

function coerceNumericValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || !/^-?[\d,.]+$/.test(trimmed)) return null;
  const parsed = Number(trimmed.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMetadataDisplay(key: string, value: unknown): string | string[] {
  const list = parseArrayLikeValue(key, value);
  if (list.length) return list;
  if (value === null || value === undefined || value === '') return EMPTY_PLACEHOLDER;
  if (isDateFieldKey(key)) return formatValue(value);
  const numeric = coerceNumericValue(value);
  if (numeric !== null && (isNumericFieldKey(key) || typeof value === 'number')) return numeric.toLocaleString();
  return String(value).trim() || EMPTY_PLACEHOLDER;
}

function resolveChannelKey(row: any) {
  return String(row?.channel_key || row?.channel_id || row?.channel_name || '').trim();
}

function resolveChannelDescription(row: any) {
  const candidates = [
    row?.channel_description,
    row?.description,
    row?.about,
    row?.channel_about,
    row?.channelDescription,
    row?.aboutText,
  ];
  const value = candidates.find((entry) => String(entry ?? '').trim().length > 0);
  return value == null ? '' : String(value);
}

const THUMBNAIL_URL_PRIORITY_KEYS = [
  'channel_thumbnail_url',
  'thumbnailUrl',
  'thumbnail',
  'thumbnail_default',
  'thumbnail_medium',
  'thumbnail_high',
  'thumbnail_maxres',
  'url',
  'src',
  'href',
  'default',
  'medium',
  'high',
  'maxres',
];

function parseJsonLikeValue(value: string): unknown | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const looksLikeJson = (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'));
  if (!looksLikeJson) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function extractEmbeddedHttpUrl(value: string): string | null {
  const match = value.match(/https?:\/\/[^\s"'<>]+/i);
  return match ? match[0] : null;
}

function collectThumbnailUrlCandidates(value: unknown, seen = new Set<unknown>()): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    const parsedJson = parseJsonLikeValue(trimmed);
    if (parsedJson !== null) return collectThumbnailUrlCandidates(parsedJson, seen);
    const embedded = extractEmbeddedHttpUrl(trimmed);
    return embedded ? [embedded] : [trimmed];
  }
  if (typeof value !== 'object') return [];
  if (seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) return value.flatMap((entry) => collectThumbnailUrlCandidates(entry, seen));

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  const orderedKeys = [
    ...THUMBNAIL_URL_PRIORITY_KEYS.filter((key) => key in obj),
    ...keys.filter((key) => !THUMBNAIL_URL_PRIORITY_KEYS.includes(key)),
  ];
  return orderedKeys.flatMap((key) => collectThumbnailUrlCandidates(obj[key], seen));
}

function normalizeHttpUrl(value: string): string | null {
  let candidate = value.trim().replace(/^['"`]+|['"`]+$/g, '');
  if (!candidate) return null;
  if (candidate.startsWith('//')) candidate = `https:${candidate}`;
  if (!/^https?:\/\//i.test(candidate)) {
    const embedded = extractEmbeddedHttpUrl(candidate);
    if (!embedded) return null;
    candidate = embedded;
  }
  candidate = candidate.replace(/[),.;]+$/g, '');
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function resolveChannelThumbnailCandidates(row: any): string[] {
  const rawCandidates = [
    row?.channel_thumbnail_url,
    row?.thumbnailUrl,
    row?.thumbnail,
    row?.thumbnail_default,
    row?.thumbnail_medium,
    row?.thumbnail_high,
    row?.thumbnail_maxres,
  ];
  const urls = rawCandidates
    .flatMap((entry) => collectThumbnailUrlCandidates(entry))
    .map((entry) => normalizeHttpUrl(entry))
    .filter((entry): entry is string => Boolean(entry));
  return Array.from(new Set(urls));
}

function urlsMatch(left: string, right: string): boolean {
  const normalizedLeft = normalizeHttpUrl(left) || left;
  const normalizedRight = normalizeHttpUrl(right) || right;
  return normalizedLeft === normalizedRight;
}

function buildChannelMonogram(channelName: unknown): string {
  const text = String(channelName ?? '').trim();
  if (!text) return 'CH';
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] || ''}${words[1][0] || ''}`.toUpperCase();
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

function orderKeysByPriority(keys: string[], priority: string[]) {
  const unique = Array.from(new Set(keys));
  const prioritySet = new Set(priority);
  const prioritized = priority.filter((key) => unique.includes(key));
  const rest = unique
    .filter((key) => !prioritySet.has(key))
    .sort((a, b) => fieldLabel(a).localeCompare(fieldLabel(b)));
  return [...prioritized, ...rest];
}

function bucketForKey(key: string): MetadataBucket {
  if (SECTION_PRIORITY.publishing.includes(key)) return 'publishing';
  if (SECTION_PRIORITY.performance.includes(key)) return 'performance';
  if (SECTION_PRIORITY.linking.includes(key)) return 'linking';
  if (SECTION_PRIORITY.profile.includes(key)) return 'profile';

  if (/(publish|upload|created|date|video_count)/i.test(key)) return 'publishing';
  if (/(view|like|comment|subscriber|follower|engagement|watch)/i.test(key)) return 'performance';
  if (/(link|domain|url|recipe)/i.test(key)) return 'linking';
  if (/(country|language|keyword|topic|category|tag|profile|thumbnail|about|description)/i.test(key)) return 'profile';
  return 'imported';
}

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
  const [batchNotesDraft, setBatchNotesDraft] = useState('');
  const [isBatchCopyMenuOpen, setIsBatchCopyMenuOpen] = useState(false);
  const [batchCopyFeedback, setBatchCopyFeedback] = useState<{ status: 'success' | 'error' | 'empty'; message: string } | null>(null);
  const [batchNotesFeedback, setBatchNotesFeedback] = useState<BatchNoteApplyResult | null>(null);
  const [thumbIndex, setThumbIndex] = useState(0);
  const [thumbStatus, setThumbStatus] = useState<'loading' | 'loaded' | 'fallback'>('fallback');

  const descriptionRef = useRef<HTMLDivElement | null>(null);
  const notesRef = useRef<HTMLTextAreaElement | null>(null);
  const batchCopyMenuRef = useRef<HTMLDivElement | null>(null);
  const batchCopyButtonRef = useRef<HTMLButtonElement | null>(null);

  const activeRow = row || defaultRow;
  const selectedCount = selectedRows.length || (activeRow ? 1 : 0);
  const activeKey = resolveChannelKey(activeRow);
  const description = resolveChannelDescription(activeRow);
  const thumbnailCandidates = useMemo(
    () => resolveChannelThumbnailCandidates(activeRow),
    [
      activeRow?.channel_thumbnail_url,
      activeRow?.thumbnailUrl,
      activeRow?.thumbnail,
      activeRow?.thumbnail_default,
      activeRow?.thumbnail_medium,
      activeRow?.thumbnail_high,
      activeRow?.thumbnail_maxres,
    ],
  );
  const thumbnailCandidateSignature = useMemo(() => thumbnailCandidates.join('|'), [thumbnailCandidates]);
  const channelThumbnailUrl = thumbStatus === 'fallback' ? '' : (thumbnailCandidates[thumbIndex] || '');
  const monogram = useMemo(() => buildChannelMonogram(activeRow?.channel_name), [activeRow?.channel_name]);
  const channelId = String(activeRow?.channel_id || '').trim();
  const youtubeChannelUrl = channelId ? `https://www.youtube.com/channel/${channelId}` : '';

  const currentTags = activeKey ? (channelTagsById[activeKey] || []) : [];
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
      setThumbIndex(0);
      setThumbStatus('fallback');
      return;
    }
    setThumbIndex(0);
    setThumbStatus('loading');
  }, [activeKey, thumbnailCandidateSignature]);

  useEffect(() => {
    if (selectedKeys.length <= 1) {
      setBatchNotesDraft('');
      setIsBatchCopyMenuOpen(false);
      setBatchCopyFeedback(null);
      setBatchNotesFeedback(null);
    } else {
      setTab('annotations');
    }
  }, [selectedKeys]);

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

  const metadataSourceKeys = useMemo(
    () => Object.keys(activeRow || {}).filter((key) => !METADATA_HIDDEN_KEYS.has(key) && !isEmptyValue(activeRow[key])),
    [activeRow],
  );

  const metadataSections = useMemo(() => {
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
      publishing: orderKeysByPriority(buckets.publishing, SECTION_PRIORITY.publishing),
      performance: orderKeysByPriority(buckets.performance, SECTION_PRIORITY.performance),
      linking: orderKeysByPriority(buckets.linking, SECTION_PRIORITY.linking),
      profile: orderKeysByPriority(buckets.profile, SECTION_PRIORITY.profile),
      imported: orderKeysByPriority(buckets.imported, []),
    };
  }, [metadataSourceKeys]);

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
    { key: 'video_count_in_dataset', label: 'Videos', value: activeRow?.video_count_in_dataset },
    { key: 'total_views_in_dataset', label: 'Views', value: activeRow?.total_views_in_dataset },
    { key: 'total_likes_in_dataset', label: 'Likes', value: activeRow?.total_likes_in_dataset },
    { key: 'total_comments_in_dataset', label: 'Comments', value: activeRow?.total_comments_in_dataset },
    { key: 'channel_linked_video_count', label: 'Linked videos', value: activeRow?.channel_linked_video_count },
    { key: 'channel_unique_domains', label: 'Linked domains', value: activeRow?.channel_unique_domains },
  ]), [activeRow]);

  const handleNavigateToVideos = () => {
    if (!activeRow) return;
    onChannelNavigateToVideos?.(activeRow);
  };

  const handleThumbnailError = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    const failedSrc = event.currentTarget.currentSrc || event.currentTarget.src || '';
    setThumbIndex((current) => {
      const currentCandidate = thumbnailCandidates[current] || '';
      if (currentCandidate && failedSrc && !urlsMatch(failedSrc, currentCandidate)) return current;
      const next = current + 1;
      if (next < thumbnailCandidates.length) {
        setThumbStatus('loading');
        return next;
      }
      setThumbStatus('fallback');
      return current;
    });
  }, [thumbnailCandidates]);

  const handleThumbnailLoad = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    const loadedSrc = event.currentTarget.currentSrc || event.currentTarget.src || '';
    if (channelThumbnailUrl && loadedSrc && !urlsMatch(loadedSrc, channelThumbnailUrl)) return;
    setThumbStatus('loaded');
  }, [channelThumbnailUrl]);

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
    if (selectedKeys.length > 1) {
      onBatchAddChannelTag?.(trimmed);
    } else if (activeKey) {
      onReplaceChannelTags?.(activeKey, Array.from(new Set([...(channelTagsById[activeKey] || []), trimmed])));
    }
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    if (selectedKeys.length > 1) {
      onBatchRemoveChannelTag?.(tag);
    } else if (activeKey) {
      onReplaceChannelTags?.(activeKey, (channelTagsById[activeKey] || []).filter((item) => item !== tag));
    }
  };

  async function submitBatchCopy(mode: 'channelIds' | 'channelUrls' | 'videoIds' | 'videoUrls') {
    if (!onBatchCopySelection || selectedKeys.length === 0) return;
    setBatchCopyFeedback({ status: 'empty', message: 'Preparing copy...' });
    setIsBatchCopyMenuOpen(false);
    const result = await onBatchCopySelection(mode);
    setBatchCopyFeedback({ status: result.status, message: result.message });
  }

  async function submitBatchNotes() {
    if (!onBatchApplyChannelNotes || selectedKeys.length === 0) return;
    const result = await onBatchApplyChannelNotes(batchNotesDraft);
    setBatchNotesFeedback(result);
    if (result.status === 'success') setBatchNotesDraft('');
  }

  const renderMetadataValue = (key: string, value: unknown, options?: { metric?: boolean; compactRows?: boolean }) => {
    const display = formatMetadataDisplay(key, value);

    if (Array.isArray(display)) {
      if (!display.length) return <span className="text-[var(--text-muted)]">{EMPTY_PLACEHOLDER}</span>;
      return (
        <div className="custom-scrollbar flex max-h-20 min-w-0 flex-wrap gap-1.5 overflow-y-auto pr-1">
          {display.map((entry) => (
            <span key={`${key}-${entry}`} className="inline-flex max-w-full items-center rounded-full border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-main)]">
              <span className="break-words [overflow-wrap:anywhere]">{entry}</span>
            </span>
          ))}
        </div>
      );
    }

    if (display === EMPTY_PLACEHOLDER) return <span className="text-[var(--text-muted)]">{EMPTY_PLACEHOLDER}</span>;

    if (options?.metric) {
      return <span className="text-xl font-semibold tracking-tight text-[var(--text-main)]">{display}</span>;
    }

    if (isLongTextFieldKey(key)) {
      return (
        <p className={`min-w-0 whitespace-pre-wrap break-words text-[13px] text-[var(--text-main)] [overflow-wrap:anywhere] ${options?.compactRows ? 'leading-5' : 'leading-6'}`}>
          {display}
        </p>
      );
    }

    return (
      <span className={`block min-w-0 break-words text-[var(--text-main)] [overflow-wrap:anywhere] ${options?.compactRows ? 'text-[12px] leading-5' : 'text-[13px] leading-6'}`}>
        {display}
      </span>
    );
  };

  const renderCompactSection = (title: string, keys: string[]) => {
    if (!keys.length) return null;
    return (
      <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)]">
        <div className="border-b border-[var(--border-color)] px-3 py-2">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">{title}</h3>
        </div>
        <div className="space-y-2 px-3 py-3">
          {keys.map((key) => (
            <div key={key} className="grid min-w-0 gap-1.5 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)] sm:items-start">
              <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">{fieldLabel(key)}</div>
              <div className="min-w-0">{renderMetadataValue(key, activeRow?.[key], { compactRows: true })}</div>
            </div>
          ))}
        </div>
      </section>
    );
  };

  if (!hasChannelRows) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--bg-primary)] px-6 text-center text-[var(--text-muted)]">
        <div className="max-w-sm space-y-4">
          <div className="text-lg font-semibold text-[var(--text-main)]">Channel metadata has not been generated yet</div>
          <p className="text-sm leading-relaxed">
            Generate channel metadata to inspect channel summaries, linking metrics, and imported channel fields.
          </p>
          {onGenerate ? (
            <button
              type="button"
              onClick={onGenerate}
              disabled={isGenerating}
              className="border border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)] px-4 py-2 text-sm font-medium text-[var(--text-main)] transition-colors hover:bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] disabled:opacity-50"
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
      <div className="flex h-full items-center justify-center bg-[var(--bg-primary)] px-6 text-center text-[var(--text-muted)]">
        <div className="max-w-sm space-y-3">
          <div className="text-lg font-semibold text-[var(--text-main)]">Select a channel</div>
          <p className="text-sm leading-relaxed">Choose a channel row to inspect metadata and annotations here.</p>
        </div>
      </div>
    );
  }

  if (selectedCount > 1) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--bg-primary)]">
        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="space-y-4 p-4">
            <section className="space-y-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Batch actions</div>
                <div className="mt-1 text-sm font-medium text-[var(--text-main)]">{selectedCount.toLocaleString()} channels selected</div>
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  Tag selected channels, copy channel or related video IDs/URLs, or {inclusionView === 'excluded' ? 'restore' : 'exclude'} all associated videos in one step.
                </p>
              </div>
              <div className="grid min-w-0 gap-2 md:grid-cols-[minmax(0,1fr)_auto] xl:grid-cols-[minmax(0,1fr)_auto_auto]">
                <input
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submitTag(); } }}
                  placeholder="Add tag to selected channels"
                  className="min-w-0 border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none"
                />
                <button type="button" onClick={submitTag} className="inline-flex items-center gap-1 border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:opacity-90">
                  <Plus size={14} /> Add
                </button>
                <button
                  type="button"
                  onClick={() => onBatchExcludeChannels?.()}
                  disabled={!onBatchExcludeChannels}
                  className="shrink-0 border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 text-[12px] font-medium text-[var(--text-main)] transition-colors hover:border-red-500 hover:text-red-600 disabled:opacity-50"
                  title={inclusionView === 'excluded' ? 'Restore associated videos for selected channels' : 'Exclude associated videos for selected channels'}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Ban size={13} />
                    {inclusionView === 'excluded' ? 'Restore' : 'Exclude'}
                  </span>
                </button>
                <div className="relative shrink-0">
                  <button
                    ref={batchCopyButtonRef}
                    type="button"
                    onClick={() => setIsBatchCopyMenuOpen((current) => !current)}
                    disabled={!onBatchCopySelection}
                    className="inline-flex items-center gap-1.5 border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-[12px] font-medium text-[var(--text-main)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
                    aria-expanded={isBatchCopyMenuOpen}
                  >
                    <Copy size={13} />
                    Copy
                    <ChevronDown size={12} className={isBatchCopyMenuOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
                  </button>
                  {isBatchCopyMenuOpen ? (
                    <div ref={batchCopyMenuRef} className="absolute right-0 top-full z-30 mt-1 w-52 border border-[var(--border-color)] bg-[var(--bg-primary)] p-1 shadow-xl">
                      {CHANNEL_BATCH_COPY_OPTIONS.map((option) => (
                        <button
                          key={option.mode}
                          type="button"
                          onClick={() => { void submitBatchCopy(option.mode); }}
                          className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-[11px] text-[var(--text-main)] transition-colors hover:bg-[var(--grid-hover)]"
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
                <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Shared tags across selection</div>
                {sharedTags.length > 0 ? (
                  <div className="flex min-h-[1.75rem] flex-wrap gap-2">
                    {sharedTags.map((tag) => (
                      <span key={tag} className="flex items-center gap-1 border border-[var(--border-color)] bg-[var(--bg-primary)] px-2.5 py-1 text-[11px] text-[var(--text-main)]">
                        <span>{tag}</span>
                        <button type="button" onClick={() => removeTag(tag)} className="text-[var(--text-muted)] transition-colors hover:text-red-500">
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-[var(--text-muted)]">No shared channel tags across the current selection.</p>
                )}
              </div>
              {batchCopyFeedback ? (
                <p className={`text-[11px] ${batchCopyFeedback.status === 'success' ? 'text-[var(--accent)]' : batchCopyFeedback.status === 'error' ? 'text-red-500' : 'text-[var(--text-muted)]'}`}>
                  {batchCopyFeedback.message}
                </p>
              ) : null}
            </section>

            <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text-main)]">
                <StickyNote size={14} /> Batch channel notes
              </div>
              <p className="text-xs text-[var(--text-muted)]">Apply the same note block to all selected channels.</p>
              <textarea
                value={batchNotesDraft}
                onChange={(event) => setBatchNotesDraft(event.target.value)}
                placeholder="Apply the same note block to all selected channels..."
                className="custom-scrollbar min-h-[12rem] w-full border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-3 font-mono text-[13px] leading-6 text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none"
              />
              <div className="mt-3 flex justify-end">
                <button type="button" onClick={() => { void submitBatchNotes(); }} disabled={!batchNotesDraft.trim() || !onBatchApplyChannelNotes} className="border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
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

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--bg-primary)]">
      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="min-w-0 space-y-4 px-4 pb-4 pt-2">
          <header className="sticky top-0 z-20 -mx-4 min-w-0 border-b border-[var(--border-color)] bg-[color-mix(in_oklab,var(--bg-primary)_94%,transparent)] px-4 pb-3 pt-2 backdrop-blur">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className="relative mt-0.5 h-[129px] w-[129px] shrink-0 overflow-hidden rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--text-main)_6%,transparent)]">
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
                      onError={handleThumbnailError}
                      onLoad={handleThumbnailLoad}
                      className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${thumbStatus === 'loaded' ? 'opacity-100' : 'opacity-0'}`}
                    />
                  ) : null}
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">Channel viewer</div>
                  <button
                    type="button"
                    onClick={handleNavigateToVideos}
                    className="min-w-0 max-w-full text-left text-[32px] font-semibold leading-tight text-[var(--text-main)] transition-colors hover:text-[var(--accent)] hover:underline"
                    title="Show videos for this channel"
                  >
                    <span className="break-words [overflow-wrap:anywhere]">{formatValue(activeRow.channel_name)}</span>
                  </button>
                  {Number(activeRow.video_count_in_dataset || 0) > 0 ? (
                    <div className="text-[12px] font-medium text-[var(--text-muted)]">{Number(activeRow.video_count_in_dataset).toLocaleString()} videos in dataset</div>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {youtubeChannelUrl ? (
                  <a
                    href={youtubeChannelUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-main)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                    title="Open channel on YouTube"
                  >
                    <ExternalLink size={13} /> Open
                  </a>
                ) : null}
              </div>
            </div>

            <div className="mt-2 flex min-w-0 flex-wrap gap-1.5 text-[11px] text-[var(--text-muted)]">
              <span className="min-w-0 border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">ID: {formatValue(activeRow.channel_id)}</span>
              <span className="min-w-0 border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">Selected: {selectedCount.toLocaleString()}</span>
              {activeRow.earliest_publish_date ? (
                <span className="min-w-0 border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">From: {formatValue(activeRow.earliest_publish_date)}</span>
              ) : null}
              {activeRow.latest_publish_date ? (
                <span className="min-w-0 border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">To: {formatValue(activeRow.latest_publish_date)}</span>
              ) : null}
            </div>

            <div className="mt-2 flex gap-1.5">
              {(['metadata', 'annotations'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTab(value)}
                  className={`border px-3 py-1.5 text-[12px] font-semibold transition-colors ${tab === value ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-main)] hover:bg-[var(--grid-hover)]'}`}
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
                  <article key={metric.key} className="min-w-0 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">{metric.label}</div>
                    <div className="mt-1 min-w-0">{renderMetadataValue(metric.key, metric.value, { metric: true })}</div>
                  </article>
                ))}
              </section>

              <section className="min-w-0 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)]">
                <div className="flex min-w-0 items-center justify-between gap-2 border-b border-[var(--border-color)] px-3 py-2.5">
                  <div>
                    <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">Description</h3>
                    <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">Qualitative summary for quick context.</p>
                  </div>
                  {description ? (
                    <button type="button" onClick={addDescriptionQuote} className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-[var(--accent)] hover:underline">
                      <Quote size={12} /> Quote
                    </button>
                  ) : null}
                </div>
                <div
                  ref={descriptionRef}
                  className="custom-scrollbar max-h-[18rem] min-h-[8rem] overflow-y-auto overflow-x-hidden px-3 py-3 text-[13px] leading-6 text-[var(--text-main)]"
                >
                  <div className="min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                    {description || <span className="text-[var(--text-muted)]">No channel description available.</span>}
                  </div>
                </div>
              </section>

              <section className="min-w-0 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)]">
                <div className="border-b border-[var(--border-color)] px-3 py-2.5">
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">Profile snapshot</h3>
                  <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">Identity metadata, taxonomy, and channel-level tags.</p>
                </div>
                <div className="space-y-3 px-3 py-3">
                  <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">Channel user tags</div>
                    <div className="mt-1.5 min-w-0">
                      {mergedProfileTags.length ? (
                        <div className="custom-scrollbar flex max-h-20 min-w-0 flex-wrap gap-1.5 overflow-y-auto pr-1">
                          {mergedProfileTags.map((tag) => (
                            <span key={tag} className="inline-flex max-w-full items-center rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-main)]">
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
                    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2.5">
                      <div className="space-y-2">
                        {profileSnapshotKeys.map((key) => (
                          <div key={key} className="grid min-w-0 gap-1 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)] sm:items-start">
                            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">{fieldLabel(key)}</div>
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
                <details className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)]">
                  <summary className="cursor-pointer list-none px-3 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    Imported fields ({metadataSections.imported.length.toLocaleString()})
                  </summary>
                  <div className="space-y-2 border-t border-[var(--border-color)] px-3 py-3">
                    {metadataSections.imported.map((key) => (
                      <div key={key} className="grid min-w-0 gap-1.5 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)] sm:items-start">
                        <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">{fieldLabel(key)}</div>
                        <div className="min-w-0">{renderMetadataValue(key, activeRow?.[key], { compactRows: true })}</div>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3 min-w-0">
              <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--text-main)]">
                  <Tag size={14} /> {selectedCount > 1 ? 'Batch channel tags' : 'Channel tags'}
                </div>
                <div className="mb-3 flex min-w-0 flex-wrap gap-2">
                  {sharedTags.map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-1 border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1 text-xs text-[var(--text-main)]">
                      {tag}
                      <button type="button" onClick={() => removeTag(tag)} className="text-[var(--text-muted)] hover:text-[var(--text-main)]">x</button>
                    </span>
                  ))}
                  {sharedTags.length === 0 ? <span className="text-xs text-[var(--text-muted)]">No tags yet.</span> : null}
                </div>
                <div className="grid min-w-0 gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                  <input
                    value={tagInput}
                    onChange={(event) => setTagInput(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submitTag(); } }}
                    placeholder={selectedCount > 1 ? 'Add tag to selected channels' : 'Add channel tag'}
                    className="min-w-0 border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none"
                  />
                  <button type="button" onClick={submitTag} className="inline-flex items-center gap-1 border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:opacity-90">
                    <Plus size={14} /> Add
                  </button>
                </div>
              </section>

              <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--text-main)]">
                  <StickyNote size={14} /> {selectedCount > 1 ? 'Batch channel notes' : 'Channel notes'}
                </div>
                {selectedCount > 1 ? (
                  <>
                    <textarea
                      value={batchNotesDraft}
                      onChange={(event) => setBatchNotesDraft(event.target.value)}
                      placeholder="Apply the same note block to all selected channels..."
                      className="custom-scrollbar min-h-[12rem] w-full border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-3 font-mono text-[13px] leading-6 text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none"
                    />
                    <div className="mt-3 flex justify-end">
                      <button type="button" onClick={() => { void submitBatchNotes(); }} disabled={!batchNotesDraft.trim() || !onBatchApplyChannelNotes} className="border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
                        Apply to selected channels
                      </button>
                    </div>
                    {batchNotesFeedback ? (
                      <p className={`mt-2 text-[11px] ${batchNotesFeedback.status === 'success' ? 'text-[var(--accent)]' : batchNotesFeedback.status === 'error' ? 'text-red-500' : 'text-[var(--text-muted)]'}`}>
                        {batchNotesFeedback.message}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <textarea
                    ref={notesRef}
                    value={notesDraft}
                    onChange={(event) => {
                      const next = event.target.value;
                      setNotesDraft(next);
                      if (activeKey) onUpdateChannelNotes?.(activeKey, next);
                    }}
                    placeholder="# Notes\n\nAdd channel-level observations, quotes, and coding decisions here..."
                    className="custom-scrollbar min-h-[14rem] w-full border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-3 font-mono text-[13px] leading-6 text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none"
                  />
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
