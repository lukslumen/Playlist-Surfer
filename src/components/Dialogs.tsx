import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { BooleanMapSchema, ExplorerColumnFilterModel, ExplorerFilterModel, GenericFilterKind, GenericNumericOperator, GenericTextOperator } from '../lib/filterCoordinator';
import {
  X,
  Download,
  Settings2,
  Book,
  FilePlus,
  FileArchive,
  FileText,
  TableProperties,
  ChevronRight,
  Trash2,
  Undo2,
  AlertTriangle,
  Plus,
  Info,
  Keyboard,
  CalendarPlus,
} from 'lucide-react';
import { cn } from '../lib/utils';
import {
  ColumnSchema,
  DashboardScope,
  DashboardTemplateTab,
  DashboardThumbnailCacheSnapshot,
  DashboardThumbnailLoadProgress,
  DatasetDashboardSnapshot,
  ExportFormat,
  ChannelMetadataRelationshipType,
  ImportKind,
  ExportOptions,
  ImportSubmission,
  ImportOptions,
  MergeOptions,
  ResearchHistoryEvent,
  ResearchLogCommentSectionId,
  ResearchLogMarkdownOptions,
  ResearchLogSectionId,
  SavedView,
  SavedViewDashboardSnapshot,
  SourceKind,
  SpecialMappings,
  WatchHistoryEntry,
} from '../types';
import {
  buildColumnDisplayNameMap,
  buildMergePreview,
  detectFriendlyImportSchema,
  detectImportKind,
  getColumnDisplayName,
  detectSuggestedMergeJoinColumns,
  detectIncomingChannelIdColumn,
  detectIncomingChannelTitleColumn,
  detectSpecialMappings,
  groupDuplicateRows,
  applyDuplicateSelections,
  NOTES_COLUMN,
  TRANSCRIPT_COLUMN,
  USER_TAGS_COLUMN,
  VIDEO_DESCRIPTION_COLUMN,
  formatDateDisplay,
} from '../lib/data';
import DashboardWorkspace from './dashboard/DashboardWorkspace';


function InfoHint({ text }: { text: string }) {
  return (
    <span className="inline-flex align-middle text-[var(--text-muted)]" title={text}>
      <Info size={12} />
    </span>
  );
}

function SmartSection({
  title,
  subtitle,
  children,
  defaultOpen = true,
  count,
}: { title: string; subtitle?: string; children: React.ReactNode; defaultOpen?: boolean; count?: string | number; }) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen, title]);
  return (
    <section className="border border-[var(--border-color)] bg-[var(--bg-primary)]">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-[var(--grid-hover)]">
        <div>
          <div className="text-sm font-semibold text-[var(--text-main)]">{title}</div>
          {subtitle && <div className="mt-1 text-[11px] text-[var(--text-muted)]">{subtitle}</div>}
        </div>
        <div className="flex items-center gap-2 text-[var(--text-muted)]">
          {count !== undefined && <span className="text-[11px] font-medium">{count}</span>}
          <ChevronRight size={14} className={cn('transition-transform', open && 'rotate-90')} />
        </div>
      </button>
      {open && <div className="border-t border-[var(--border-color)] p-4">{children}</div>}
    </section>
  );
}

interface ImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  fileName: string;
  columns: ColumnSchema[];
  incomingRows: any[];
  existingFileName: string | null;
  existingRows: any[];
  existingSchema: ColumnSchema[];
  existingVisibleColumns: string[];
  specialMappings?: Partial<SpecialMappings>;
  importError?: string | null;
  isSubmitting?: boolean;
  onImport: (submission: ImportSubmission) => void;
}

const DEFAULT_IMPORT_COLUMNS = ['videoTitle', 'title', 'viewCount', 'publishedAtSQL', 'durationSec', 'likeCount', 'channelTitle', 'position'];

type SpecialFieldKey = keyof Pick<SpecialMappings, 'transcriptColumn' | 'descriptionColumn' | 'tagColumn'>;
type SpecialFieldChoiceMode = 'keep' | 'incoming' | 'custom' | 'unmapped';
type SpecialFieldChoice = { mode: SpecialFieldChoiceMode; column?: string };

const SPECIAL_FIELD_CONFIG: Array<{ key: SpecialFieldKey; label: string; help: string; }> = [
  { key: 'transcriptColumn', label: 'Transcript', help: 'Used in the right panel so the app can display and search transcript text.' },
  { key: 'descriptionColumn', label: 'Video description', help: 'Used in the Description tab so the app can show imported video descriptions.' },
  { key: 'tagColumn', label: 'Imported tags', help: 'Used for tags shown above the video description and for tag-based filtering. This does not affect user-created tags.' },
];

function orderColumnsByVisibleOrder(columnNames: string[], preferredOrder: string[] = []) {
  const preferred = preferredOrder.filter((column) => columnNames.includes(column));
  const remaining = columnNames.filter((column) => !preferred.includes(column));
  return [...preferred, ...remaining];
}

function getDefaultSelectedColumns(columns: ColumnSchema[], preferredOrder: string[] = []): string[] {
  const effectiveOrder = preferredOrder.length > 0 ? preferredOrder : DEFAULT_IMPORT_COLUMNS;
  return orderColumnsByVisibleOrder(columns.map((column) => column.column_name), effectiveOrder)
    .filter((column) => DEFAULT_IMPORT_COLUMNS.includes(column));
}

function uniqueOrdered(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function summarizeRowForReview(row: any, joinColumn: string) {
  const title = row?.videoTitle || row?.title || row?.VideoTitle || row?.name;
  const channel = row?.channelTitle || row?.channel || row?.ChannelTitle || row?.creator;
  const date = row?.publishedAtSQL || row?.publishedAt || row?.published_at || row?.date;
  const parts = [
    title ? String(title) : null,
    channel ? `by ${String(channel)}` : null,
    date ? `${String(date)}` : null,
  ].filter(Boolean);
  return `${joinColumn}: ${String(row?.[joinColumn] ?? '—')} ${parts.length ? '— ' + parts.join(' • ') : ''}`;
}

function SummaryBadge({ label, value }: { label: string; value: number | string; }) {
  return (
    <div className="border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-center">
      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 text-sm font-semibold text-[var(--text-main)]">{value}</div>
    </div>
  );
}

function mappingOptionLabel(fieldLabel: string, columnName?: string | null) {
  return columnName ? `${fieldLabel} → ${columnName}` : 'Not mapped';
}

function formatSpecialFieldValue(columnName?: string | null, emptyLabel = 'Not mapped', schema?: ColumnSchema[]) {
  if (!columnName) return emptyLabel;
  const display = getColumnDisplayName(columnName, schema);
  return display === columnName ? columnName : `${display} (${columnName})`;
}

function formatColumnOptionLabel(columnName: string, schema?: ColumnSchema[]) {
  const display = getColumnDisplayName(columnName, schema);
  return display === columnName ? columnName : `${display} (${columnName})`;
}

function formatDetectedSchemaLabel(schemaId: ReturnType<typeof detectFriendlyImportSchema>) {
  if (schemaId === 'youtube-data-tools-channelsearch') return 'Detected: YouTube Data Tools — Channel Search export';
  if (schemaId === 'youtube-data-tools-videolist') return 'Detected: YouTube Data Tools — Video List export';
  return null;
}

function describeSpecialFieldOutcome(fieldLabel: string, columnName?: string | null) {
  return columnName ? `${fieldLabel} will use ${columnName}` : `${fieldLabel} will remain unmapped`;
}

function detectIncomingFieldChoices(
  currentMappings: Partial<SpecialMappings>,
  incomingMappings: Partial<SpecialMappings>,
): Record<SpecialFieldKey, SpecialFieldChoice> {
  const next = {} as Record<SpecialFieldKey, SpecialFieldChoice>;
  (SPECIAL_FIELD_CONFIG.map((field) => field.key) as SpecialFieldKey[]).forEach((key) => {
    const current = currentMappings[key];
    const incoming = incomingMappings[key];
    if (!current && incoming) next[key] = { mode: 'incoming', column: incoming };
    else if (current) next[key] = { mode: 'keep', column: current };
    else next[key] = { mode: 'unmapped' };
  });
  return next;
}

export function ImportDialog({
  isOpen,
  onClose,
  fileName,
  columns,
  incomingRows,
  existingFileName,
  existingRows,
  existingSchema,
  existingVisibleColumns,
  specialMappings,
  importError,
  isSubmitting = false,
  onImport,
}: ImportDialogProps) {
  const [mode, setMode] = useState<'replace' | 'merge' | null>(existingFileName ? null : 'replace');
  const [joinColumn, setJoinColumn] = useState('');
  const [incomingJoinColumn, setIncomingJoinColumn] = useState('');
  const [mergeMode, setMergeMode] = useState<MergeOptions['mergeMode']>('add-update');
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [conflictStrategies, setConflictStrategies] = useState<Record<string, MergeOptions['conflictStrategies'][string]>>({});
  const [rowConflictDecisions, setRowConflictDecisions] = useState<Record<string, Record<string, 'existing' | 'new'>>>({});
  const [unmatchedRowMode, setUnmatchedRowMode] = useState<MergeOptions['unmatchedRowMode']>('all');
  const [selectedUnmatchedKeys, setSelectedUnmatchedKeys] = useState<string[]>([]);
  const [dedupeSelections, setDedupeSelections] = useState<Record<string, number>>({});
  const [existingDuplicateSelections, setExistingDuplicateSelections] = useState<Record<string, number>>({});
  const [showAllMatches, setShowAllMatches] = useState(false);
  const [visibleBuilderOpen, setVisibleBuilderOpen] = useState(false);
  const [visibleSearch, setVisibleSearch] = useState('');
  const [visibleColumnsDraft, setVisibleColumnsDraft] = useState<string[]>([]);
  const [draggedChip, setDraggedChip] = useState<string | null>(null);
  const [specialFieldChoices, setSpecialFieldChoices] = useState<Record<SpecialFieldKey, SpecialFieldChoice>>({} as Record<SpecialFieldKey, SpecialFieldChoice>);
  const [dialogMode, setDialogMode] = useState<'quick' | 'settings'>('quick');
  const [importKind, setImportKind] = useState<ImportKind>('video');
  const [channelMetadataRelationship, setChannelMetadataRelationship] = useState<ChannelMetadataRelationshipType | ''>('');
  const submitButtonRef = useRef<HTMLButtonElement | null>(null);
  const replaceModeButtonRef = useRef<HTMLButtonElement | null>(null);
  const relationshipButtonRef = useRef<HTMLButtonElement | null>(null);

  const incomingColumnNames = useMemo(() => columns.map((column) => column.column_name), [columns]);
  const incomingDisplayNameMap = useMemo(() => buildColumnDisplayNameMap(columns), [columns]);
  const existingDisplayNameMap = useMemo(() => buildColumnDisplayNameMap(existingSchema), [existingSchema]);
  const detectedFriendlySchema = useMemo(() => detectFriendlyImportSchema(columns, fileName), [columns, fileName]);
  const detectedFriendlySchemaLabel = useMemo(() => formatDetectedSchemaLabel(detectedFriendlySchema), [detectedFriendlySchema]);
  const currentMappings = useMemo(() => ({ ...detectSpecialMappings(existingSchema), ...(specialMappings || {}) }), [specialMappings, existingSchema]);
  const detectedIncomingMappings = useMemo(() => detectSpecialMappings(columns), [columns]);
  const effectiveCurrentMappings = useMemo(() => (mode === 'merge' ? currentMappings : {}), [mode, currentMappings]);
  const initialVisibleColumnsPool = useMemo(() => {
    if (existingFileName) {
      return uniqueOrdered([...existingSchema.map((column) => column.column_name), ...incomingColumnNames]);
    }
    return incomingColumnNames;
  }, [existingFileName, existingSchema, incomingColumnNames]);
  const availableVisibleColumns = useMemo(() => {
    if (mode === 'merge' && existingFileName) {
      return uniqueOrdered([...existingSchema.map((column) => column.column_name), ...incomingColumnNames]);
    }
    return incomingColumnNames;
  }, [mode, existingFileName, existingSchema, incomingColumnNames]);
  const incomingChannelIdColumn = useMemo(() => detectIncomingChannelIdColumn(columns), [columns]);
  const incomingChannelTitleColumn = useMemo(() => detectIncomingChannelTitleColumn(columns), [columns]);
  const projectChannelIdColumn = useMemo(() => detectIncomingChannelIdColumn(existingSchema), [existingSchema]);
  const projectChannelTitleColumn = useMemo(() => detectIncomingChannelTitleColumn(existingSchema), [existingSchema]);
  const canMapChannelById = Boolean(incomingChannelIdColumn && projectChannelIdColumn);
  const canMapChannelByTitle = Boolean(incomingChannelTitleColumn && projectChannelTitleColumn);
  const effectiveIncomingJoinColumn = importKind === 'channelMetadata'
    ? (channelMetadataRelationship === 'normalizedChannelTitle' ? (incomingChannelTitleColumn || '') : (incomingChannelIdColumn || ''))
    : incomingJoinColumn;

  useEffect(() => {
    if (!isOpen) return;
    const suggestedJoinColumns = detectSuggestedMergeJoinColumns(existingSchema, columns);
    setMode(existingFileName ? null : 'replace');
    setJoinColumn(suggestedJoinColumns.existingJoinColumn || existingSchema[0]?.column_name || '');
    setIncomingJoinColumn(suggestedJoinColumns.incomingJoinColumn || columns[0]?.column_name || '');
    setMergeMode('add-update');
    setColumnMapping({});
    setConflictStrategies({});
    setRowConflictDecisions({});
    setUnmatchedRowMode('all');
    setSelectedUnmatchedKeys([]);
    setDedupeSelections({});
    setExistingDuplicateSelections({});
    setShowAllMatches(false);
    setVisibleBuilderOpen(false);
    setVisibleSearch('');
    setDialogMode('quick');
    const nextImportKind = detectImportKind(columns, fileName);
    setImportKind(nextImportKind);
    setChannelMetadataRelationship(nextImportKind === 'channelMetadata' ? (canMapChannelById ? 'channelId' : '') : '');

    if (existingFileName) {
      setVisibleColumnsDraft(uniqueOrdered(existingVisibleColumns.filter((column) => initialVisibleColumnsPool.includes(column))));
    } else {
      setVisibleColumnsDraft(getDefaultSelectedColumns(columns, existingVisibleColumns));
    }
  }, [isOpen, columns, existingFileName, existingVisibleColumns, initialVisibleColumnsPool, fileName, canMapChannelById]);

  useEffect(() => {
    if (!isOpen) return;
    if (mode === 'merge' && existingFileName) {
      setVisibleColumnsDraft(uniqueOrdered(existingVisibleColumns.filter((column) => availableVisibleColumns.includes(column))));
      return;
    }
    if (mode === 'replace') {
      setVisibleColumnsDraft(getDefaultSelectedColumns(columns, existingVisibleColumns));
    }
  }, [availableVisibleColumns, columns, existingFileName, existingVisibleColumns, isOpen, mode]);

  useEffect(() => {
    setSpecialFieldChoices(detectIncomingFieldChoices(effectiveCurrentMappings, detectedIncomingMappings));
  }, [mode, effectiveCurrentMappings, detectedIncomingMappings]);

  const duplicateGroupsIncoming = useMemo(() => groupDuplicateRows(incomingRows, effectiveIncomingJoinColumn), [effectiveIncomingJoinColumn, incomingRows]);
  const duplicateGroupsExisting = useMemo(() => importKind === 'channelMetadata' ? [] : groupDuplicateRows(existingRows, joinColumn), [existingRows, importKind, joinColumn]);
  const dedupedIncomingRows = useMemo(
    () => applyDuplicateSelections(incomingRows, duplicateGroupsIncoming, dedupeSelections),
    [incomingRows, duplicateGroupsIncoming, dedupeSelections],
  );
  const dedupedExistingRows = useMemo(
    () => applyDuplicateSelections(existingRows, duplicateGroupsExisting, existingDuplicateSelections),
    [existingRows, duplicateGroupsExisting, existingDuplicateSelections],
  );

  const mergePreview = useMemo(() => {
    if (importKind === 'channelMetadata') return null;
    if (!existingFileName || !joinColumn || !effectiveIncomingJoinColumn) return null;
    return buildMergePreview({
      existingRows: dedupedExistingRows,
      incomingRows: dedupedIncomingRows,
      existingSchema,
      incomingSchema: columns,
      joinColumn,
      incomingJoinColumn: effectiveIncomingJoinColumn,
      columnMapping,
    });
  }, [existingFileName, joinColumn, effectiveIncomingJoinColumn, dedupedExistingRows, dedupedIncomingRows, existingSchema, columns, columnMapping]);

  const unmatchedIncomingRows = useMemo(() => {
    if (!mergePreview || !joinColumn || !effectiveIncomingJoinColumn) return [];
    const existingKeys = new Set(dedupedExistingRows.map((row) => String(row?.[joinColumn] ?? '')));
    return dedupedIncomingRows.filter((row) => !existingKeys.has(String(row?.[effectiveIncomingJoinColumn] ?? '')));
  }, [mergePreview, joinColumn, effectiveIncomingJoinColumn, dedupedExistingRows, dedupedIncomingRows]);

  const resolvedSpecialMappings = useMemo(() => {
    const next: Partial<SpecialMappings> = { ...effectiveCurrentMappings };
    (SPECIAL_FIELD_CONFIG.map((field) => field.key) as SpecialFieldKey[]).forEach((key) => {
      const choice = specialFieldChoices[key];
      const incoming = detectedIncomingMappings[key];
      if (!choice || choice.mode === 'keep') return;
      if (choice.mode === 'incoming') next[key] = incoming || choice.column;
      if (choice.mode === 'custom') next[key] = choice.column || undefined;
      if (choice.mode === 'unmapped') next[key] = undefined;
    });
    return next;
  }, [effectiveCurrentMappings, specialFieldChoices, detectedIncomingMappings]);

  const availableToAdd = useMemo(() => availableVisibleColumns
    .filter((column) => !visibleColumnsDraft.includes(column))
    .filter((column) => column.toLowerCase().includes(visibleSearch.toLowerCase())), [availableVisibleColumns, visibleColumnsDraft, visibleSearch]);

  const canSubmit = importKind === 'channelMetadata'
    ? Boolean(existingFileName && (canMapChannelById || (canMapChannelByTitle && channelMetadataRelationship === 'normalizedChannelTitle')))
    : visibleColumnsDraft.length > 0 && !!mode && (mode === 'replace' || (!!joinColumn && !!effectiveIncomingJoinColumn));

  const handleVisibleChipDrop = (targetColumn: string) => {
    if (!draggedChip || draggedChip === targetColumn) return;
    setVisibleColumnsDraft((current) => {
      const next = current.filter((column) => column !== draggedChip);
      const targetIndex = next.indexOf(targetColumn);
      next.splice(targetIndex, 0, draggedChip);
      return next;
    });
    setDraggedChip(null);
  };


  useEffect(() => {
    if (!isOpen) return;
    const frame = window.requestAnimationFrame(() => {
      if (importKind === 'video' && existingFileName && !mode) {
        replaceModeButtonRef.current?.focus();
        return;
      }
      if (importKind === 'channelMetadata' && existingFileName && !channelMetadataRelationship) {
        relationshipButtonRef.current?.focus();
        return;
      }
      submitButtonRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen, importKind, existingFileName, mode, channelMetadataRelationship, canSubmit]);

  const handleSubmit = () => {
    if (importKind !== 'channelMetadata' && !mode) return;
    const options: ImportOptions = {
      mode: importKind === 'channelMetadata' ? 'merge' : (mode || 'replace'),
      importKind,
      channelMetadataRelationship: importKind === 'channelMetadata' ? ((channelMetadataRelationship || (canMapChannelById ? 'channelId' : 'normalizedChannelTitle')) as ChannelMetadataRelationshipType) : undefined,
      joinColumn,
      incomingJoinColumn: importKind === 'channelMetadata' ? effectiveIncomingJoinColumn : incomingJoinColumn,
      selectedColumns: visibleColumnsDraft,
      specialMappings: resolvedSpecialMappings,
      dedupeSelections,
      mergeOptions: mode === 'merge'
        ? {
            mergeMode,
            columnMapping,
            conflictStrategies,
            rowConflictDecisions,
            unmatchedRowMode,
            selectedUnmatchedKeys,
            specialMappings: resolvedSpecialMappings,
            existingDuplicateSelections,
            incomingDuplicateSelections: dedupeSelections,
          }
        : undefined,
    };

    onImport({ options, incomingRows: dedupedIncomingRows });
  };

  if (!isOpen) return null;

  const reviewCount = (mergePreview?.conflictColumns.length || 0) + (mergePreview?.newColumns.length || 0) + duplicateGroupsIncoming.length + duplicateGroupsExisting.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="dialog-shell flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-4 py-4">
          <div>
            <h3 className="flex items-center gap-2 font-bold text-[var(--text-main)]">
              <FilePlus size={18} className="text-[var(--accent)]" />
              {existingFileName ? 'Import or Merge CSV' : 'Import Data'}
            </h3>
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">Configuring: {fileName}</p>
            {detectedFriendlySchemaLabel ? (
              <div className="mt-2 inline-flex items-center rounded-full border border-[var(--border-color)] bg-[var(--bg-primary)] px-2.5 py-1 text-[10px] font-medium text-[var(--text-main)]">
                {detectedFriendlySchemaLabel}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex border border-[var(--border-color)] bg-[var(--bg-primary)] text-xs font-medium">
              <button type="button" onClick={() => setDialogMode('quick')} className={cn('px-3 py-2 transition-colors', dialogMode === 'quick' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-main)] hover:bg-[var(--grid-hover)]')}>Quick start</button>
              <button type="button" onClick={() => setDialogMode('settings')} className={cn('border-l border-[var(--border-color)] px-3 py-2 transition-colors', dialogMode === 'settings' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-main)] hover:bg-[var(--grid-hover)]')}>Settings</button>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-muted)] transition-colors hover:bg-[var(--grid-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Close import dialog"
              disabled={isSubmitting}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="custom-scrollbar flex-1 space-y-4 overflow-y-auto p-4">
          <SmartSection title="1. File type" subtitle="Choose whether this file is a video dataset or channel metadata that enriches the current project." defaultOpen={true}>
            <div className="grid gap-3 md:grid-cols-2">
              {[
                { value: 'video', title: 'Video dataset', description: 'Create or merge rows in the main video explorer.' },
                { value: 'channelMetadata', title: 'Channel metadata', description: "Enrich the current project's channel rows with imported channel-level fields." },
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => {
                    const nextKind = item.value as ImportKind;
                    setImportKind(nextKind);
                    if (nextKind === 'channelMetadata') setChannelMetadataRelationship(canMapChannelById ? 'channelId' : '');
                  }}
                  className={cn(
                    'border px-4 py-4 text-left transition-colors',
                    importKind === item.value ? 'border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)]' : 'border-[var(--border-color)] bg-[var(--bg-primary)] hover:bg-[var(--grid-hover)]',
                  )}
                >
                  <div className="text-sm font-semibold text-[var(--text-main)]">{item.title}</div>
                  <div className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">{item.description}</div>
                </button>
              ))}
            </div>
          </SmartSection>

          {importKind === 'channelMetadata' ? (
            <SmartSection title="2. Relationship mapping" subtitle="Choose how imported channels should match the active project." defaultOpen={true}>
              <div className="space-y-4">
                {!existingFileName ? (
                  <div className="border border-dashed border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-3 text-sm text-[var(--text-muted)]">
                    Import a video dataset first, then merge channel metadata into that active project.
                  </div>
                ) : null}
                <div className="grid gap-3 md:grid-cols-2">
                  <button
                    ref={canMapChannelById ? relationshipButtonRef : undefined}
                    type="button"
                    disabled={!canMapChannelById}
                    onClick={() => setChannelMetadataRelationship('channelId')}
                    className={cn(
                      'border px-4 py-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                      channelMetadataRelationship === 'channelId' ? 'border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)]' : 'border-[var(--border-color)] bg-[var(--bg-primary)] hover:bg-[var(--grid-hover)]',
                    )}
                  >
                    <div className="text-sm font-semibold text-[var(--text-main)]">Match by channel ID</div>
                    <div className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">Best when both datasets contain a channel ID. Detected: {incomingChannelIdColumn || 'missing'} → {projectChannelIdColumn || 'missing'}.</div>
                  </button>
                  <button
                    type="button"
                    disabled={!canMapChannelByTitle}
                    onClick={() => setChannelMetadataRelationship('normalizedChannelTitle')}
                    className={cn(
                      'border px-4 py-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                      channelMetadataRelationship === 'normalizedChannelTitle' ? 'border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)]' : 'border-[var(--border-color)] bg-[var(--bg-primary)] hover:bg-[var(--grid-hover)]',
                    )}
                  >
                    <div className="text-sm font-semibold text-[var(--text-main)]">Match by normalized channel title</div>
                    <div className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">Case-insensitive title fallback. Detected: {incomingChannelTitleColumn || 'missing'} → {projectChannelTitleColumn || 'missing'}.</div>
                  </button>
                </div>
                {!canMapChannelById && !canMapChannelByTitle ? (
                  <div className="border border-dashed border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-3 text-sm text-[var(--text-muted)]">
                    This file does not expose a usable channel ID or channel title column for safe matching.
                  </div>
                ) : null}
              </div>
            </SmartSection>
          ) : null}
          {importKind === 'video' && existingFileName && mergePreview && (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5" title="This summary shows the scope of the incoming CSV before you choose to replace or merge.">
              <SummaryBadge label="Matching rows" value={mergePreview.matchedCount} />
              <SummaryBadge label="New rows" value={mergePreview.unmatchedIncomingCount} />
              <SummaryBadge label="New columns" value={mergePreview.newColumns.length} />
              <SummaryBadge label="Conflicts" value={mergePreview.conflictColumns.length} />
              <SummaryBadge label="Duplicate groups" value={mergePreview.duplicateGroupsExisting.length + mergePreview.duplicateGroupsIncoming.length} />
            </div>
          )}
          {importKind === 'video' ? <SmartSection title="2. What are you doing?" subtitle={existingFileName ? 'Choose whether this CSV replaces the current project or merges into it.' : 'This file will create a new project.'} defaultOpen={true}>
            {existingFileName ? (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  {[
                    { value: 'replace', title: 'Replace project', description: 'Start fresh with this CSV and replace the current project.' },
                    { value: 'merge', title: 'Merge into current project', description: 'Keep the current project and merge this CSV using a key.' },
                  ].map((item) => (
                    <button
                      key={item.value}
                      ref={item.value === 'replace' ? replaceModeButtonRef : undefined}
                      type="button"
                      onClick={() => setMode(item.value as 'replace' | 'merge')}
                      className={cn(
                        'border px-4 py-4 text-left transition-colors',
                        mode === item.value ? 'border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)]' : 'border-[var(--border-color)] bg-[var(--bg-primary)] hover:bg-[var(--grid-hover)]',
                      )}
                    >
                      <div className="text-sm font-semibold text-[var(--text-main)]">{item.title}</div>
                      <div className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">{item.description}</div>
                    </button>
                  ))}
                </div>
                {!mode && (
                  <div className="border border-dashed border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-3 text-sm text-[var(--text-muted)]">
                    Choose whether this CSV should replace the current project or merge into it to continue.
                  </div>
                )}
                {mode === 'merge' && (
                  <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Project key <InfoHint text="Choose the column from the current project that incoming rows should match against." /></label>
                        <select value={joinColumn} onChange={(e) => setJoinColumn(e.target.value)} className="mt-2 w-full border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none">
                          {existingSchema.map((column) => <option key={column.column_name} value={column.column_name}>{formatColumnOptionLabel(column.column_name, existingSchema)}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Incoming key <InfoHint text="Choose the column from the incoming CSV that should match the project key. This makes merges like id → videoId work cleanly." /></label>
                        <select value={incomingJoinColumn} onChange={(e) => setIncomingJoinColumn(e.target.value)} className="mt-2 w-full border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none">
                          {columns.map((column) => <option key={column.column_name} value={column.column_name}>{formatColumnOptionLabel(column.column_name, columns)}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Merge behavior <InfoHint text="Controls whether matching rows update, new rows are added, or both." /></label>
                      <div className="mt-2 grid gap-2">
                        {[
                          { value: 'add-update', label: 'Add new rows + update matching rows' },
                          { value: 'update-only', label: 'Only update matching rows' },
                          { value: 'add-only', label: 'Only add new rows' },
                        ].map((item) => (
                          <label key={item.value} className="flex items-center gap-2 text-sm text-[var(--text-main)]">
                            <input type="radio" checked={mergeMode === item.value} onChange={() => setMergeMode(item.value as MergeOptions['mergeMode'])} />
                            <span>{item.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="border border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-4 text-sm text-[var(--text-main)]">This CSV will create a new project.</div>
            )}
          </SmartSection> : null}

          {importKind === 'video' && (!existingFileName || mode) && (
            <>
          <SmartSection
            title="2. Visible columns when this dataset opens"
            subtitle="Controls what opens first in the explorer."
            defaultOpen={true}
          >
            <div className="space-y-4">
              <div className="border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Visible order in the explorer <InfoHint text="All columns are still imported. These chips only decide which columns are visible first and the order they appear in the explorer." /></div>
                    <div className="mt-1 text-[11px] text-[var(--text-muted)]">Drag to reorder. Remove a chip to keep that column hidden at first.</div>
                  </div>
                  <button type="button" onClick={() => setVisibleBuilderOpen((value) => !value)} className="border border-[var(--border-color)] px-3 py-2 text-xs font-medium text-[var(--text-main)] hover:bg-[var(--grid-hover)]">
                    {visibleBuilderOpen ? 'Hide column browser' : 'Add columns'}
                  </button>
                </div>
                <div className="flex min-h-12 flex-wrap gap-2 border border-dashed border-[var(--border-color)] bg-[var(--bg-secondary)] p-2">
                  {visibleColumnsDraft.map((column) => (
                    <div
                      key={column}
                      draggable
                      onDragStart={() => setDraggedChip(column)}
                      onDragEnd={() => setDraggedChip(null)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => handleVisibleChipDrop(column)}
                      className={cn('flex items-center gap-2 border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-main)] shadow-sm', draggedChip === column && 'opacity-60')}
                    >
                      <Settings2 size={12} className="text-[var(--text-muted)]" />
                      <span title={formatColumnOptionLabel(column, columns)}>{incomingDisplayNameMap[column] || column}</span>
                      <button type="button" onClick={() => setVisibleColumnsDraft((current) => current.filter((value) => value !== column))} className="text-[var(--text-muted)] hover:text-[var(--text-main)]">
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  {visibleColumnsDraft.length === 0 && <span className="px-2 py-2 text-xs text-[var(--text-muted)]">Choose at least one visible column.</span>}
                </div>
              </div>

              {visibleBuilderOpen && (
                <div className="border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
                  <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Browse all columns <InfoHint text="Add any imported column to the visible chip row. Columns left out here can still be shown later in the explorer." /></div>
                    </div>
                    <input
                      value={visibleSearch}
                      onChange={(event) => setVisibleSearch(event.target.value)}
                      placeholder="Search columns..."
                      className="w-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none md:max-w-xs"
                    />
                  </div>
                  <div className="custom-scrollbar grid max-h-56 gap-2 overflow-y-auto pr-1 md:grid-cols-2">
                    {availableToAdd.map((column) => {
                      const isIncomingOnly = incomingColumnNames.includes(column) && !existingSchema.some((item) => item.column_name === column);
                      return (
                        <button
                          key={column}
                          type="button"
                          onClick={() => setVisibleColumnsDraft((current) => [...current, column])}
                          className="flex items-center justify-between border border-[var(--border-color)] px-3 py-2 text-left text-sm text-[var(--text-main)] hover:bg-[var(--grid-hover)]"
                        >
                          <span className="truncate" title={formatColumnOptionLabel(column, columns)}>{incomingDisplayNameMap[column] || column}</span>
                          <span className="ml-3 flex items-center gap-2">
                            {isIncomingOnly && <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">New</span>}
                            <Plus size={14} className="text-[var(--accent)]" />
                          </span>
                        </button>
                      );
                    })}
                    {availableToAdd.length === 0 && <div className="px-3 py-6 text-sm text-[var(--text-muted)]">No more columns match this search.</div>}
                  </div>
                </div>
              )}
            </div>
          </SmartSection>

          <SmartSection title="3. Special fields used by the app" subtitle="Confirm which incoming columns the app should use for transcript, video description, and imported tags." defaultOpen={true}>
            <div className="space-y-3">
              {SPECIAL_FIELD_CONFIG.map((field) => {
                const current = effectiveCurrentMappings[field.key];
                const incoming = detectedIncomingMappings[field.key];
                const choice = specialFieldChoices[field.key] || { mode: incoming ? 'incoming' : 'unmapped' as const, column: incoming };
                const resulting = resolvedSpecialMappings[field.key];
                const isMergeContext = mode === 'merge';
                const outcomeText = isMergeContext
                  ? (resulting ? `After merge, ${field.label} will use ${formatColumnOptionLabel(resulting, columns)}` : `After merge, ${field.label} will remain unmapped`)
                  : describeSpecialFieldOutcome(field.label, resulting);

                return (
                  <div key={field.key} className="border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-main)]">
                          {field.label}
                          <InfoHint text={field.help} />
                        </div>
                        {isMergeContext ? (
                          <div className="mt-2 space-y-1 text-sm text-[var(--text-muted)]">
                            <div>
                              Current: <span className="font-medium text-[var(--text-main)]">{formatSpecialFieldValue(current, 'Not mapped', existingSchema)}</span>
                            </div>
                            <div>
                              Incoming: <span className="font-medium text-[var(--text-main)]">{formatSpecialFieldValue(incoming, 'No matching column detected', columns)}</span>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-2 text-sm text-[var(--text-muted)]">
                            {incoming ? (
                              <>
                                Detected: <span className="font-medium text-[var(--text-main)]">{formatColumnOptionLabel(incoming, columns)}</span>
                              </>
                            ) : (
                              'No matching column detected'
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-main)]">
                      {outcomeText}
                    </div>

                    <div className="mt-3 space-y-2">
                        <label className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                          {isMergeContext ? 'After merge, use' : 'Use for this role'}
                          <InfoHint text="Changes in this section become part of the project configuration and are saved with project backups." />
                        </label>
                        <select
                          value={choice.mode === 'keep'
                            ? '__keep__'
                            : choice.mode === 'unmapped'
                              ? '__unmapped__'
                              : (choice.column || incoming || '')}
                          onChange={(event) => {
                            const value = event.target.value;
                            setSpecialFieldChoices((currentState) => ({
                              ...currentState,
                              [field.key]: value === '__keep__'
                                ? { mode: 'keep', column: current || incoming || '' }
                                : value === '__unmapped__'
                                  ? { mode: 'unmapped' }
                                  : { mode: value === incoming ? 'incoming' : 'custom', column: value || undefined },
                            }));
                          }}
                          className="w-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none"
                        >
                          {isMergeContext && current ? <option value="__keep__">Keep current mapping ({current})</option> : null}
                          {incomingColumnNames.map((columnName) => <option key={columnName} value={columnName}>{formatColumnOptionLabel(columnName, columns)}</option>)}
                          <option value="__unmapped__">Leave unmapped</option>
                        </select>
                      </div>
                  </div>
                );
              })}
            </div>
          </SmartSection>

          <SmartSection title="4. Review only if needed" subtitle="Expand only if you want to inspect conflicts, new rows, or duplicates." defaultOpen={dialogMode === 'settings' && reviewCount > 0 && mode === 'merge'} count={mode === 'merge' ? reviewCount : duplicateGroupsIncoming.length}>
            <div className="space-y-4">
              {mode === 'merge' && mergePreview && (
                <>
                  <SmartSection title="Column matching" subtitle={`${mergePreview.matchedColumns.length} matched automatically.`} defaultOpen={dialogMode === 'settings' && mergePreview.newColumns.length > 0} count={`${mergePreview.newColumns.length} new`}>
                    <div className="space-y-3">
                      {mergePreview.newColumns.length > 0 && (
                        <div className="border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
                          <div className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">New columns that will be added automatically</div>
                          <div className="flex flex-wrap gap-2">
                            {mergePreview.newColumns.map((column) => <span key={column} className="border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-main)]">{column}</span>)}
                          </div>
                        </div>
                      )}
                      <div className="border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Matched columns</div>
                          <button type="button" onClick={() => setShowAllMatches((value) => !value)} className="text-[11px] font-medium text-[var(--accent)] hover:underline">{showAllMatches ? 'Show fewer' : 'Show all'}</button>
                        </div>
                        <div className="space-y-2">
                          {mergePreview.matchedColumns
                            .filter((match, index) => showAllMatches || index < 6)
                            .map((match) => (
                              <div key={`${match.existingColumn}-${match.incomingColumn}`} className="flex items-center justify-between gap-3 border border-[var(--border-color)] px-3 py-2 text-sm text-[var(--text-main)]">
                                <span className="truncate">{match.existingColumn}</span>
                                <span className="text-[var(--text-muted)]">←</span>
                                <span className="truncate text-[var(--text-muted)]">{match.incomingColumn}</span>
                              </div>
                            ))}
                        </div>
                      </div>
                    </div>
                  </SmartSection>

                  <SmartSection title="Conflicts" subtitle={mergePreview.conflictColumns.length > 0 ? 'Only shown when incoming values disagree with the current project.' : 'No conflicts found.'} defaultOpen={dialogMode === 'settings' && mergePreview.conflictColumns.length > 0} count={mergePreview.conflictColumns.length}>
                    {mergePreview.conflictColumns.length === 0 ? (
                      <p className="text-[11px] text-[var(--text-muted)]">No conflicting values were found for matched rows.</p>
                    ) : (
                      <div className="space-y-4">
                        {mergePreview.conflictColumns.map((conflict) => {
                          const strategy = conflictStrategies[conflict.column] || 'keep-existing';
                          return (
                            <div key={conflict.column} className="border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <div className="text-sm font-semibold text-[var(--text-main)]">{conflict.column}</div>
                                  <div className="text-[11px] text-[var(--text-muted)]">{conflict.count} conflicting value{conflict.count === 1 ? '' : 's'} between <span className="font-medium text-[var(--text-main)]">{conflict.column}</span> and incoming <span className="font-medium text-[var(--text-main)]">{conflict.incomingColumn}</span>.</div>
                                </div>
                                <select value={strategy} onChange={(event) => setConflictStrategies((current) => ({ ...current, [conflict.column]: event.target.value as any }))} className="border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-2 text-sm text-[var(--text-main)] focus:outline-none">
                                  <option value="keep-existing">Keep existing values</option>
                                  <option value="use-new">Use incoming values</option>
                                  <option value="review">Review row by row</option>
                                </select>
                              </div>
                              {strategy === 'review' && (
                                <div className="mt-3 space-y-2">
                                  {dedupedIncomingRows
                                    .filter((row) => {
                                      const incomingValue = row?.[conflict.incomingColumn];
                                      const existingValue = dedupedExistingRows.find((existingRow) => String(existingRow?.[joinColumn] ?? '') === String(row?.[effectiveIncomingJoinColumn] ?? ''))?.[conflict.column];
                                      return incomingValue !== undefined && existingValue !== undefined && incomingValue !== existingValue;
                                    })
                                    .slice(0, 25)
                                    .map((row) => {
                                      const key = String(row?.[effectiveIncomingJoinColumn] ?? '');
                                      const existingRow = dedupedExistingRows.find((candidate) => String(candidate?.[joinColumn] ?? '') === key);
                                      const decision = rowConflictDecisions[conflict.column]?.[key] || 'existing';
                                      return (
                                        <div key={`${conflict.column}-${key}`} className="border border-[var(--border-color)] px-3 py-2 text-xs text-[var(--text-main)]">
                                          <div className="font-semibold">{key}</div>
                                          <div className="mt-1 text-[var(--text-muted)]">Existing: {String(existingRow?.[conflict.column] ?? '')}</div>
                                          <div className="text-[var(--text-muted)]">Incoming: {String(row?.[conflict.incomingColumn] ?? '')}</div>
                                          <div className="mt-2 flex gap-3">
                                            <label className="flex items-center gap-1"><input type="radio" checked={decision === 'existing'} onChange={() => setRowConflictDecisions((current) => ({ ...current, [conflict.column]: { ...(current[conflict.column] || {}), [key]: 'existing' } }))} /> Keep existing</label>
                                            <label className="flex items-center gap-1"><input type="radio" checked={decision === 'new'} onChange={() => setRowConflictDecisions((current) => ({ ...current, [conflict.column]: { ...(current[conflict.column] || {}), [key]: 'new' } }))} /> Use incoming</label>
                                          </div>
                                        </div>
                                      );
                                    })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </SmartSection>

                  <SmartSection title="New rows" subtitle="Choose whether unmatched rows are added automatically or reviewed individually." defaultOpen={dialogMode === 'settings' && unmatchedRowMode === 'custom'} count={mergePreview.unmatchedIncomingCount}>
                    <div className="space-y-3">
                      <div className="flex flex-col gap-2 text-sm text-[var(--text-main)]">
                        <label className="flex items-center gap-2"><input type="radio" checked={unmatchedRowMode === 'all'} onChange={() => setUnmatchedRowMode('all')} /> Add all unmatched rows</label>
                        <label className="flex items-center gap-2"><input type="radio" checked={unmatchedRowMode === 'none'} onChange={() => setUnmatchedRowMode('none')} /> Add no unmatched rows</label>
                        <label className="flex items-center gap-2"><input type="radio" checked={unmatchedRowMode === 'custom'} onChange={() => setUnmatchedRowMode('custom')} /> Review unmatched rows individually</label>
                      </div>
                      {unmatchedRowMode === 'custom' && (
                        <div className="max-h-48 space-y-2 overflow-y-auto border border-[var(--border-color)] bg-[var(--bg-primary)] p-2 custom-scrollbar">
                          {unmatchedIncomingRows.map((row, index) => {
                            const key = String(row?.[effectiveIncomingJoinColumn] ?? `row-${index}`);
                            return (
                              <label key={key} className="flex items-center gap-2 px-2 py-1.5 text-xs text-[var(--text-main)] hover:bg-[var(--bg-secondary)]">
                                <input type="checkbox" checked={selectedUnmatchedKeys.includes(key)} onChange={() => setSelectedUnmatchedKeys((current) => current.includes(key) ? current.filter((value) => value !== key) : [...current, key])} />
                                <span className="truncate">{summarizeRowForReview(row, joinColumn)}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </SmartSection>
                </>
              )}

              <SmartSection title="Duplicate rows" subtitle="Only open this if repeated merge keys need a keeper selected." defaultOpen={dialogMode === 'settings' && duplicateGroupsIncoming.length + duplicateGroupsExisting.length > 0} count={duplicateGroupsIncoming.length + duplicateGroupsExisting.length}>
                <div className="space-y-5 text-sm text-[var(--text-main)]">
                  {duplicateGroupsExisting.length > 0 && (
                    <div>
                      <div className="mb-2 flex items-center gap-2 text-[var(--text-main)]"><AlertTriangle size={14} className="text-[var(--accent)]" /> Existing project duplicates</div>
                      <div className="space-y-3">
                        {duplicateGroupsExisting.map((group) => (
                          <div key={`existing-${group.key}`} className="border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
                            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">{joinColumn}: {group.key}</div>
                            <div className="space-y-2">
                              {group.rows.map((row, idx) => {
                                const originalIndex = group.rowIndices[idx];
                                const checked = (existingDuplicateSelections[group.key] ?? group.rowIndices[0]) === originalIndex;
                                return (
                                  <label key={originalIndex} className="flex items-start gap-2 border border-[var(--border-color)] px-3 py-2">
                                    <input type="radio" checked={checked} onChange={() => setExistingDuplicateSelections((current) => ({ ...current, [group.key]: originalIndex }))} />
                                    <span className="text-xs text-[var(--text-main)] break-all">{summarizeRowForReview(row, joinColumn)}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {duplicateGroupsIncoming.length > 0 && (
                    <div>
                      <div className="mb-2 flex items-center gap-2 text-[var(--text-main)]"><AlertTriangle size={14} className="text-[var(--accent)]" /> Incoming CSV duplicates</div>
                      <div className="space-y-3">
                        {duplicateGroupsIncoming.map((group) => (
                          <div key={`incoming-${group.key}`} className="border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
                            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">{effectiveIncomingJoinColumn || joinColumn}: {group.key}</div>
                            <div className="space-y-2">
                              {group.rows.map((row, idx) => {
                                const originalIndex = group.rowIndices[idx];
                                const checked = (dedupeSelections[group.key] ?? group.rowIndices[0]) === originalIndex;
                                return (
                                  <label key={originalIndex} className="flex items-start gap-2 border border-[var(--border-color)] px-3 py-2">
                                    <input type="radio" checked={checked} onChange={() => setDedupeSelections((current) => ({ ...current, [group.key]: originalIndex }))} />
                                    <span className="text-xs text-[var(--text-main)] break-all">{summarizeRowForReview(row, effectiveIncomingJoinColumn || joinColumn)}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {duplicateGroupsIncoming.length === 0 && duplicateGroupsExisting.length === 0 && (
                    <p className="text-[11px] text-[var(--text-muted)]">No duplicate groups found for the selected key.</p>
                  )}
                </div>
              </SmartSection>
            </div>
          </SmartSection>
            </>
          )}
        </div>

        <div className="border-t border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
          <div className="flex items-center justify-between gap-3">
            {importError ? (
              <div className="max-w-[70%] rounded-md border border-[color-mix(in_oklab,var(--accent)_35%,var(--border-color))] bg-[color-mix(in_oklab,var(--accent)_8%,var(--bg-secondary))] px-3 py-2 text-xs text-[var(--text-main)]">
                {importError}
              </div>
            ) : <div />}
            <button ref={submitButtonRef} onClick={handleSubmit} disabled={!canSubmit || isSubmitting} className="min-w-44 bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50">
              {isSubmitting
                ? (importKind === 'channelMetadata' ? 'Merging...' : 'Importing...')
                : (importKind === 'channelMetadata' ? (!existingFileName ? 'Import a video dataset first' : 'Merge channel metadata') : (!mode && existingFileName ? 'Choose replace or merge' : mode === 'merge' ? 'Merge CSV' : 'Import CSV'))}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  columns: ColumnSchema[];
  onExport: (options: ExportOptions) => void;
  rowCount: number;
  totalRowCount: number;
  hasProjectNotes: boolean;
  hasUserTags: boolean;
  currentProjectName: string;
  markdownOptions: ResearchLogMarkdownOptions;
  onMarkdownOptionsChange: (options: ResearchLogMarkdownOptions) => void;
  dashboardSnapshotsStale: boolean;
  onRecalculateSnapshots: () => void;
}

export function ExportDialog({
  isOpen,
  onClose,
  columns,
  onExport,
  rowCount,
  totalRowCount,
  hasProjectNotes,
  hasUserTags,
  currentProjectName,
  markdownOptions,
  onMarkdownOptionsChange,
  dashboardSnapshotsStale,
  onRecalculateSnapshots,
}: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [selectedColumns, setSelectedColumns] = useState<string[]>(columns.map((column) => column.column_name));
  const [includeFilteredRows, setIncludeFilteredRows] = useState(true);
  const [includeNotesColumn, setIncludeNotesColumn] = useState(true);
  const [includeUserTagsColumn, setIncludeUserTagsColumn] = useState(true);
  const [projectName, setProjectName] = useState(currentProjectName || 'ytde_project');

  useEffect(() => {
    if (isOpen) {
      setSelectedColumns(columns.map((column) => column.column_name));
      setProjectName(currentProjectName || 'ytde_project');
    }
  }, [columns, currentProjectName, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="dialog-shell flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-4 py-4">
          <h3 className="flex items-center gap-2 font-bold text-[var(--text-main)]"><Download size={18} className="text-[var(--accent)]" /> Export Project</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-main)]"><X size={20} /></button>
        </div>
        <div className="custom-scrollbar flex-1 space-y-4 overflow-y-auto p-4">
          <div className="grid gap-3 md:grid-cols-3">
            {[
              { id: 'csv', title: 'CSV data export', description: 'Download a CSV with the columns you choose.', icon: TableProperties },
              { id: 'markdown', title: 'Research Log markdown', description: 'Download the Research Log as markdown.', icon: FileText },
              { id: 'project', title: 'Full project backup', description: 'Download a restore-ready project zip.', icon: FileArchive },
            ].map((option) => {
              const Icon = option.icon;
              return (
                <button key={option.id} onClick={() => setFormat(option.id as ExportFormat)} className={cn('border px-4 py-4 text-left transition-colors', format === option.id ? 'border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)]' : 'border-[var(--border-color)] bg-[var(--bg-primary)] hover:bg-[var(--grid-hover)]')}>
                  <Icon size={18} className="mb-3 text-[var(--accent)]" />
                  <div className="text-sm font-semibold text-[var(--text-main)]">{option.title}</div>
                  <div className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">{option.description}</div>
                </button>
              );
            })}
          </div>

          {format === 'csv' && (
            <div className="grid gap-4 lg:grid-cols-[1.2fr_0.9fr]">
              <div className="border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Columns to include</div>
                  <div className="text-[11px] text-[var(--text-muted)]">{selectedColumns.length} selected</div>
                </div>
                <div className="custom-scrollbar grid max-h-[320px] grid-cols-2 gap-1 overflow-y-auto border border-[var(--border-color)] p-2">
                  {columns.map((column) => (
                    <label key={column.column_name} className="flex items-center gap-2 px-2 py-1.5 text-xs text-[var(--text-main)] hover:bg-[var(--bg-secondary)]">
                      <input type="checkbox" checked={selectedColumns.includes(column.column_name)} onChange={() => setSelectedColumns((current) => current.includes(column.column_name) ? current.filter((value) => value !== column.column_name) : [...current, column.column_name])} />
                      <span className="truncate" title={formatColumnOptionLabel(column.column_name, columns)}>{getColumnDisplayName(column)}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-3 border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
                <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">CSV Options</div>
                <label className="flex items-start gap-3 text-sm text-[var(--text-main)]"><input type="checkbox" checked={includeFilteredRows} onChange={(e) => setIncludeFilteredRows(e.target.checked)} className="mt-0.5" /><span>Export only filtered rows<span className="mt-1 block text-[11px] text-[var(--text-muted)]">{includeFilteredRows ? `${rowCount.toLocaleString()} rows will be exported.` : `${totalRowCount.toLocaleString()} rows will be exported.`}</span></span></label>
                <label className="flex items-start gap-3 text-sm text-[var(--text-main)]"><input type="checkbox" checked={includeNotesColumn} onChange={(e) => setIncludeNotesColumn(e.target.checked)} className="mt-0.5" /><span>Add video notes column</span></label>
                <label className="flex items-start gap-3 text-sm text-[var(--text-main)]"><input type="checkbox" checked={includeUserTagsColumn} onChange={(e) => setIncludeUserTagsColumn(e.target.checked)} className="mt-0.5" /><span>Add user tags column<span className="mt-1 block text-[11px] text-[var(--text-muted)]">{hasUserTags ? 'Saved tags will be included.' : 'No saved tags yet.'}</span></span></label>
              </div>
            </div>
          )}

          {format === 'markdown' && (
            <div className="space-y-4 border border-[var(--border-color)] bg-[var(--bg-primary)] p-5">
              <div>
                <div className="text-sm font-semibold text-[var(--text-main)]">Research Log markdown</div>
                <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-muted)]">
                  This download contains a human-readable Research Log document. {hasProjectNotes ? 'Your current diary text will be included.' : 'The file will still be created even if the diary is currently empty.'}
                </p>
              </div>
              <div className="space-y-2 border-t border-[var(--border-color)] pt-4">
                <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Markdown options</div>
                <label className="flex items-start gap-3 text-sm text-[var(--text-main)]">
                  <input
                    type="checkbox"
                    checked={markdownOptions.includeNotesAppendix}
                    onChange={(event) => onMarkdownOptionsChange({ ...markdownOptions, includeNotesAppendix: event.target.checked })}
                    className="mt-0.5"
                  />
                  <span>Include Notes Appendix</span>
                </label>
                <label className="flex items-start gap-3 text-sm text-[var(--text-main)]">
                  <input
                    type="checkbox"
                    checked={markdownOptions.includeDashboardSection}
                    onChange={(event) => onMarkdownOptionsChange({ ...markdownOptions, includeDashboardSection: event.target.checked })}
                    className="mt-0.5"
                  />
                  <span>Include Dashboard section</span>
                </label>
              </div>
              {dashboardSnapshotsStale && (
                <div className="border border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_8%,transparent)] p-3">
                  <div className="text-xs font-semibold text-[var(--text-main)]">Dashboard snapshots are stale</div>
                  <p className="mt-1 text-[11px] text-[var(--text-muted)]">Refresh snapshots before export if you want up-to-date dashboard summaries in markdown.</p>
                  <button type="button" onClick={onRecalculateSnapshots} className="mt-3 border border-[var(--accent)] px-3 py-1 text-xs font-medium text-[var(--text-main)] hover:bg-[var(--grid-hover)]">
                    Recalculate snapshots
                  </button>
                </div>
              )}
            </div>
          )}

          {format === 'project' && (
            <div className="space-y-4 border border-[var(--border-color)] bg-[var(--bg-primary)] p-5">
              <div className="space-y-3">
                <div className="text-sm font-semibold text-[var(--text-main)]">Full project backup</div>
                <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">This backup will include the full project dataset, deleted-column history, annotations, saved views, and the Research Log data in a restore-ready zip.</p>
              </div>
              <div className="space-y-2 border-t border-[var(--border-color)] pt-4">
                <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Project name</label>
                <input type="text" value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="Project backup name" className="w-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none" />
                <p className="text-[11px] text-[var(--text-muted)]">This name will be used for the zip file and the folder inside the backup.</p>
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-3 border-t border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
          <button onClick={onClose} className="flex-1 border border-[var(--border-color)] px-4 py-2 text-sm font-medium text-[var(--text-main)] transition-colors hover:bg-[var(--bg-secondary)]">Cancel</button>
          <button
            onClick={() => onExport({
              format,
              selectedColumns,
              includeFilteredRows,
              includeNotesColumn,
              includeUserTagsColumn,
              markdownOptions,
              projectName,
            })}
            disabled={format === 'csv' && selectedColumns.length === 0}
            className="flex-1 bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {format === 'csv' ? 'Download CSV' : format === 'markdown' ? 'Download Markdown' : 'Download Project Backup'}
          </button>
        </div>
      </div>
    </div>
  );
}

type EditViewFilterKind = GenericFilterKind | 'tag' | 'booleanMap';

interface EditViewFilterItem {
  column: string;
  summary: string;
  kind: EditViewFilterKind;
  model: ExplorerColumnFilterModel;
}

interface EditViewFilterColumn {
  column: string;
  kind: EditViewFilterKind;
}

type EditViewFilterDraft = {
  operator: string;
  value: string;
  valuesInput: string;
  matchMode: 'any' | 'all' | 'only';
  booleanSelections: Record<string, 'true' | 'false'>;
};

const TEXT_FILTER_OPERATORS: Array<{ value: GenericTextOperator; label: string }> = [
  { value: 'contains', label: 'contains' },
  { value: 'equals', label: 'equals' },
  { value: 'startsWith', label: 'starts with' },
  { value: 'endsWith', label: 'ends with' },
];

const NUMERIC_FILTER_OPERATORS: Array<{ value: GenericNumericOperator; label: string }> = [
  { value: 'eq', label: '=' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '≥' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
  { value: 'between', label: 'between' },
];

function buildEditViewFilterDraft(kind: EditViewFilterKind, model?: ExplorerColumnFilterModel | null): EditViewFilterDraft {
  if (kind === 'tag' && model && Array.isArray((model as any).values)) {
    return {
      operator: 'contains',
      value: '',
      valuesInput: ((model as any).values || []).join(', '),
      matchMode: (model as any).matchMode === 'all' ? 'all' : ((model as any).matchMode === 'only' ? 'only' : 'any'),
      booleanSelections: {},
    };
  }

  if (kind === 'booleanMap') {
    return {
      operator: 'contains',
      value: '',
      valuesInput: '',
      matchMode: 'any',
      booleanSelections: ((model as any)?.selections && typeof (model as any).selections === 'object') ? { ...((model as any).selections) } : {},
    };
  }

  return {
    operator: typeof (model as any)?.operator === 'string' ? String((model as any).operator) : kind === 'text' ? 'contains' : 'eq',
    value: (model as any)?.value == null ? '' : String((model as any).value),
    valuesInput: '',
    matchMode: 'any',
    booleanSelections: {},
  };
}

function buildEditViewFilterModel(kind: EditViewFilterKind, draft: EditViewFilterDraft): ExplorerColumnFilterModel {
  if (kind === 'tag') {
    const values = draft.valuesInput
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (!values.length) return null;
    return { values, matchMode: draft.matchMode };
  }

  if (kind === 'booleanMap') {
    const selections = Object.fromEntries(Object.entries(draft.booleanSelections || {}).filter(([, value]) => value === 'true' || value === 'false')) as Record<string, 'true' | 'false'>;
    if (!Object.keys(selections).length) return null;
    return { selections };
  }

  const value = draft.value.trim();
  if (!value) return null;
  return {
    filterKind: kind,
    operator: draft.operator as GenericTextOperator | GenericNumericOperator,
    value,
  };
}

interface ColumnVisibilityProps {
  isOpen: boolean;
  onClose: () => void;
  columns: string[];
  schema?: ColumnSchema[];
  visibleColumns: string[];
  deletedColumns: string[];
  onToggle: (column: string) => void;
  onSetAll: (visible: boolean) => void;
  onDeleteColumn: (column: string) => void;
  onRestoreColumn: (column: string) => void;
  onRestoreAll: () => void;
  mappedColumns?: string[];
  filteredColumns?: string[];
  currentScope?: 'videos' | 'channels';
  activeFilters?: EditViewFilterItem[];
  filterColumns?: EditViewFilterColumn[];
  filterModel?: ExplorerFilterModel;
  onRemoveFilter?: (column: string) => void;
  onClearFilters?: () => void;
  onUpdateFilter?: (column: string, model: ExplorerColumnFilterModel) => void;
  booleanMapSchemas?: Record<string, BooleanMapSchema>;
  onReorderVisibleColumns?: (nextOrder: string[]) => void;
  onResetColumnOrder?: () => void;
  onShowAllColumns?: () => void;
  onHideOptionalColumns?: () => void;
  sourceItems?: Array<{
    id: string;
    label: string;
    kind: SourceKind;
    rowCount: number;
    visibleRowCount: number;
    missing?: boolean;
    rowHidden: boolean;
    columnHidden: boolean;
    canDelete?: boolean;
    deleteTitle?: string;
  }>;
  onToggleSourceRows?: (sourceId: string) => void;
  onToggleSourceColumns?: (sourceId: string) => void;
  onDeleteSource?: (sourceId: string) => void;
  onShowAllSources?: () => void;
  onHideAllEnrichmentSources?: () => void;
  columnSourceByColumn?: Record<string, string>;
  sourceLabelById?: Record<string, string>;
  specialMappings?: Partial<Pick<SpecialMappings, 'transcriptColumn' | 'descriptionColumn' | 'tagColumn'>>;
  onUpdateSpecialMapping?: (field: SpecialFieldKey, column?: string) => void;
}

export function ColumnVisibilitySelector({
  isOpen,
  onClose,
  columns,
  schema = [],
  visibleColumns,
  deletedColumns,
  onToggle,
  onSetAll,
  onDeleteColumn,
  onRestoreColumn,
  onRestoreAll,
  mappedColumns = [],
  filteredColumns = [],
  currentScope = 'videos',
  activeFilters = [],
  filterColumns = [],
  filterModel = {},
  onRemoveFilter,
  onClearFilters,
  onUpdateFilter,
  booleanMapSchemas = {},
  onReorderVisibleColumns,
  onResetColumnOrder,
  onShowAllColumns,
  onHideOptionalColumns,
  sourceItems = [],
  onToggleSourceRows,
  onToggleSourceColumns,
  onDeleteSource,
  onShowAllSources,
  onHideAllEnrichmentSources,
  columnSourceByColumn = {},
  sourceLabelById = {},
  specialMappings = {},
  onUpdateSpecialMapping,
}: ColumnVisibilityProps) {
  const [search, setSearch] = useState('');
  const [draggedChip, setDraggedChip] = useState<string | null>(null);
  const [filterDrafts, setFilterDrafts] = useState<Record<string, EditViewFilterDraft>>({});
  const [pendingFilterColumns, setPendingFilterColumns] = useState<string[]>([]);
  const [newFilterColumn, setNewFilterColumn] = useState('');

  const displayNameMap = useMemo(() => buildColumnDisplayNameMap(schema), [schema]);
  const matchesSearch = (column: string) => {
    const needle = search.toLowerCase();
    if (!needle) return true;
    const display = (displayNameMap[column] || column).toLowerCase();
    return column.toLowerCase().includes(needle) || display.includes(needle);
  };
  const filteredColumnsList = columns.filter((column) => matchesSearch(column));
  const deletedColumnsList = deletedColumns.filter((column) => matchesSearch(column));
  const filterColumnMap = useMemo(() => new Map(filterColumns.map((entry) => [entry.column, entry.kind])), [filterColumns]);
  const specialRemapColumns = useMemo(
    () => uniqueOrdered(schema.map((column) => column.column_name)),
    [schema],
  );

  useEffect(() => {
    if (!isOpen) return;
    setFilterDrafts(Object.fromEntries(
      Object.entries(filterModel || {}).map(([column, model]) => [column, buildEditViewFilterDraft(filterColumnMap.get(column) || 'text', model)]),
    ));
    setPendingFilterColumns([]);
    setNewFilterColumn((current) => current || filterColumns[0]?.column || '');
  }, [filterColumnMap, filterColumns, filterModel, isOpen]);

  const handleVisibleChipDrop = (targetColumn: string) => {
    if (!draggedChip || draggedChip === targetColumn || !onReorderVisibleColumns) return;
    const next = [...visibleColumns];
    const draggedIndex = next.indexOf(draggedChip);
    const targetIndex = next.indexOf(targetColumn);
    if (draggedIndex === -1 || targetIndex === -1) return;
    next.splice(draggedIndex, 1);
    next.splice(targetIndex, 0, draggedChip);
    onReorderVisibleColumns(next);
  };

  const updateDraft = (column: string, nextDraft: EditViewFilterDraft) => {
    setFilterDrafts((current) => ({ ...current, [column]: nextDraft }));
  };

  const commitDraft = (column: string, nextDraft?: EditViewFilterDraft) => {
    const kind = filterColumnMap.get(column);
    if (!kind || !onUpdateFilter) return;
    const draft = nextDraft || filterDrafts[column] || buildEditViewFilterDraft(kind, filterModel[column]);
    onUpdateFilter(column, buildEditViewFilterModel(kind, draft));
  };

  const ensureFilterDraft = (column: string) => {
    const kind = filterColumnMap.get(column);
    if (!kind) return;
    const nextDraft = filterDrafts[column] || buildEditViewFilterDraft(kind, filterModel[column]);
    updateDraft(column, nextDraft);
    setPendingFilterColumns((current) => current.includes(column) || filterModel[column] ? current : [...current, column]);
  };

  const editorFilters = useMemo(() => {
    const activeByColumn = new Map(activeFilters.map((filter) => [filter.column, filter]));
    return Array.from(new Set([...activeFilters.map((filter) => filter.column), ...pendingFilterColumns]))
      .map((column) => activeByColumn.get(column) || {
        column,
        summary: 'Set filter value',
        kind: filterColumnMap.get(column) || 'text',
        model: null as ExplorerColumnFilterModel,
      });
  }, [activeFilters, filterColumnMap, pendingFilterColumns]);

  const renderFilterEditor = (filter: EditViewFilterItem) => {
    const kind = filterColumnMap.get(filter.column) || filter.kind;
    const draft = filterDrafts[filter.column] || buildEditViewFilterDraft(kind, filter.model);
    const isTag = kind === 'tag';
    const operatorOptions = kind === 'text' ? TEXT_FILTER_OPERATORS : NUMERIC_FILTER_OPERATORS;
    const inputPlaceholder = kind === 'duration'
      ? (draft.operator === 'between' ? '60..300' : 'e.g. 600 or 10:00')
      : draft.operator === 'between'
        ? 'min..max'
        : 'Filter value';

    return (
      <div key={filter.column} className="space-y-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-[var(--text-main)]" title={formatColumnOptionLabel(filter.column, schema)}>{displayNameMap[filter.column] || filter.column}</div>
            <div className="mt-1 text-[11px] text-[var(--text-muted)]">{filter.summary}</div>
          </div>
          <button
            type="button"
            onClick={() => {
              setPendingFilterColumns((current) => current.filter((column) => column !== filter.column));
              onRemoveFilter?.(filter.column);
            }}
            className="rounded border border-[var(--border-color)] p-1 text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
            title={`Remove filter from ${displayNameMap[filter.column] || filter.column}`}
          >
            <X size={14} />
          </button>
        </div>

        {isTag ? (
          <div className="grid gap-2 md:grid-cols-[120px_minmax(0,1fr)]">
            <select
              value={draft.matchMode}
              onChange={(event) => {
                const nextMatchMode: EditViewFilterDraft['matchMode'] = event.target.value === 'all'
                  ? 'all'
                  : event.target.value === 'only'
                    ? 'only'
                    : 'any';
                const nextDraft: EditViewFilterDraft = { ...draft, matchMode: nextMatchMode };
                updateDraft(filter.column, nextDraft);
                commitDraft(filter.column, nextDraft);
              }}
              className="border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-2 text-sm text-[var(--text-main)] focus:outline-none"
            >
              <option value="any">match any</option>
              <option value="all">match all</option>
              <option value="only">match only</option>
            </select>
            <input
              value={draft.valuesInput}
              onChange={(event) => updateDraft(filter.column, { ...draft, valuesInput: event.target.value })}
              onBlur={() => commitDraft(filter.column)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitDraft(filter.column); } }}
              placeholder="tag 1, tag 2, tag 3"
              className="w-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none"
            />
          </div>
        ) : kind === 'booleanMap' ? (
          <div className="space-y-2">
            <div className="text-[11px] text-[var(--text-muted)]">Quick yes chips on the column filter, detailed Yes / No controls here.</div>
            <div className="grid gap-2">
              {(booleanMapSchemas[filter.column]?.keys || []).map((key) => {
                const label = booleanMapSchemas[filter.column]?.labels?.[key] || key;
                const value = draft.booleanSelections[key] || 'any';
                const applyState = (nextState: 'any' | 'true' | 'false') => {
                  const nextSelections = { ...draft.booleanSelections };
                  if (nextState === 'any') delete nextSelections[key];
                  else nextSelections[key] = nextState;
                  const nextDraft = { ...draft, booleanSelections: nextSelections };
                  updateDraft(filter.column, nextDraft);
                  commitDraft(filter.column, nextDraft);
                };
                return (
                  <div key={key} className="flex flex-col gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 md:flex-row md:items-center md:justify-between">
                    <div className="text-sm text-[var(--text-main)]">{label}</div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => applyState('any')} className={`rounded-full border px-3 py-1 text-[11px] font-medium ${value === 'any' ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-muted)]'}`}>Any</button>
                      <button type="button" onClick={() => applyState('true')} className={`rounded-full border px-3 py-1 text-[11px] font-medium ${value === 'true' ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-muted)]'}`}>Yes</button>
                      <button type="button" onClick={() => applyState('false')} className={`rounded-full border px-3 py-1 text-[11px] font-medium ${value === 'false' ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-muted)]'}`}>No</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="grid gap-2 md:grid-cols-[140px_minmax(0,1fr)]">
            <select
              value={draft.operator}
              onChange={(event) => {
                const nextDraft = { ...draft, operator: event.target.value };
                updateDraft(filter.column, nextDraft);
                commitDraft(filter.column, nextDraft);
              }}
              className="border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-2 text-sm text-[var(--text-main)] focus:outline-none"
            >
              {operatorOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <input
              value={draft.value}
              onChange={(event) => updateDraft(filter.column, { ...draft, value: event.target.value })}
              onBlur={() => commitDraft(filter.column)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitDraft(filter.column); } }}
              placeholder={inputPlaceholder}
              className="w-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none"
            />
          </div>
        )}
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="dialog-shell flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
          <div className="flex flex-col gap-1">
            <h3 className="flex items-center gap-2 font-bold text-[var(--text-main)]"><Settings2 size={18} className="text-[var(--accent)]" /> Edit view</h3>
            <div className="flex flex-wrap gap-2 text-[10px] text-[var(--text-muted)]">
              <button type="button" onClick={onShowAllColumns || (() => onSetAll(true))} className="text-[var(--accent)] hover:underline">Show all columns</button>
              <span>|</span>
              <button type="button" onClick={() => onSetAll(false)} className="text-[var(--accent)] hover:underline">Hide all columns</button>
              {onResetColumnOrder ? (<><span>|</span><button type="button" onClick={onResetColumnOrder} className="text-[var(--accent)] hover:underline">Reset order</button></>) : null}
              {onHideOptionalColumns ? (<><span>|</span><button type="button" onClick={onHideOptionalColumns} className="text-[var(--accent)] hover:underline">Hide optional columns</button></>) : null}
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-main)]"><X size={20} /></button>
        </div>
        <div className="border-b border-[var(--border-color)] p-4">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search columns, deleted fields, or active filters..." className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none" />
        </div>
        <div className="custom-scrollbar flex-1 space-y-4 overflow-y-auto p-4">
          <SmartSection title="Current view" subtitle="Drag chips to reorder the visible explorer columns. Wider layout makes it easier to review the live row order." defaultOpen>
            <>
              <div className="mb-2 text-[11px] text-[var(--text-muted)]">Drag chips to reorder the current visible columns. Use × to hide a column from the grid.</div>
              <div className="flex min-h-16 flex-wrap gap-2 rounded-xl border border-dashed border-[var(--border-color)] bg-[var(--bg-secondary)] p-3">
                {visibleColumns.map((column) => (
                  <div
                    key={column}
                    draggable
                    onDragStart={() => setDraggedChip(column)}
                    onDragEnd={() => setDraggedChip(null)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => handleVisibleChipDrop(column)}
                    className={cn('flex items-center gap-2 rounded-full border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-main)] shadow-sm', draggedChip === column && 'opacity-60')}
                  >
                    <TableProperties size={12} className="text-[var(--text-muted)]" />
                    <span title={formatColumnOptionLabel(column, schema)}>{displayNameMap[column] || column}</span>
                    <button type="button" onClick={() => onToggle(column)} className="text-[var(--text-muted)] hover:text-[var(--text-main)]" title={`Hide ${displayNameMap[column] || column}`}>
                      <X size={12} />
                    </button>
                  </div>
                ))}
                {visibleColumns.length === 0 ? <span className="px-2 py-2 text-xs text-[var(--text-muted)]">No visible columns yet.</span> : null}
              </div>
            </>
          </SmartSection>

          {currentScope === 'videos' ? (
            <SmartSection
              title="Special field remapping"
              subtitle="Remap transcript, video description, and imported tags from source columns."
              defaultOpen
            >
              <div className="grid gap-2 md:grid-cols-3">
                {SPECIAL_FIELD_CONFIG.map((field) => (
                  <label key={field.key} className="flex min-w-0 items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-2">
                    <span className="w-[86px] shrink-0 truncate text-[11px] font-medium text-[var(--text-main)]" title={field.help}>{field.label}</span>
                    <select
                      value={specialMappings[field.key] || '__unmapped__'}
                      onChange={(event) => onUpdateSpecialMapping?.(field.key, event.target.value === '__unmapped__' ? undefined : event.target.value)}
                      className="min-w-0 flex-1 border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1.5 text-[11px] text-[var(--text-main)] focus:outline-none"
                      title={field.help}
                      disabled={!onUpdateSpecialMapping}
                    >
                      <option value="__unmapped__">Unmapped</option>
                      {specialRemapColumns.map((column) => (
                        <option key={`${field.key}-${column}`} value={column}>{formatColumnOptionLabel(column, schema)}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </SmartSection>
          ) : null}

          <SmartSection title="Columns in this project" subtitle="Compact three-column view with visibility toggles, badges, and delete actions.">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filteredColumnsList.map((column) => (
                <div key={column} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 shadow-sm">
                  <div className="flex items-start gap-3">
                    <button type="button" onClick={() => onToggle(column)} className={cn('relative mt-0.5 h-5 w-9 rounded-full transition-colors', visibleColumns.includes(column) ? 'bg-[var(--accent)]' : 'bg-[var(--border-color)]')}>
                      <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all', visibleColumns.includes(column) ? 'left-[18px]' : 'left-0.5')} />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-[var(--text-main)]" title={formatColumnOptionLabel(column, schema)}>{displayNameMap[column] || column}</div>
                      {(displayNameMap[column] && displayNameMap[column] !== column) ? <div className="mt-1 truncate text-[11px] text-[var(--text-muted)]">raw: {column}</div> : null}
                      <div className="mt-2 flex flex-wrap gap-1">
                        {columnSourceByColumn[column] ? (
                          <span className="rounded-full border border-[var(--border-color)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
                            src: {sourceLabelById[columnSourceByColumn[column]] || columnSourceByColumn[column]}
                          </span>
                        ) : null}
                        {mappedColumns.includes(column) && <span className="rounded-full border border-[var(--border-color)] px-2 py-0.5 text-[10px] text-[var(--accent)]">mapped</span>}
                        {filteredColumns.includes(column) && <span className="rounded-full border border-[var(--border-color)] px-2 py-0.5 text-[10px] text-[var(--accent)]">filtered</span>}
                        {visibleColumns.includes(column) && <span className="rounded-full border border-[var(--border-color)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">visible</span>}
                      </div>
                    </div>
                    {currentScope === 'videos' ? (
                      <button type="button" onClick={() => onDeleteColumn(column)} className="rounded border border-[var(--border-color)] p-1 text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]" title={`Delete ${displayNameMap[column] || column} from this project`}>
                        <Trash2 size={15} />
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </SmartSection>

          <SmartSection
            title="Source datasets"
            subtitle="Show or hide row universe by base source and control source-contributed column visibility."
            defaultOpen
            count={sourceItems.length}
          >
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-[11px]">
                <button
                  type="button"
                  onClick={onShowAllSources}
                  className="text-[var(--accent)] hover:underline"
                  disabled={!onShowAllSources}
                >
                  Show all sources
                </button>
                <span className="text-[var(--text-muted)]">|</span>
                <button
                  type="button"
                  onClick={onHideAllEnrichmentSources}
                  className="text-[var(--accent)] hover:underline"
                  disabled={!onHideAllEnrichmentSources}
                >
                  Hide enrichment rows
                </button>
              </div>
              {sourceItems.length === 0 ? (
                <p className="text-[11px] text-[var(--text-muted)]">No sources registered yet.</p>
              ) : (
                <div className="grid gap-2">
                  {sourceItems.map((source) => (
                    <div key={source.id} className="grid gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 md:grid-cols-[minmax(0,1fr)_auto_auto_auto] md:items-center">
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium text-[var(--text-main)]">{source.label}</div>
                        <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-[var(--text-muted)]">
                          <span className="rounded-full border border-[var(--border-color)] px-2 py-0.5">{source.kind}</span>
                          <span>{source.visibleRowCount.toLocaleString()} visible / {source.rowCount.toLocaleString()} rows</span>
                          {source.missing ? <span className="text-[var(--accent)]">missing</span> : null}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onToggleSourceRows?.(source.id)}
                        className={cn(
                          'rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                          source.rowHidden
                            ? 'border-[var(--border-color)] text-[var(--text-muted)] hover:bg-[var(--grid-hover)]'
                            : 'border-[var(--accent)] text-[var(--text-main)]',
                        )}
                        title={source.rowHidden ? 'Show source rows' : 'Hide source rows'}
                        disabled={!onToggleSourceRows}
                      >
                        {source.rowHidden ? 'Rows hidden' : 'Rows visible'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onToggleSourceColumns?.(source.id)}
                        className={cn(
                          'rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                          source.columnHidden
                            ? 'border-[var(--border-color)] text-[var(--text-muted)] hover:bg-[var(--grid-hover)]'
                            : 'border-[var(--accent)] text-[var(--text-main)]',
                        )}
                        title={source.columnHidden ? 'Show source columns' : 'Hide source columns'}
                        disabled={!onToggleSourceColumns}
                      >
                        {source.columnHidden ? 'Cols hidden' : 'Cols visible'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteSource?.(source.id)}
                        className={cn(
                          'rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                          source.canDelete
                            ? 'border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--grid-hover)]'
                            : 'border-[var(--border-color)] text-[var(--text-muted)] opacity-60',
                        )}
                        title={source.deleteTitle || (source.canDelete ? 'Delete source from project' : 'This source cannot be deleted here')}
                        disabled={!onDeleteSource || !source.canDelete}
                      >
                        Delete source
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </SmartSection>

          <SmartSection title="Filters" subtitle="Review, edit, add, and clear explorer filters from one place." defaultOpen count={activeFilters.length}>
            <div className="space-y-3">
              <div className="grid gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
                <select
                  value={newFilterColumn}
                  onChange={(event) => setNewFilterColumn(event.target.value)}
                  className="border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none"
                >
                  {filterColumns.map((entry) => (
                    <option key={entry.column} value={entry.column}>{formatColumnOptionLabel(entry.column, schema)}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => ensureFilterDraft(newFilterColumn)}
                  disabled={!newFilterColumn || !onUpdateFilter}
                  className="rounded-lg border border-[var(--border-color)] px-3 py-2 text-sm font-medium text-[var(--text-main)] transition-colors hover:bg-[var(--grid-hover)] disabled:opacity-50"
                >
                  Add / edit filter
                </button>
                {onClearFilters ? (
                  <button type="button" onClick={onClearFilters} className="rounded-lg border border-[var(--border-color)] px-3 py-2 text-sm font-medium text-[var(--accent)] transition-colors hover:bg-[var(--grid-hover)]">
                    Clear all filters
                  </button>
                ) : null}
              </div>

              {editorFilters.length === 0 ? (
                <p className="text-[11px] text-[var(--text-muted)]">No active filters.</p>
              ) : (
                <div className="grid gap-3 xl:grid-cols-2">
                  {editorFilters.map((filter) => renderFilterEditor(filter))}
                </div>
              )}
            </div>
          </SmartSection>

          {currentScope === 'videos' ? (
            <SmartSection title="Deleted Columns" subtitle="Deleted columns can be restored from the original imported data." defaultOpen={deletedColumns.length > 0} count={deletedColumns.length}>
              <div className="space-y-2">
                {deletedColumnsList.length === 0 ? (
                  <p className="text-[11px] text-[var(--text-muted)]">No columns have been deleted from this project.</p>
                ) : (
                  <>
                    <div className="flex justify-end">
                      <button type="button" onClick={onRestoreAll} className="text-[11px] text-[var(--accent)] hover:underline">Restore all</button>
                    </div>
                    {deletedColumnsList.map((column) => (
                      <div key={column} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2">
                        <div className="truncate text-[13px] text-[var(--text-main)]" title={formatColumnOptionLabel(column, schema)}>{displayNameMap[column] || column}</div>
                        <button type="button" onClick={() => onRestoreColumn(column)} className="inline-flex items-center gap-1 text-[11px] text-[var(--accent)] hover:underline">
                          <Undo2 size={12} /> Restore
                        </button>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </SmartSection>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type ResearchLogGeneratedSectionId = Exclude<ResearchLogSectionId, 'overview' | 'diary' | 'exportPreview'>;

type ResearchLogSnapshotIndexItem = {
  id: string;
  label: string;
  summary: string;
  stale: boolean;
  calculatedAt?: string;
  rowCount: number;
};

interface ResearchLogDialogProps {
  isOpen: boolean;
  onClose: () => void;
  overview: string;
  onUpdateOverview: (value: string) => void;
  diary: string;
  onUpdateDiary: (value: string) => void;
  generatedSections: Record<ResearchLogGeneratedSectionId, string>;
  sectionComments: Partial<Record<ResearchLogCommentSectionId, string>>;
  onUpdateSectionComment: (sectionId: ResearchLogCommentSectionId, value: string) => void;
  markdownPreview: string;
  markdownOptions: ResearchLogMarkdownOptions;
  onMarkdownOptionsChange: (next: ResearchLogMarkdownOptions) => void;
  dashboardSnapshotsStale: boolean;
  onRecalculateSnapshots: () => void;
  onOpenDatasetDashboard: () => void;
  onOpenKeyboardHelp: () => void;
  onInsertDiaryDate: () => void;
  dashboardSnapshotIndex: ResearchLogSnapshotIndexItem[];
  currentProjectName: string;
  onRenameProject: (value: string) => void;
}

const RESEARCH_LOG_SECTIONS: Array<{ id: ResearchLogSectionId; label: string; generated: boolean }> = [
  { id: 'overview', label: 'Overview', generated: false },
  { id: 'diary', label: 'Diary', generated: false },
  { id: 'corpusProcessing', label: 'Corpus & Processing', generated: true },
  { id: 'views', label: 'Saved Views', generated: true },
  { id: 'watchHistory', label: 'Watch History', generated: true },
  { id: 'researchActions', label: 'Research Actions', generated: true },
  { id: 'notesAppendix', label: 'Notes Appendix', generated: true },
  { id: 'dashboard', label: 'Dashboard', generated: true },
  { id: 'exportPreview', label: 'Export Preview', generated: true },
];

const KEYBOARD_SHORTCUTS: Array<{ keys: string; action: string; }> = [
  { keys: 'Alt/Option + Shift + T', action: 'thumbnails dashboard' },
  { keys: 'Alt/Option + Shift + A', action: 'attention dashboard' },
  { keys: 'Alt/Option + Shift + C', action: 'content dashboard' },
  { keys: 'Alt/Option + Shift + O', action: 'overview dashboard' },
  { keys: 'Alt/Option + Shift + V', action: 'toggle column visibility / edit view' },
  { keys: 'Alt/Option + Shift + E', action: 'export' },
  { keys: 'Alt/Option + Shift + I', action: 'import' },
  { keys: 'Alt/Option + Shift + K', action: 'keyboard shortcuts help' },
  { keys: 'Ctrl/Cmd + K', action: 'command palette' },
  { keys: 'Ctrl/Cmd + S', action: 'Save view' },
  { keys: 'Ctrl/Cmd + Z', action: 'undo' },
  { keys: 'Ctrl/Cmd + Shift + Z', action: 'redo' },
  { keys: 'Shift + T (player)', action: 'add timestamp annotation' },
];

export interface CommandPaletteItem {
  id: string;
  label: string;
  description?: string;
  keywords?: string[];
  shortcut?: string;
  disabled?: boolean;
  onSelect: () => void;
}

function renderGeneratedSectionBody(value: string) {
  const text = value.trim() || 'No entries recorded';
  return (
    <pre className="custom-scrollbar whitespace-pre-wrap break-words border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 font-mono text-[12px] leading-6 text-[var(--text-main)]">
      {text}
    </pre>
  );
}

function GeneratedSectionComment({
  sectionId,
  value,
  onChange,
}: {
  sectionId: ResearchLogCommentSectionId;
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-[var(--border-color)] bg-[var(--bg-primary)]">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="w-full border-b border-[var(--border-color)] px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-main)] hover:bg-[var(--grid-hover)]"
      >
        {open ? 'Hide' : 'Add'} researcher comment
      </button>
      {open && (
        <div className="p-3">
          <textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={`Optional researcher comment for ${sectionId}`}
            className="custom-scrollbar h-28 w-full resize-none border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none"
          />
        </div>
      )}
    </div>
  );
}


export function CommandPaletteDialog({
  isOpen,
  onClose,
  onRunCommand,
  commands,
}: {
  isOpen: boolean;
  onClose: () => void;
  onRunCommand: () => void;
  commands: CommandPaletteItem[];
}) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setSelectedIndex(0);
      return;
    }
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen]);

  const filteredCommands = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const available = commands.filter((command) => !command.disabled);
    if (!normalized) return available;
    return available.filter((command) => {
      const haystack = [command.label, command.description || '', command.shortcut || '', ...(command.keywords || [])]
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalized);
    });
  }, [commands, query]);

  useEffect(() => {
    setSelectedIndex((current) => {
      if (filteredCommands.length === 0) return 0;
      return Math.min(current, filteredCommands.length - 1);
    });
  }, [filteredCommands]);

  if (!isOpen) return null;

  const runCommand = (command?: CommandPaletteItem) => {
    if (!command) return;
    command.onSelect();
    onRunCommand();
    setQuery('');
    setSelectedIndex(0);
  };

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        className="dialog-shell w-full max-w-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="border-b border-[var(--border-color)] px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-bold text-[var(--text-main)]">
            <Keyboard size={16} className="text-[var(--accent)]" />
            Quick actions
          </div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">Type an action, use ↑ ↓ to pick one, then press Enter.</p>
        </div>

        <div className="border-b border-[var(--border-color)] px-4 py-3">
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setSelectedIndex((current) => Math.min(current + 1, Math.max(filteredCommands.length - 1, 0)));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setSelectedIndex((current) => Math.max(current - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                runCommand(filteredCommands[selectedIndex] || filteredCommands[0]);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
              }
            }}
            placeholder="Type a command…"
            className="w-full border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            aria-label="Command palette"
          />
        </div>

        <div className="custom-scrollbar max-h-[min(56vh,28rem)] overflow-y-auto p-2">
          {filteredCommands.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-[var(--text-muted)]">No actions match “{query}”.</div>
          ) : (
            filteredCommands.map((command, index) => {
              const selected = index === selectedIndex;
              return (
                <button
                  key={command.id}
                  type="button"
                  onClick={() => runCommand(command)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={cn(
                    'flex w-full items-start justify-between gap-3 border px-3 py-3 text-left transition-colors',
                    selected
                      ? 'border-[color-mix(in_oklab,var(--accent)_35%,var(--border-color))] bg-[color-mix(in_oklab,var(--accent)_9%,var(--bg-primary))]'
                      : 'border-transparent hover:border-[var(--border-color)] hover:bg-[var(--grid-hover)]',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-[var(--text-main)]">{command.label}</span>
                    {command.description && <span className="mt-1 block text-xs leading-5 text-[var(--text-muted)]">{command.description}</span>}
                  </span>
                  {command.shortcut && (
                    <kbd className="shrink-0 border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1 font-mono text-[11px] text-[var(--text-muted)]">
                      {command.shortcut}
                    </kbd>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export function KeyboardShortcutsDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="dialog-shell w-full max-w-md border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--text-main)]"><Keyboard size={16} className="text-[var(--accent)]" /> Keyboard shortcuts</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-main)]"><X size={18} /></button>
        </div>
        <div className="space-y-2 p-4">
          {KEYBOARD_SHORTCUTS.map((shortcut) => (
            <div key={shortcut.keys} className="flex items-center justify-between gap-3 border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-xs">
              <span className="text-[var(--text-main)]">{shortcut.action}</span>
              <kbd className="border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1 font-mono text-[11px] text-[var(--text-muted)]">{shortcut.keys}</kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ResearchLogDialog({
  isOpen,
  onClose,
  overview,
  onUpdateOverview,
  diary,
  onUpdateDiary,
  generatedSections,
  sectionComments,
  onUpdateSectionComment,
  markdownPreview,
  markdownOptions,
  onMarkdownOptionsChange,
  dashboardSnapshotsStale,
  onRecalculateSnapshots,
  onOpenDatasetDashboard,
  onOpenKeyboardHelp,
  onInsertDiaryDate,
  dashboardSnapshotIndex,
  currentProjectName,
  onRenameProject,
}: ResearchLogDialogProps) {
  const [activeSection, setActiveSection] = useState<ResearchLogSectionId>('diary');
  const [projectNameDraft, setProjectNameDraft] = useState(currentProjectName || 'ytde_project');
  const diaryTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const handleInsertDiaryDateClick = () => {
    onInsertDiaryDate();
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const textarea = diaryTextareaRef.current;
        if (!textarea) return;
        const cursorPosition = textarea.value.length;
        textarea.focus();
        textarea.setSelectionRange(cursorPosition, cursorPosition);
        textarea.scrollTop = textarea.scrollHeight;
      });
    });
  };

  useEffect(() => {
    if (isOpen) setActiveSection('diary');
  }, [isOpen]);

  useEffect(() => {
    setProjectNameDraft(currentProjectName || 'ytde_project');
  }, [currentProjectName, isOpen]);

  if (!isOpen) return null;

  const showGeneratedComment = (sectionId: ResearchLogSectionId): sectionId is ResearchLogCommentSectionId =>
    sectionId !== 'overview' && sectionId !== 'diary';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="dialog-shell relative flex h-[88vh] w-full max-w-7xl flex-col overflow-hidden border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-4 py-3">
          <h3 className="flex items-center gap-2 font-bold text-[var(--text-main)]"><Book size={18} className="text-[var(--accent)]" /> Research Log</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-main)]"><X size={20} /></button>
        </div>

        <div className="flex min-h-0 flex-1">
          <aside className="custom-scrollbar w-64 flex-shrink-0 overflow-y-auto border-r border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Sections</div>
            <div className="space-y-1">
              {RESEARCH_LOG_SECTIONS.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveSection(section.id)}
                  className={cn(
                    'w-full border px-3 py-2 text-left text-xs transition-colors',
                    activeSection === section.id
                      ? 'border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)] text-[var(--text-main)]'
                      : 'border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:bg-[var(--grid-hover)] hover:text-[var(--text-main)]',
                  )}
                >
                  {section.label}
                </button>
              ))}
            </div>
          </aside>

          <section className="custom-scrollbar min-h-0 flex-1 overflow-y-auto bg-[var(--bg-secondary)] p-4">
            {activeSection === 'overview' && (
              <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_280px] md:items-end">
                  <div>
                    <div className="text-sm font-semibold text-[var(--text-main)]">Project Overview</div>
                    <div className="mt-1 text-[11px] text-[var(--text-muted)]">The project name is used across the app except where the UI is explicitly referring to the original source CSV.</div>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Project name</label>
                    <input
                      type="text"
                      value={projectNameDraft}
                      onChange={(event) => setProjectNameDraft(event.target.value)}
                      onBlur={() => onRenameProject(projectNameDraft.trim() || currentProjectName || 'ytde_project')}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          onRenameProject(projectNameDraft.trim() || currentProjectName || 'ytde_project');
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          setProjectNameDraft(currentProjectName || 'ytde_project');
                        }
                      }}
                      className="w-full border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none"
                    />
                  </div>
                </div>
                <textarea
                  value={overview}
                  onChange={(event) => onUpdateOverview(event.target.value)}
                  placeholder={'What is this project about?\nWhat corpus does it contain?\nWhat is the main research question?\nWhy was this material collected?\nWhat are key methodological choices or limitations?\nWhat does this log help document?'}
                  className="custom-scrollbar h-[66vh] w-full resize-none border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-3 font-mono text-[13px] leading-6 text-[var(--text-main)] focus:outline-none"
                />
              </div>
            )}

            {activeSection === 'diary' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-[var(--text-main)]">Research Diary</div>
                  <button
                    type="button"
                    onClick={() => {
                      onInsertDiaryDate();
                      window.requestAnimationFrame(() => {
                        const textarea = diaryTextareaRef.current;
                        if (!textarea) return;
                        textarea.focus();
                        const nextPosition = textarea.value.length;
                        textarea.setSelectionRange(nextPosition, nextPosition);
                      });
                    }}
                    className="inline-flex items-center gap-1 border border-[var(--border-color)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-main)]"
                    title="Insert today's date heading"
                  >
                    <CalendarPlus size={14} /> Add date
                  </button>
                </div>
                <textarea
                  ref={diaryTextareaRef}
                  value={diary}
                  onChange={(event) => onUpdateDiary(event.target.value)}
                  placeholder="Freeform observations, interpretations, anomalies, and decisions..."
                  className="custom-scrollbar h-[66vh] w-full resize-none border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-3 font-mono text-[13px] leading-6 text-[var(--text-main)] focus:outline-none"
                />
              </div>
            )}

            {activeSection === 'dashboard' && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={onRecalculateSnapshots} className={cn('border px-3 py-1.5 text-xs font-medium', dashboardSnapshotsStale ? 'border-[var(--accent)] text-[var(--text-main)]' : 'border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-main)]')}>
                    Recalculate snapshots
                  </button>
                  <button type="button" onClick={onOpenDatasetDashboard} className="border border-[var(--border-color)] px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)]">
                    Open Dataset Dashboard
                  </button>
                  {dashboardSnapshotsStale && <span className="text-xs font-medium text-[var(--accent)]">One or more snapshots are stale</span>}
                </div>

                <div className="space-y-2">
                  {dashboardSnapshotIndex.length === 0 ? (
                    <div className="border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-muted)]">No entries recorded</div>
                  ) : (
                    dashboardSnapshotIndex.map((item) => (
                      <div key={item.id} className="border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div className="font-semibold text-[var(--text-main)]">{item.label}</div>
                          <div className={cn('font-semibold', item.stale ? 'text-[var(--accent)]' : 'text-emerald-400')}>{item.stale ? 'Stale' : 'Fresh'}</div>
                        </div>
                        <div className="mt-1 text-[11px] text-[var(--text-muted)]">Rows: {item.rowCount.toLocaleString()} • Calculated: {item.calculatedAt ? formatDateDisplay(item.calculatedAt) : 'n/a'}</div>
                        <div className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-[var(--text-main)]">{item.summary || 'No entries recorded'}</div>
                      </div>
                    ))
                  )}
                </div>

                {renderGeneratedSectionBody(generatedSections.dashboard)}
                <GeneratedSectionComment sectionId="dashboard" value={sectionComments.dashboard || ''} onChange={(value) => onUpdateSectionComment('dashboard', value)} />
              </div>
            )}

            {activeSection === 'exportPreview' && (
              <div className="space-y-4">
                <div className="border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
                  <div className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Export preview options</div>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 text-xs text-[var(--text-main)]">
                      <input
                        type="checkbox"
                        checked={markdownOptions.includeNotesAppendix}
                        onChange={(event) => onMarkdownOptionsChange({ ...markdownOptions, includeNotesAppendix: event.target.checked })}
                      />
                      Include Notes Appendix
                    </label>
                    <label className="flex items-center gap-2 text-xs text-[var(--text-main)]">
                      <input
                        type="checkbox"
                        checked={markdownOptions.includeDashboardSection}
                        onChange={(event) => onMarkdownOptionsChange({ ...markdownOptions, includeDashboardSection: event.target.checked })}
                      />
                      Include Dashboard section
                    </label>
                  </div>
                </div>
                {dashboardSnapshotsStale && (
                  <div className="border border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_8%,transparent)] p-3 text-xs text-[var(--text-main)]">
                    Dashboard snapshots are stale for export. Recalculate snapshots before exporting if you need current dashboard values.
                    <div className="mt-2">
                      <button type="button" onClick={onRecalculateSnapshots} className="border border-[var(--accent)] px-3 py-1 text-xs font-medium hover:bg-[var(--grid-hover)]">
                        Recalculate snapshots
                      </button>
                    </div>
                  </div>
                )}
                <pre className="custom-scrollbar max-h-[58vh] overflow-auto whitespace-pre-wrap border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 font-mono text-[12px] leading-6 text-[var(--text-main)]">
                  {markdownPreview}
                </pre>
                <GeneratedSectionComment sectionId="exportPreview" value={sectionComments.exportPreview || ''} onChange={(value) => onUpdateSectionComment('exportPreview', value)} />
              </div>
            )}

            {activeSection !== 'overview' && activeSection !== 'diary' && activeSection !== 'dashboard' && activeSection !== 'exportPreview' && (
              <div className="space-y-4">
                {renderGeneratedSectionBody(generatedSections[activeSection])}
                {showGeneratedComment(activeSection) && (
                  <GeneratedSectionComment
                    sectionId={activeSection}
                    value={sectionComments[activeSection] || ''}
                    onChange={(value) => onUpdateSectionComment(activeSection, value)}
                  />
                )}
              </div>
            )}
          </section>
        </div>

        <button
          type="button"
          onClick={onOpenKeyboardHelp}
          className="absolute bottom-3 left-3 inline-flex h-8 w-8 items-center justify-center border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-muted)] transition-colors hover:bg-[var(--grid-hover)] hover:text-[var(--text-main)]"
          title="Keyboard shortcuts"
          aria-label="Open keyboard shortcuts help"
        >
          <Keyboard size={14} />
        </button>
      </div>
    </div>
  );
}

interface DatasetDashboardDialogProps {
  isOpen: boolean;
  onClose: () => void;
  scope: DashboardScope;
  onScopeChange: (scope: DashboardScope) => void;
  onRefresh: () => void;
  snapshot?: DatasetDashboardSnapshot;
  stale: boolean;
  activeTab: DashboardTemplateTab;
  onActiveTabChange: (tab: DashboardTemplateTab) => void;
  thumbnailCache?: DashboardThumbnailCacheSnapshot;
  thumbnailLoadProgress?: DashboardThumbnailLoadProgress | null;
  thumbnailTileSize: number;
  canZoomOut: boolean;
  canZoomIn: boolean;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onLoadFullThumbnails: () => void;
  onLoadFilteredThumbnails: () => void;
  onThumbnailEntryLoad: (scopeKey: DashboardThumbnailCacheSnapshot['scopeKey'], dedupeKey: string, loadedUrl?: string) => void;
  onThumbnailEntryError: (scopeKey: DashboardThumbnailCacheSnapshot['scopeKey'], dedupeKey: string, failedUrl?: string) => void;
  onRetryFailedThumbnails: () => void;
  onNavigateToVideo?: (videoId: string) => void;
  onNavigateToChannel?: (channel: { channelId?: string | null; channelName?: string }) => void;
  onApplyContentFilter?: (kind: 'category' | 'topic' | 'duration' | 'intent', label: string) => void;
  allChannelIds?: string[];
  linkingProps: {
    rows: any[];
    state: any;
    sourceItems: Array<{ id: string; label: string; visible: boolean }>;
    onGenerate: (sourceColumn: string) => void;
    onSelectSource: (sourceColumn: string) => void;
    onApplyOverride: (args: { domain: string; baseBucket?: string; note?: string; revert?: boolean }) => void;
    onSaveOverrideBatch: (assignments: Array<{ domain: string; baseBucket: string }>) => Promise<void> | void;
    onApplyDrilldown: (args: { filters: ExplorerFilterModel; visibleColumns?: string[] }) => void;
  };
}

export function DatasetDashboardDialog({
  isOpen,
  onClose,
  scope,
  onScopeChange,
  onRefresh,
  snapshot,
  stale,
  activeTab,
  onActiveTabChange,
  thumbnailCache,
  thumbnailLoadProgress,
  thumbnailTileSize,
  canZoomOut,
  canZoomIn,
  onZoomOut,
  onZoomIn,
  onLoadFullThumbnails,
  onLoadFilteredThumbnails,
  onThumbnailEntryLoad,
  onThumbnailEntryError,
  onRetryFailedThumbnails,
  onNavigateToVideo,
  onNavigateToChannel,
  onApplyContentFilter,
  allChannelIds = [],
  linkingProps,
}: DatasetDashboardDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-0 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        className="dialog-shell flex h-screen w-screen max-h-screen max-w-screen flex-col overflow-hidden bg-transparent p-0 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        style={{
          width: '100vw',
          height: '100vh',
        }}
      >
        <DashboardWorkspace
          isOpen={isOpen}
          scope={scope}
          onScopeChange={onScopeChange}
          onRefresh={onRefresh}
          onClose={onClose}
          snapshot={snapshot}
          stale={stale}
          activeTab={activeTab}
          onActiveTabChange={onActiveTabChange}
          thumbnailCache={thumbnailCache}
          thumbnailLoadProgress={thumbnailLoadProgress}
          thumbnailTileSize={thumbnailTileSize}
          canZoomOut={canZoomOut}
          canZoomIn={canZoomIn}
          onZoomOut={onZoomOut}
          onZoomIn={onZoomIn}
          onLoadFullThumbnails={onLoadFullThumbnails}
          onLoadFilteredThumbnails={onLoadFilteredThumbnails}
          onThumbnailEntryLoad={onThumbnailEntryLoad}
          onThumbnailEntryError={onThumbnailEntryError}
          onRetryFailedThumbnails={onRetryFailedThumbnails}
          onNavigateToVideo={onNavigateToVideo}
          onNavigateToChannel={onNavigateToChannel}
          onApplyContentFilter={onApplyContentFilter}
          allChannelIds={allChannelIds}
          linkingProps={linkingProps}
        />
      </div>
    </div>
  );
}
