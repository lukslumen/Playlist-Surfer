import { useMemo, useRef, useEffect, useCallback, useState, type DragEvent, type KeyboardEvent } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  ColDef,
  GridReadyEvent,
  CellClickedEvent,
  CellContextMenuEvent,
  FilterChangedEvent,
  GridApi,
  SortChangedEvent,
  ColumnResizedEvent,
  themeQuartz,
} from 'ag-grid-community';
import { Check, X } from 'lucide-react';
import {
  ColumnSchema,
  DashboardThumbnailSortRule,
  InclusionView,
  SavedView,
  ViewScope,
} from '../types';
import { BooleanMapFilter, GenericValueFilter, TagFilter, parseListString } from './CustomFilters';
import { BooleanMapSchema, ExplorerFilterModel, parseBooleanMapValue } from '../lib/filterCoordinator';
import { formatDateDisplay, formatDurationDisplay, getColumnDisplayName, getColumnHeaderTooltip, getDefaultGridColumnSizing, isDateLikeColumn, isDurationColumn, resolveVideoId, TRANSCRIPT_COLUMN } from '../lib/data';
import { extractSortRulesFromColumnState } from '../lib/dashboardThumbnails';
import { ScopeSelectionState, ScopeSelectionUpdate } from '../lib/selectionState';

interface MetadataGridProps {
  rows: any[];
  schema: ColumnSchema[];
  selection: ScopeSelectionState;
  onSelectionChange?: (update: ScopeSelectionUpdate) => void;
  isLoading: boolean;
  activeView?: SavedView;
  filterModel: ExplorerFilterModel;
  listLikeColumns: Set<string>;
  tagValueIndexByColumn: Record<string, string[]>;
  booleanMapSchemas?: Record<string, BooleanMapSchema>;
  onGridReady: (api: GridApi) => void;
  onFilterModelChange?: (filterModel: ExplorerFilterModel) => void;
  onSortModelChange?: (sortRules: DashboardThumbnailSortRule[]) => void;
  visibleColumns: string[];
  onFileDrop?: (file: File) => void;
  inclusionView: InclusionView;
  onMoveSelection?: () => void;
  onExcludeSelection?: () => void;
  onMoveVideos?: (videoIds: string[]) => void;
  viewScope?: ViewScope;
  onVideoChannelClick?: (args: { channelName: string; row: any }) => void;
  onChannelNavigateToVideos?: (channelRow: any) => void;
  onClearFilters?: () => void;
  onShowAllSources?: () => void;
  onToggleInclusionView?: () => void;
  hasHiddenSources?: boolean;
  columnWidths?: Record<string, number>;
  onColumnWidthsChange?: (widths: Record<string, number>) => void;
}

function shouldIgnoreGridShortcut(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return !!element.closest('input, textarea, select, [contenteditable="true"], .ag-popup');
}

function shallowEqualFilterModel(a: ExplorerFilterModel | null | undefined, b: ExplorerFilterModel | null | undefined) {
  const aEntries = Object.entries(a || {});
  const bEntries = Object.entries(b || {});
  if (aEntries.length !== bEntries.length) return false;
  return aEntries.every(([key, value]) => JSON.stringify(value) === JSON.stringify((b || {})[key]));
}

export default function MetadataGrid({
  rows,
  schema,
  selection,
  onSelectionChange,
  isLoading,
  activeView,
  filterModel,
  listLikeColumns,
  tagValueIndexByColumn,
  booleanMapSchemas = {},
  onGridReady,
  onFilterModelChange,
  onSortModelChange,
  visibleColumns,
  onFileDrop,
  inclusionView,
  onMoveSelection,
  onExcludeSelection,
  onMoveVideos,
  viewScope = 'videos',
  onVideoChannelClick,
  onChannelNavigateToVideos,
  onClearFilters,
  onShowAllSources,
  onToggleInclusionView,
  hasHiddenSources = false,
  columnWidths = {},
  onColumnWidthsChange,
}: MetadataGridProps) {
  const isChannelScope = viewScope === 'channels';
  const selectedRowCount = selection.selectedKeys.length;
  const gridApiRef = useRef<GridApi | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectionRef = useRef<ScopeSelectionState>(selection);
  const syncingFilterModelRef = useRef(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    videoIds: string[];
  } | null>(null);

  const contextActionLabel = inclusionView === 'included' ? 'Move selected videos to Excluded' : 'Restore selected videos to Included';
  const resolveChannelKey = useCallback((row: any) => String(row?.channel_key || row?.channel_id || row?.channel_name || '').trim(), []);
  const showNoRowsRecovery = schema.length > 0 && !isLoading && rows.length === 0;
  const sampleValuesByColumn = useMemo(() => {
    const next: Record<string, any[]> = {};
    const sampleRows = rows.slice(0, Math.min(rows.length, 60));
    schema.forEach((column) => {
      next[column.column_name] = sampleRows.map((row) => row?.[column.column_name]).filter((value) => value !== undefined).slice(0, 24);
    });
    return next;
  }, [rows, schema]);

  const channelNameOptionItems = useMemo(() => {
    if (!isChannelScope) return [];
    const counts = new Map<string, number>();
    rows.forEach((row) => {
      const value = row?.channel_name == null ? '' : String(row.channel_name).trim();
      if (!value) return;
      counts.set(value, (counts.get(value) || 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => a.value.localeCompare(b.value));
  }, [isChannelScope, rows]);

  const applySelection = useCallback((update: ScopeSelectionUpdate) => {
    const selectedKeys = Array.from(new Set((update.selectedKeys || []).filter(Boolean)));
    const normalized: ScopeSelectionUpdate = {
      selectedKeys,
      anchorKey: selectedKeys.length ? (update.anchorKey ?? selectedKeys[0]) : null,
      focusKey: selectedKeys.length ? (update.focusKey ?? selectedKeys[selectedKeys.length - 1]) : null,
      detailKey: update.detailKey ?? (selectedKeys[selectedKeys.length - 1] || selectionRef.current.detailKey || null),
    };
    selectionRef.current = {
      selectedKeys: normalized.selectedKeys,
      anchorKey: normalized.anchorKey ?? null,
      focusKey: normalized.focusKey ?? null,
      detailKey: normalized.detailKey ?? null,
    };
    onSelectionChange?.(normalized);
  }, [onSelectionChange]);

  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  const columnDefs = useMemo<ColDef[]>(() => {
    const orderedSchema = [
      ...visibleColumns.filter((column) => schema.some((entry) => entry.column_name === column)).map((column) => schema.find((entry) => entry.column_name === column)!),
      ...schema.filter((entry) => !visibleColumns.includes(entry.column_name)),
    ];
    const baseDefs = orderedSchema.map((col) => {
      const name = col.column_name.toLowerCase();
      const type = col.column_type.toLowerCase();
      const isNumeric = type.includes('int') || type.includes('double') || type.includes('float') || type.includes('decimal');
      const isDate = isDateLikeColumn(col.column_name, col.column_type);
      const isTranscript = col.column_name === TRANSCRIPT_COLUMN;
      const isDuration = isDurationColumn(col.column_name);

      const isTitle = name.includes('title') && !name.includes('channel');
      const isPrimaryChannelLink = isChannelScope ? col.column_name === 'channel_name' : ['channelTitle', 'channel_title', 'channel_name'].includes(col.column_name);
      const isChannelNameListFilter = isChannelScope && col.column_name === 'channel_name';
      const booleanMapSchema = booleanMapSchemas[col.column_name];
      const isBooleanMap = !!booleanMapSchema;
      const isTags = isChannelNameListFilter || (!isTranscript && !isBooleanMap && (
        name.startsWith('linking_') ||
        name.includes('tag') ||
        name.includes('reason') ||
        name.includes('category') ||
        name.includes('community') ||
        name.includes('topic') ||
        name.includes('intent') ||
        name.includes('label') ||
        name.includes('practice') ||
        listLikeColumns.has(col.column_name)
      ));

      const filterKind = isDuration ? 'duration' : (isDate ? 'date' : (isNumeric ? 'number' : 'text'));

      const sizing = getDefaultGridColumnSizing(col, sampleValuesByColumn[col.column_name] || []);

      return {
        field: col.column_name,
        headerName: getColumnDisplayName(col),
        headerTooltip: getColumnHeaderTooltip(col, schema),
        sortable: true,
        filter: isBooleanMap ? BooleanMapFilter : (isTags ? TagFilter : GenericValueFilter),
        filterParams: isBooleanMap
          ? { booleanMapSchema }
          : (isTags
            ? (isChannelNameListFilter
              ? {
                  values: channelNameOptionItems.map((item) => item.value),
                  optionItems: channelNameOptionItems,
                }
              : { values: tagValueIndexByColumn[col.column_name] ?? [] })
            : { filterKind }),
        resizable: true,
        initialWidth: columnWidths[col.column_name] || sizing.initialWidth,
        minWidth: isTranscript ? Math.max(180, sizing.minWidth) : sizing.minWidth,
        maxWidth: sizing.maxWidth,
        tooltipField: col.column_name,
        pinned: isTitle ? 'left' : undefined,
        cellClass: isTitle ? 'title-cell' : (isPrimaryChannelLink ? 'channel-cell' : undefined),
        suppressSizeToFit: true,
        hide: !visibleColumns.includes(col.column_name),
        cellRenderer: isChannelScope && col.column_name === 'channel_name'
          ? (params: any) => {
              const channelName = params.value == null ? '' : String(params.value);
              const count = Number(params.data?.video_count_in_dataset || 0);
              return (
                <div className="channel-cell-shell">
                  <button
                    type="button"
                    className="channel-link-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onChannelNavigateToVideos?.(params.data);
                    }}
                    title="Show videos for this channel"
                  >
                    {channelName}
                  </button>
                  {count > 0 ? <span className="channel-cell-count">({count.toLocaleString()})</span> : null}
                </div>
              );
            }
          : undefined,
        valueFormatter: (params: any) => {
          if (params.value === null || params.value === undefined) return '';

          if (isBooleanMap) {
            const parsed = parseBooleanMapValue(params.value);
            if (!parsed || !booleanMapSchema) return '';
            return booleanMapSchema.keys
              .filter((key) => parsed[key] === true)
              .map((key) => booleanMapSchema.labels[key] || key)
              .join(', ');
          }

          if (isTags) {
            return parseListString(params.value).join(', ');
          }

          if (isTranscript) {
            const value = String(params.value);
            return value.length > 120 ? `${value.slice(0, 117)}...` : value;
          }

          if (isDuration) {
            return formatDurationDisplay(params.value);
          }

          if (isDate) {
            return formatDateDisplay(params.value);
          }

          if (isChannelScope && col.column_name === 'channel_name') {
            const count = Number(params.data?.video_count_in_dataset || 0);
            if (count > 0) return `${params.value} (${count.toLocaleString()})`;
            return params.value;
          }

          if (isNumeric && typeof params.value === 'number') {
            return params.value.toLocaleString();
          }

          return params.value;
        },
      } as ColDef;
    });

    const order = ['title', 'channel', 'view', 'comment', 'published', 'user_tags'];
    const explicitOrder = new Map(visibleColumns.map((column, index) => [column, index]));

    return baseDefs.sort((a, b) => {
      const fieldA = a.field || '';
      const fieldB = b.field || '';
      const explicitA = explicitOrder.has(fieldA) ? explicitOrder.get(fieldA)! : Number.POSITIVE_INFINITY;
      const explicitB = explicitOrder.has(fieldB) ? explicitOrder.get(fieldB)! : Number.POSITIVE_INFINITY;
      if (explicitA !== explicitB) return explicitA - explicitB;

      const nameA = fieldA.toLowerCase();
      const nameB = fieldB.toLowerCase();
      const indexA = order.findIndex((value) => nameA.includes(value));
      const indexB = order.findIndex((value) => nameB.includes(value));

      if (indexA !== -1 && indexB !== -1) return indexA - indexB;
      if (indexA !== -1) return -1;
      if (indexB !== -1) return 1;
      return nameA.localeCompare(nameB);
    });
  }, [booleanMapSchemas, isChannelScope, listLikeColumns, sampleValuesByColumn, schema, tagValueIndexByColumn, visibleColumns]);

  const syncSelectedRows = useCallback((rowIds: string[]) => {
    const api = gridApiRef.current;
    if (!api) return;
    const uniqueIds = Array.from(new Set(rowIds.filter(Boolean)));
    api.deselectAll();
    uniqueIds.forEach((rowId) => {
      api.getRowNode(rowId)?.setSelected(true, false);
    });
  }, []);

  const clearGridSelection = useCallback(() => {
    const api = gridApiRef.current;
    if (!api) return;
    api.deselectAll();
  }, []);

  const resolveRowKey = useCallback((row: any) => {
    if (isChannelScope) return resolveChannelKey(row);
    return resolveVideoId(row);
  }, [isChannelScope, resolveChannelKey]);

  const getDisplayedKeys = useCallback((api: GridApi) => {
    const keys: string[] = [];
    api.forEachNodeAfterFilterAndSort((node) => {
      const key = resolveRowKey(node.data);
      if (key) keys.push(key);
    });
    return keys;
  }, [resolveRowKey]);

  const getRangeSelectionKeys = useCallback((api: GridApi, startIndex: number, endIndex: number) => {
    const start = Math.min(startIndex, endIndex);
    const end = Math.max(startIndex, endIndex);
    const keys: string[] = [];
    for (let index = start; index <= end; index += 1) {
      const node = api.getDisplayedRowAtIndex(index);
      const key = resolveRowKey(node?.data);
      if (key) keys.push(key);
    }
    return keys;
  }, [resolveRowKey]);

  const syncGridFilterModel = useCallback((nextFilterModel: ExplorerFilterModel) => {
    if (!gridApiRef.current) return;
    const current = gridApiRef.current.getFilterModel() as ExplorerFilterModel;
    if (shallowEqualFilterModel(current, nextFilterModel)) return;
    syncingFilterModelRef.current = true;
    gridApiRef.current.setFilterModel(Object.keys(nextFilterModel || {}).length ? nextFilterModel : null);
    syncingFilterModelRef.current = false;
  }, []);

  const onGridReadyHandler = useCallback((params: GridReadyEvent) => {
    gridApiRef.current = params.api;
    onGridReady(params.api);
    if (activeView) {
      params.api.applyColumnState({ state: activeView.columnState, applyOrder: true });
    }
    syncGridFilterModel(filterModel);
    if (!isChannelScope) {
      onSortModelChange?.(extractSortRulesFromColumnState(params.api.getColumnState()));
    }
    if (selection.selectedKeys.length > 0) {
      syncSelectedRows(selection.selectedKeys);
    } else {
      clearGridSelection();
    }
  }, [activeView, clearGridSelection, filterModel, isChannelScope, onGridReady, onSortModelChange, selection.selectedKeys, syncGridFilterModel, syncSelectedRows]);

  useEffect(() => {
    if (!gridApiRef.current) return;

    if (activeView) {
      gridApiRef.current.applyColumnState({ state: activeView.columnState, applyOrder: true });
    } else if (Object.keys(columnWidths).length) {
      gridApiRef.current.applyColumnState({
        state: Object.entries(columnWidths).map(([colId, width]) => ({ colId, width })),
        applyOrder: false,
      });
    }
    if (!isChannelScope) {
      onSortModelChange?.(extractSortRulesFromColumnState(gridApiRef.current.getColumnState()));
    }
  }, [activeView, columnWidths, isChannelScope, onSortModelChange]);

  useEffect(() => {
    syncGridFilterModel(filterModel);
  }, [filterModel, syncGridFilterModel]);

  useEffect(() => {
    if (selection.selectedKeys.length > 0) {
      syncSelectedRows(selection.selectedKeys);
      return;
    }
    clearGridSelection();
  }, [clearGridSelection, selection.selectedKeys, syncSelectedRows]);

  const onFilterChangedHandler = useCallback((event: FilterChangedEvent) => {
    setContextMenu(null);
    if (syncingFilterModelRef.current) return;
    onFilterModelChange?.((event.api.getFilterModel() || {}) as ExplorerFilterModel);
  }, [onFilterModelChange]);

  const onSortChangedHandler = useCallback((event: SortChangedEvent) => {
    if (isChannelScope) return;
    onSortModelChange?.(extractSortRulesFromColumnState(event.api.getColumnState()));
  }, [isChannelScope, onSortModelChange]);

  const onColumnResizedHandler = useCallback((event: ColumnResizedEvent) => {
    if (!event.finished || !onColumnWidthsChange) return;
    const nextWidths: Record<string, number> = {};
    event.api.getColumnState().forEach((column) => {
      if (column.colId && typeof column.width === 'number') nextWidths[column.colId] = column.width;
    });
    onColumnWidthsChange(nextWidths);
  }, [onColumnWidthsChange]);

  const onCellClicked = useCallback((event: CellClickedEvent) => {
    setContextMenu(null);
    rootRef.current?.focus();

    const colId = event.column.getColId().toLowerCase();
    if (['channeltitle', 'channel_title', 'channel_name'].includes(colId) && event.value && onVideoChannelClick) {
      onVideoChannelClick({ channelName: String(event.value), row: event.data });
      return;
    }

    if (['channeltitle', 'channel_title', 'channel_name'].includes(colId) && event.value && gridApiRef.current) {
      const nextFilterModel = {
        ...(filterModel || {}),
        [event.column.getColId()]: {
          filterKind: 'text',
          operator: 'equals',
          value: String(event.value),
        },
      } as ExplorerFilterModel;
      onFilterModelChange?.(nextFilterModel);
      syncGridFilterModel(nextFilterModel);
    }

    const api = gridApiRef.current;
    if (!api) return;
    const rowKey = resolveRowKey(event.data);
    if (!rowKey) return;
    const nativeEvent = event.event as MouseEvent | undefined;
    const rowIndex = typeof event.node?.rowIndex === 'number' ? event.node.rowIndex : null;
    const isShift = Boolean(nativeEvent?.shiftKey);
    const isToggle = Boolean(nativeEvent?.ctrlKey || nativeEvent?.metaKey);

    if (isShift && rowIndex !== null) {
      const current = selectionRef.current;
      const anchorKey = current.anchorKey || current.focusKey || current.selectedKeys[0] || rowKey;
      const anchorNode = anchorKey ? api.getRowNode(anchorKey) : null;
      const anchorIndex = typeof anchorNode?.rowIndex === 'number' ? anchorNode.rowIndex : rowIndex;
      const rangeKeys = getRangeSelectionKeys(api, anchorIndex, rowIndex);
      syncSelectedRows(rangeKeys);
      applySelection({
        selectedKeys: rangeKeys,
        anchorKey,
        focusKey: rowKey,
        detailKey: rowKey,
      });
      return;
    }

    if (isToggle) {
      const current = selectionRef.current;
      const toggled = new Set(current.selectedKeys);
      if (toggled.has(rowKey)) toggled.delete(rowKey);
      else toggled.add(rowKey);
      const nextKeys = Array.from(toggled);
      if (!nextKeys.length) clearGridSelection();
      else syncSelectedRows(nextKeys);
      applySelection({
        selectedKeys: nextKeys,
        anchorKey: nextKeys.length
          ? ((current.anchorKey && nextKeys.includes(current.anchorKey)) ? current.anchorKey : rowKey)
          : null,
        focusKey: nextKeys.length ? rowKey : null,
        detailKey: rowKey,
      });
      return;
    }

    syncSelectedRows([rowKey]);
    applySelection({
      selectedKeys: [rowKey],
      anchorKey: rowKey,
      focusKey: rowKey,
      detailKey: rowKey,
    });
  }, [applySelection, clearGridSelection, filterModel, getRangeSelectionKeys, onFilterModelChange, onVideoChannelClick, resolveRowKey, syncGridFilterModel, syncSelectedRows]);

  const handleGridKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || shouldIgnoreGridShortcut(event.target) || !gridApiRef.current) return;

    const api = gridApiRef.current;
    const current = selectionRef.current;

    if ((event.ctrlKey || event.metaKey) && event.key === 'Delete' && selectedRowCount > 0) {
      event.preventDefault();
      onExcludeSelection?.();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      const displayedKeys = getDisplayedKeys(api);
      if (!displayedKeys.length) {
        clearGridSelection();
        applySelection({
          selectedKeys: [],
          anchorKey: null,
          focusKey: null,
          detailKey: current.detailKey,
        });
        return;
      }
      syncSelectedRows(displayedKeys);
      applySelection({
        selectedKeys: displayedKeys,
        anchorKey: displayedKeys[0],
        focusKey: displayedKeys[displayedKeys.length - 1],
        detailKey: displayedKeys[displayedKeys.length - 1],
      });
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      clearGridSelection();
      applySelection({
        selectedKeys: [],
        anchorKey: null,
        focusKey: null,
        detailKey: current.detailKey,
      });
      return;
    }

    if (event.key === 'Delete' && selectedRowCount > 0) {
      event.preventDefault();
      if (isChannelScope) onExcludeSelection?.();
      else onMoveSelection?.();
      return;
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

    const displayedCount = api.getDisplayedRowCount();
    if (displayedCount === 0) return;

    event.preventDefault();
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    const displayedKeys = getDisplayedKeys(api);
    const defaultKey = displayedKeys[direction > 0 ? 0 : displayedKeys.length - 1] || null;
    const focusKey = current.focusKey || current.detailKey || current.anchorKey || current.selectedKeys[current.selectedKeys.length - 1] || defaultKey;
    const focusNode = focusKey ? api.getRowNode(focusKey) : null;
    const currentIndex = typeof focusNode?.rowIndex === 'number'
      ? focusNode.rowIndex
      : (direction > 0 ? -1 : displayedCount);
    const nextIndex = Math.max(0, Math.min(displayedCount - 1, currentIndex + direction));
    const nextNode = api.getDisplayedRowAtIndex(nextIndex);
    const nextKey = resolveRowKey(nextNode?.data);
    if (!nextNode?.data || !nextKey) return;

    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
      const currentSet = new Set(current.selectedKeys.filter(Boolean));
      currentSet.add(nextKey);
      const nextKeys = displayedKeys.filter((key) => currentSet.has(key));
      syncSelectedRows(nextKeys);
      applySelection({
        selectedKeys: nextKeys,
        anchorKey: current.anchorKey || current.selectedKeys[0] || focusKey || nextKey,
        focusKey: nextKey,
        detailKey: nextKey,
      });
      api.ensureIndexVisible(nextIndex, 'middle');
      return;
    }

    if (event.shiftKey) {
      const anchorKey = current.anchorKey || focusKey || nextKey;
      const anchorNode = anchorKey ? api.getRowNode(anchorKey) : null;
      const anchorIndex = typeof anchorNode?.rowIndex === 'number' ? anchorNode.rowIndex : nextIndex;
      const rangeKeys = getRangeSelectionKeys(api, anchorIndex, nextIndex);
      syncSelectedRows(rangeKeys);
      applySelection({
        selectedKeys: rangeKeys,
        anchorKey,
        focusKey: nextKey,
        detailKey: nextKey,
      });
      api.ensureIndexVisible(nextIndex, 'middle');
      return;
    }

    syncSelectedRows([nextKey]);
    applySelection({
      selectedKeys: [nextKey],
      anchorKey: nextKey,
      focusKey: nextKey,
      detailKey: nextKey,
    });
    api.ensureIndexVisible(nextIndex, 'middle');
  }, [applySelection, clearGridSelection, getDisplayedKeys, getRangeSelectionKeys, isChannelScope, onExcludeSelection, onMoveSelection, resolveRowKey, selectedRowCount, syncSelectedRows]);

  const handleCellContextMenu = useCallback((event: CellContextMenuEvent) => {
    if (isChannelScope) return;
    rootRef.current?.focus();
    const videoId = resolveVideoId(event.data);
    if (!videoId) return;

    event.event?.preventDefault?.();

    const current = selectionRef.current;
    const alreadySelected = current.selectedKeys.includes(videoId);
    const nextVideoIds = alreadySelected ? current.selectedKeys : [videoId];

    if (!alreadySelected) {
      syncSelectedRows([videoId]);
      applySelection({
        selectedKeys: [videoId],
        anchorKey: videoId,
        focusKey: videoId,
        detailKey: videoId,
      });
    }

    const nativeEvent = event.event as MouseEvent | undefined;
    setContextMenu({
      x: nativeEvent?.clientX ?? 0,
      y: nativeEvent?.clientY ?? 0,
      videoIds: nextVideoIds,
    });
  }, [applySelection, isChannelScope, syncSelectedRows]);

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file && onFileDrop) {
      onFileDrop(file);
    }
  }, [onFileDrop]);

  useEffect(() => {
    if (!contextMenu) return;

    const closeMenu = () => setContextMenu(null);
    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };

    window.addEventListener('mousedown', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('keydown', handleWindowKeyDown);
    return () => {
      window.removeEventListener('mousedown', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('keydown', handleWindowKeyDown);
    };
  }, [contextMenu]);

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      data-metadata-grid-root="true"
      onKeyDownCapture={handleGridKeyDown}
      onMouseDownCapture={() => rootRef.current?.focus()}
      className="relative h-full w-full focus:outline-none"
    >
      {isLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/50">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-gray-900" />
        </div>
      )}

      {schema.length === 0 && !isLoading ? (
        <div
          className={[
            'h-full flex flex-col items-center justify-center text-[var(--text-muted)] p-8 text-center bg-[var(--bg-primary)] transition-colors',
            isDragActive ? 'bg-[var(--grid-hover)]' : '',
          ].join(' ')}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragActive(true);
          }}
          onDragEnter={(event) => {
            event.preventDefault();
            setIsDragActive(true);
          }}
          onDragLeave={(event) => {
            if (event.currentTarget === event.target) {
              setIsDragActive(false);
            }
          }}
          onDrop={handleDrop}
        >
          <div className={[
            'flex h-[60%] min-h-[300px] w-full max-w-4xl flex-col items-center justify-center border-2 border-dashed px-8 transition-colors',
            isDragActive ? 'border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_7%,transparent)]' : 'border-[var(--border-color)]',
          ].join(' ')}>
            <div className="mb-5 flex h-16 w-16 items-center justify-center border border-[var(--border-color)] text-2xl opacity-70">
              <span>📄</span>
            </div>
            <p className="text-lg font-semibold text-[var(--text-main)]">No data loaded</p>
            <p className="mt-2 max-w-xl text-sm text-[var(--text-muted)]">
              Drag and drop your first YouTube metadata CSV or project backup into this field, or use the Import button above.
            </p>
          </div>
        </div>
      ) : (
        <>
          <AgGridReact
            theme={themeQuartz}
            rowData={rows}
            columnDefs={columnDefs}
            getRowId={(params) => {
              if (isChannelScope) {
                return String(params.data?.channel_key || params.data?.channel_id || params.data?.channel_name || '');
              }
              return resolveVideoId(params.data) || String(params.data?.id || params.data?.video_id || params.data?.Video_ID || '');
            }}
            onGridReady={onGridReadyHandler}
            onFilterChanged={onFilterChangedHandler}
            onSortChanged={onSortChangedHandler}
            onColumnResized={onColumnResizedHandler}
            onCellClicked={onCellClicked}
            onCellContextMenu={handleCellContextMenu}
            rowSelection={{
              mode: 'multiRow',
              enableClickSelection: false,
              checkboxes: false,
              headerCheckbox: false,
              ctrlASelectsRows: false,
            }}
            animateRows={false}
            suppressCellFocus={true}
            suppressNoRowsOverlay={true}
            headerHeight={40}
            rowHeight={32}
            tooltipShowDelay={1000}
            rowBuffer={100}
            valueCache={true}
            alwaysShowVerticalScrollbar={true}
            alwaysShowHorizontalScrollbar={true}
            suppressColumnVirtualisation={false}
          />
          {showNoRowsRecovery ? (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-[color-mix(in_oklab,var(--bg-primary)_82%,transparent)] p-6">
              <div className="pointer-events-auto w-full max-w-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6 text-center shadow-sm">
                <p className="text-lg font-semibold text-[var(--text-main)]">No rows to show</p>
                <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
                  Data is loaded, but current view filters/scope settings hide all rows.
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                  {onClearFilters ? (
                    <button
                      type="button"
                      onClick={onClearFilters}
                      className="border border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--text-main)] transition-colors hover:bg-[color-mix(in_oklab,var(--accent)_14%,transparent)]"
                    >
                      {isChannelScope ? 'Reset channel filters' : 'Clear filters'}
                    </button>
                  ) : null}
                  {!isChannelScope && hasHiddenSources && onShowAllSources ? (
                    <button
                      type="button"
                      onClick={onShowAllSources}
                      className="border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 text-xs font-medium text-[var(--text-main)] transition-colors hover:bg-[var(--grid-hover)]"
                    >
                      Show all sources
                    </button>
                  ) : null}
                  {!isChannelScope && onToggleInclusionView ? (
                    <button
                      type="button"
                      onClick={onToggleInclusionView}
                      className="border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 text-xs font-medium text-[var(--text-main)] transition-colors hover:bg-[var(--grid-hover)]"
                    >
                      Switch to {inclusionView === 'included' ? 'Excluded' : 'Included'}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}

      {!isChannelScope && contextMenu && (
        <div
          className="fixed z-[140] min-w-[220px] border border-[var(--border-color)] bg-[var(--bg-secondary)] p-1 shadow-2xl"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              onMoveVideos?.(contextMenu.videoIds);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-[var(--text-main)] transition-colors hover:bg-[var(--grid-hover)]"
            title={contextActionLabel}
            aria-label={contextActionLabel}
          >
            <span className="inline-flex h-5 w-5 items-center justify-center border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-main)]">
              {inclusionView === 'included' ? <X size={12} /> : <Check size={12} />}
            </span>
            <span>{inclusionView === 'included' ? 'Move to Excluded' : 'Restore to Included'}</span>
          </button>
        </div>
      )}
    </div>
  );
}
