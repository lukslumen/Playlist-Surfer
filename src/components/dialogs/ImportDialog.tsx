import { useState, useEffect, useMemo, useRef } from 'react';
import { X, Settings2, FilePlus, AlertTriangle, Plus, Info } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ColumnSchema, ChannelMetadataRelationshipType, ImportKind, ImportSubmission, ImportOptions, MergeOptions, SpecialMappings } from '../../types';
import { buildColumnDisplayNameMap, buildMergePreview, detectFriendlyImportSchema, detectImportKind, getColumnDisplayName, detectSuggestedMergeJoinColumns, detectIncomingChannelIdColumn, detectIncomingChannelTitleColumn, detectSpecialMappings, groupDuplicateRows, applyDuplicateSelections } from '../../lib/data';
import { SPECIAL_FIELD_CONFIG, uniqueOrdered } from './shared';
import { SmartSection, SpecialFieldKey, formatColumnOptionLabel } from './shared';

export function InfoHint({ text }: { text: string }) {
  return (
    <span className="inline-flex align-middle text-[var(--text-muted)]" title={text}>
      <Info size={12} />
    </span>
  );
}

export interface ImportDialogProps {
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

export const DEFAULT_IMPORT_COLUMNS = ['videoTitle', 'title', 'viewCount', 'publishedAtSQL', 'durationSec', 'likeCount', 'channelTitle', 'position'];

export type SpecialFieldChoiceMode = 'keep' | 'incoming' | 'custom' | 'unmapped';

export type SpecialFieldChoice = { mode: SpecialFieldChoiceMode; column?: string };

export function orderColumnsByVisibleOrder(columnNames: string[], preferredOrder: string[] = []) {
  const preferred = preferredOrder.filter((column) => columnNames.includes(column));
  const remaining = columnNames.filter((column) => !preferred.includes(column));
  return [...preferred, ...remaining];
}

export function getDefaultSelectedColumns(columns: ColumnSchema[], preferredOrder: string[] = []): string[] {
  const effectiveOrder = preferredOrder.length > 0 ? preferredOrder : DEFAULT_IMPORT_COLUMNS;
  return orderColumnsByVisibleOrder(columns.map((column) => column.column_name), effectiveOrder)
    .filter((column) => DEFAULT_IMPORT_COLUMNS.includes(column));
}

export function summarizeRowForReview(row: any, joinColumn: string) {
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

export function SummaryBadge({ label, value }: { label: string; value: number | string; }) {
  return (
    <div className="border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-center">
      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 text-sm font-semibold text-[var(--text-main)]">{value}</div>
    </div>
  );
}

export function formatSpecialFieldValue(columnName?: string | null, emptyLabel = 'Not mapped', schema?: ColumnSchema[]) {
  if (!columnName) return emptyLabel;
  const display = getColumnDisplayName(columnName, schema);
  return display === columnName ? columnName : `${display} (${columnName})`;
}

export function formatDetectedSchemaLabel(schemaId: ReturnType<typeof detectFriendlyImportSchema>) {
  if (schemaId === 'youtube-data-tools-channelsearch') return 'Detected: YouTube Data Tools — Channel Search export';
  if (schemaId === 'youtube-data-tools-videolist') return 'Detected: YouTube Data Tools — Video List export';
  return null;
}

export function describeSpecialFieldOutcome(fieldLabel: string, columnName?: string | null) {
  return columnName ? `${fieldLabel} will use ${columnName}` : `${fieldLabel} will remain unmapped`;
}

export function detectIncomingFieldChoices(
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
