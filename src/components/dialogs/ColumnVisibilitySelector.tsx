import { useState, useEffect, useMemo } from 'react';
import type { BooleanMapSchema, ExplorerColumnFilterModel, ExplorerFilterModel, GenericFilterKind, GenericNumericOperator, GenericTextOperator } from '../../lib/filterCoordinator';
import { X, Settings2, TableProperties, Trash2, Undo2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ColumnSchema, SourceKind, SpecialMappings } from '../../types';
import { buildColumnDisplayNameMap } from '../../lib/data';
import { SPECIAL_FIELD_CONFIG, uniqueOrdered } from './shared';
import { SmartSection, SpecialFieldKey, formatColumnOptionLabel } from './shared';

export type EditViewFilterKind = GenericFilterKind | 'tag' | 'booleanMap';

export interface EditViewFilterItem {
  column: string;
  summary: string;
  kind: EditViewFilterKind;
  model: ExplorerColumnFilterModel;
}

export interface EditViewFilterColumn {
  column: string;
  kind: EditViewFilterKind;
}

export type EditViewFilterDraft = {
  operator: string;
  value: string;
  valuesInput: string;
  matchMode: 'any' | 'all' | 'only';
  booleanSelections: Record<string, 'true' | 'false'>;
};

export const TEXT_FILTER_OPERATORS: Array<{ value: GenericTextOperator; label: string }> = [
  { value: 'contains', label: 'contains' },
  { value: 'equals', label: 'equals' },
  { value: 'startsWith', label: 'starts with' },
  { value: 'endsWith', label: 'ends with' },
];

export const NUMERIC_FILTER_OPERATORS: Array<{ value: GenericNumericOperator; label: string }> = [
  { value: 'eq', label: '=' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '≥' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
  { value: 'between', label: 'between' },
];

export function buildEditViewFilterDraft(kind: EditViewFilterKind, model?: ExplorerColumnFilterModel | null): EditViewFilterDraft {
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

export function buildEditViewFilterModel(kind: EditViewFilterKind, draft: EditViewFilterDraft): ExplorerColumnFilterModel {
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

export interface ColumnVisibilityProps {
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
