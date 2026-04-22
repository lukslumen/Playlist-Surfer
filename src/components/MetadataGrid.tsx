import { useMemo, useRef, useEffect, useCallback, useState, type DragEvent, type KeyboardEvent } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  ColDef,
  GridReadyEvent,
  RowSelectedEvent,
  CellClickedEvent,
  CellContextMenuEvent,
  FilterChangedEvent,
  GridApi,
  SortChangedEvent,
  SelectionChangedEvent,
  ColumnResizedEvent,
  themeQuartz,
} from 'ag-grid-community';
import { Check, X } from 'lucide-react';
import {
  ColumnSchema,
  DashboardThumbnailSortRule,
  InclusionView,
  SavedView,
  VideoSelectionState,
  ViewScope,
} from '../types';
import { BooleanMapFilter, GenericValueFilter, TagFilter, parseListString } from './CustomFilters';
import { BooleanMapSchema, ExplorerFilterModel, parseBooleanMapValue } from '../lib/filterCoordinator';
import { formatDateDisplay, formatDurationDisplay, getColumnDisplayName, getColumnHeaderTooltip, getDefaultGridColumnSizing, isDateLikeColumn, isDurationColumn, resolveVideoId, TRANSCRIPT_COLUMN } from '../lib/data';
import { extractSortRulesFromColumnState } from '../lib/dashboardThumbnails';

interface MetadataGridProps {
  rows: any[];
  schema: ColumnSchema[];
  onRowSelected: (row: any | null) => void;
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
  visibleVideoIds: string[];
  selectionState: VideoSelectionState;
  onSelectionStateChange?: (selectionState: VideoSelectionState) => void;
  inclusionView: InclusionView;
  onMoveSelection?: () => void;
  onExcludeSelection?: () => void;
  onMoveVideos?: (videoIds: string[]) => void;
  viewScope?: ViewScope;
  onVideoChannelClick?: (args: { channelName: string; row: any }) => void;
  onChannelNavigateToVideos?: (channelRow: any) => void;
  selectedChannelKeys?: string[];
  onChannelSelectionChange?: (rows: any[]) => void;
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

const EMPTY_SELECTION_STATE: VideoSelectionState = {
  mode: 'none',
  ids: [],
  anchorVideoId: null,
  focusVideoId: null,
};

export default function MetadataGrid({
  rows,
  schema,
  onRowSelected,
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
  visibleVideoIds,
  selectionState,
  onSelectionStateChange,
  inclusionView,
  onMoveSelection,
  onExcludeSelection,
  onMoveVideos,
  viewScope = 'videos',
  onVideoChannelClick,
  onChannelNavigateToVideos,
  selectedChannelKeys = [],
  onChannelSelectionChange,
  onClearFilters,
  onShowAllSources,
  onToggleInclusionView,
  hasHiddenSources = false,
  columnWidths = {},
  onColumnWidthsChange,
}: MetadataGridProps) {
  const isChannelScope = viewScope === 'channels';
  const isAllVisibleSelected = selectionState.mode === 'allVisible';
  const explicitSelectedVideoIds = selectionState.mode === 'explicit' ? selectionState.ids : [];
  const selectedVideoCount = isAllVisibleSelected ? visibleVideoIds.length : explicitSelectedVideoIds.length;
  const gridApiRef = useRef<GridApi | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectionStateRef = useRef<VideoSelectionState>(selectionState);
  const syncingSelectionRef = useRef(false);
  const syncingFilterModelRef = useRef(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    videoIds: string[];
  } | null>(null);

  const contextActionLabel = inclusionView === 'included' ? 'Move selected videos to Excluded' : 'Restore selected videos to Included';
  const visibleVideoIdSet = useMemo(() => new Set(visibleVideoIds), [visibleVideoIds]);
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

  const applySelectionState = useCallback((nextState: VideoSelectionState) => {
    selectionStateRef.current = nextState;
    onSelectionStateChange?.(nextState);
  }, [onSelectionStateChange]);

  useEffect(() => {
    selectionStateRef.current = selectionState;
  }, [selectionState]);

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
    syncingSelectionRef.current = true;
    api.deselectAll();
    uniqueIds.forEach((rowId) => {
      api.getRowNode(rowId)?.setSelected(true, false);
    });
    syncingSelectionRef.current = false;
  }, []);

  const clearGridSelection = useCallback(() => {
    const api = gridApiRef.current;
    if (!api) return;
    syncingSelectionRef.current = true;
    api.deselectAll();
    syncingSelectionRef.current = false;
  }, []);

  const getDisplayedVideoIds = useCallback((api: GridApi) => {
    const ids: string[] = [];
    api.forEachNodeAfterFilterAndSort((node) => {
      const videoId = resolveVideoId(node.data);
      if (videoId) ids.push(videoId);
    });
    return ids;
  }, []);

  const getDisplayedChannelKeys = useCallback((api: GridApi) => {
    const keys: string[] = [];
    api.forEachNodeAfterFilterAndSort((node) => {
      const key = resolveChannelKey(node.data);
      if (key) keys.push(key);
    });
    return keys;
  }, [resolveChannelKey]);

  const getRangeSelectionKeys = useCallback((api: GridApi, startIndex: number, endIndex: number) => {
    const start = Math.min(startIndex, endIndex);
    const end = Math.max(startIndex, endIndex);
    const keys: string[] = [];
    for (let index = start; index <= end; index += 1) {
      const node = api.getDisplayedRowAtIndex(index);
      const key = resolveChannelKey(node?.data);
      if (key) keys.push(key);
    }
    return keys;
  }, [resolveChannelKey]);

  const buildExplicitSelectionState = useCallback((ids: string[], anchorVideoId?: string | null, focusVideoId?: string | null): VideoSelectionState => {
    const uniqueIds = Array.from(new Set(ids.filter((videoId) => visibleVideoIdSet.has(videoId))));
    if (!uniqueIds.length) return EMPTY_SELECTION_STATE;
    const resolvedAnchor = anchorVideoId && uniqueIds.includes(anchorVideoId) ? anchorVideoId : uniqueIds[0];
    const resolvedFocus = focusVideoId && uniqueIds.includes(focusVideoId) ? focusVideoId : uniqueIds[uniqueIds.length - 1];
    return {
      mode: 'explicit',
      ids: uniqueIds,
      anchorVideoId: resolvedAnchor,
      focusVideoId: resolvedFocus,
    };
  }, [visibleVideoIdSet]);

  const getRangeSelectionIds = useCallback((api: GridApi, startIndex: number, endIndex: number) => {
    const start = Math.min(startIndex, endIndex);
    const end = Math.max(startIndex, endIndex);
    const ids: string[] = [];
    for (let index = start; index <= end; index += 1) {
      const node = api.getDisplayedRowAtIndex(index);
      const videoId = resolveVideoId(node?.data);
      if (videoId) ids.push(videoId);
    }
    return ids;
  }, []);

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
      if (selectionState.mode === 'explicit') {
        syncSelectedRows(selectionState.ids);
      } else {
        clearGridSelection();
      }
    } else if (selectedChannelKeys.length > 0) {
      syncSelectedRows(selectedChannelKeys);
    } else {
      clearGridSelection();
    }
  }, [activeView, clearGridSelection, filterModel, isChannelScope, onGridReady, onSortModelChange, selectionState, selectedChannelKeys, syncGridFilterModel, syncSelectedRows]);

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
    if (isChannelScope) {
      if (selectedChannelKeys.length > 0) {
        syncSelectedRows(selectedChannelKeys);
        return;
      }
      clearGridSelection();
      return;
    }
    if (selectionState.mode === 'explicit') {
      syncSelectedRows(selectionState.ids);
      return;
    }
    clearGridSelection();
  }, [clearGridSelection, isChannelScope, selectionState, selectedChannelKeys, syncSelectedRows]);

  const onRowSelectedHandler = useCallback((event: RowSelectedEvent) => {
    if (syncingSelectionRef.current || !event.node.isSelected()) return;
    onRowSelected(event.data);
  }, [onRowSelected]);

  const onSelectionChangedHandler = useCallback((event: SelectionChangedEvent) => {
    if (syncingSelectionRef.current) return;
    if (isChannelScope) {
      const selectedNodes = event.api.getSelectedNodes();
      const selectedRows = selectedNodes.map((node) => node.data).filter(Boolean);
      onChannelSelectionChange?.(selectedRows);
      onRowSelected(selectedRows[selectedRows.length - 1] ?? null);
    }
  }, [isChannelScope, onChannelSelectionChange, onRowSelected]);

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
    if (isChannelScope) {
      const api = gridApiRef.current;
      if (!api) return;
      const channelKey = resolveChannelKey(event.data);
      if (!channelKey) return;
      const nativeEvent = event.event as MouseEvent | undefined;
      const rowIndex = typeof event.node?.rowIndex === 'number' ? event.node.rowIndex : null;
      const isShift = Boolean(nativeEvent?.shiftKey);
      const isToggle = Boolean(nativeEvent?.ctrlKey || nativeEvent?.metaKey);

      if (isShift && rowIndex !== null) {
        const anchorKey = selectedChannelKeys[0] || channelKey;
        const anchorNode = anchorKey ? api.getRowNode(anchorKey) : null;
        const anchorIndex = typeof anchorNode?.rowIndex === 'number' ? anchorNode.rowIndex : rowIndex;
        const rangeKeys = getRangeSelectionKeys(api, anchorIndex, rowIndex);
        syncSelectedRows(rangeKeys);
        onChannelSelectionChange?.(rangeKeys.map((key) => api.getRowNode(key)?.data).filter(Boolean));
        onRowSelected(event.data);
        return;
      }

      if (isToggle) {
        const toggled = new Set(selectedChannelKeys.filter(Boolean));
        if (toggled.has(channelKey)) toggled.delete(channelKey);
        else toggled.add(channelKey);
        const nextKeys = Array.from(toggled);
        if (!nextKeys.length) clearGridSelection();
        else syncSelectedRows(nextKeys);
        onChannelSelectionChange?.(nextKeys.map((key) => api.getRowNode(key)?.data).filter(Boolean));
        onRowSelected(nextKeys.length ? event.data : null);
        return;
      }

      syncSelectedRows([channelKey]);
      onChannelSelectionChange?.([event.data]);
      onRowSelected(event.data);
      return;
    }

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
    const videoId = resolveVideoId(event.data);
    if (!videoId) return;
    const nativeEvent = event.event as MouseEvent | undefined;
    const rowIndex = typeof event.node?.rowIndex === 'number' ? event.node.rowIndex : null;
    const isShift = Boolean(nativeEvent?.shiftKey);
    const isToggle = Boolean(nativeEvent?.ctrlKey || nativeEvent?.metaKey);

    if (isShift && rowIndex !== null) {
      const anchorId = selectionState.anchorVideoId || selectionState.focusVideoId || selectionState.ids[0] || videoId;
      const anchorNode = anchorId ? api.getRowNode(anchorId) : null;
      const anchorIndex = typeof anchorNode?.rowIndex === 'number' ? anchorNode.rowIndex : rowIndex;
      const rangeIds = getRangeSelectionIds(api, anchorIndex, rowIndex);
      const nextSelection = buildExplicitSelectionState(rangeIds, anchorId, videoId);
      syncSelectedRows(nextSelection.ids);
      applySelectionState(nextSelection);
      onRowSelected(event.data);
      return;
    }

    if (isToggle) {
      const baseIds = selectionState.mode === 'allVisible'
        ? getDisplayedVideoIds(api)
        : selectionState.mode === 'explicit'
          ? selectionState.ids
          : [];
      const toggled = new Set(baseIds.filter((id) => visibleVideoIdSet.has(id)));
      if (toggled.has(videoId)) toggled.delete(videoId);
      else toggled.add(videoId);
      const nextSelection = buildExplicitSelectionState(
        Array.from(toggled),
        selectionState.anchorVideoId || videoId,
        videoId,
      );
      if (nextSelection.mode === 'none') clearGridSelection();
      else syncSelectedRows(nextSelection.ids);
      applySelectionState(nextSelection);
      onRowSelected(nextSelection.mode === 'none' ? null : event.data);
      return;
    }

    const nextSelection = buildExplicitSelectionState([videoId], videoId, videoId);
    syncSelectedRows(nextSelection.ids);
    applySelectionState(nextSelection);
    onRowSelected(event.data);
  }, [applySelectionState, buildExplicitSelectionState, clearGridSelection, filterModel, getDisplayedVideoIds, getRangeSelectionIds, getRangeSelectionKeys, isChannelScope, onChannelNavigateToVideos, onChannelSelectionChange, onFilterModelChange, onRowSelected, onVideoChannelClick, resolveChannelKey, selectedChannelKeys, selectionState, syncGridFilterModel, syncSelectedRows, visibleVideoIdSet]);

  const handleGridKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || shouldIgnoreGridShortcut(event.target) || !gridApiRef.current) return;

    if (isChannelScope) {
      const api = gridApiRef.current;
      if ((event.ctrlKey || event.metaKey) && event.key === 'Delete' && selectedChannelKeys.length > 0) {
        event.preventDefault();
        onExcludeSelection?.();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        const displayedKeys = getDisplayedChannelKeys(api);
        if (!displayedKeys.length) {
          clearGridSelection();
          onChannelSelectionChange?.([]);
          onRowSelected(null);
          return;
        }
        syncSelectedRows(displayedKeys);
        onChannelSelectionChange?.(displayedKeys.map((key) => api.getRowNode(key)?.data).filter(Boolean));
        onRowSelected(api.getRowNode(displayedKeys[displayedKeys.length - 1])?.data ?? null);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        clearGridSelection();
        onChannelSelectionChange?.([]);
        onRowSelected(null);
      }
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      const api = gridApiRef.current;
      const displayedIds = getDisplayedVideoIds(api);
      if (!displayedIds.length) {
        clearGridSelection();
        applySelectionState(EMPTY_SELECTION_STATE);
        onRowSelected(null);
        return;
      }
      const nextSelection = buildExplicitSelectionState(
        displayedIds,
        displayedIds[0],
        displayedIds[displayedIds.length - 1],
      );
      syncSelectedRows(nextSelection.ids);
      applySelectionState(nextSelection);
      const focusNode = api.getRowNode(nextSelection.focusVideoId || displayedIds[displayedIds.length - 1]);
      onRowSelected(focusNode?.data ?? null);
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      clearGridSelection();
      applySelectionState(EMPTY_SELECTION_STATE);
      onRowSelected(null);
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key === 'Delete' && selectedVideoCount > 0) {
      event.preventDefault();
      onExcludeSelection?.();
      return;
    }

    if (event.key === 'Delete' && selectedVideoCount > 0) {
      event.preventDefault();
      onMoveSelection?.();
      return;
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

    const api = gridApiRef.current;
    const displayedCount = api.getDisplayedRowCount();
    if (displayedCount === 0) return;

    event.preventDefault();
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    const currentSelection = selectionStateRef.current;
    const anchorId = currentSelection.anchorVideoId
      || currentSelection.focusVideoId
      || currentSelection.ids[0]
      || resolveVideoId(api.getDisplayedRowAtIndex(0)?.data);
    const anchorNode = anchorId ? api.getRowNode(anchorId) : null;
    const focusId = currentSelection.focusVideoId
      || currentSelection.anchorVideoId
      || currentSelection.ids[currentSelection.ids.length - 1]
      || anchorId;
    const focusNode = focusId ? api.getRowNode(focusId) : null;
    const currentIndex = typeof focusNode?.rowIndex === 'number'
      ? focusNode.rowIndex
      : (direction > 0 ? -1 : displayedCount);
    const nextIndex = Math.max(0, Math.min(displayedCount - 1, currentIndex + direction));
    const nextNode = api.getDisplayedRowAtIndex(nextIndex);
    const nextVideoId = resolveVideoId(nextNode?.data);

    if (!nextNode?.data || !nextVideoId) return;

    if (event.shiftKey) {
      const anchorIndex = typeof anchorNode?.rowIndex === 'number' ? anchorNode.rowIndex : nextIndex;
      const rangeIds = getRangeSelectionIds(api, anchorIndex, nextIndex);
      const nextSelection = buildExplicitSelectionState(rangeIds, anchorId || nextVideoId, nextVideoId);
      syncSelectedRows(nextSelection.ids);
      applySelectionState(nextSelection);
      onRowSelected(nextNode.data);
      api.ensureIndexVisible(nextIndex, 'middle');
      return;
    }

    const nextSelection = buildExplicitSelectionState([nextVideoId], nextVideoId, nextVideoId);
    syncSelectedRows(nextSelection.ids);
    applySelectionState(nextSelection);
    onRowSelected(nextNode.data);
    api.ensureIndexVisible(nextIndex, 'middle');
  }, [applySelectionState, buildExplicitSelectionState, clearGridSelection, getDisplayedChannelKeys, getDisplayedVideoIds, getRangeSelectionIds, isChannelScope, onChannelSelectionChange, onExcludeSelection, onMoveSelection, onRowSelected, selectedChannelKeys.length, selectedVideoCount, syncSelectedRows]);

  const handleCellContextMenu = useCallback((event: CellContextMenuEvent) => {
    if (isChannelScope) return;
    rootRef.current?.focus();
    const videoId = resolveVideoId(event.data);
    if (!videoId) return;

    event.event?.preventDefault?.();

    const alreadySelected = isAllVisibleSelected || explicitSelectedVideoIds.includes(videoId);
    const nextVideoIds = isAllVisibleSelected
      ? visibleVideoIds
      : (alreadySelected ? explicitSelectedVideoIds : [videoId]);

    if (!alreadySelected) {
      const nextSelection = buildExplicitSelectionState([videoId], videoId, videoId);
      syncSelectedRows(nextSelection.ids);
      applySelectionState(nextSelection);
      onRowSelected(event.data);
    }

    const nativeEvent = event.event as MouseEvent | undefined;
    setContextMenu({
      x: nativeEvent?.clientX ?? 0,
      y: nativeEvent?.clientY ?? 0,
      videoIds: nextVideoIds,
    });
  }, [applySelectionState, buildExplicitSelectionState, explicitSelectedVideoIds, isAllVisibleSelected, isChannelScope, onRowSelected, syncSelectedRows, visibleVideoIds]);

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
      onKeyDownCapture={handleGridKeyDown}
      onMouseDownCapture={() => rootRef.current?.focus()}
      className="relative h-full w-full focus:outline-none"
    >
      {!isChannelScope && isAllVisibleSelected && selectedVideoCount > 0 && (
        <div className="pointer-events-none absolute left-3 top-3 z-20 inline-flex items-center gap-2 border border-[var(--accent)] bg-[var(--bg-primary)] px-3 py-1 text-[11px] font-medium text-[var(--text-main)] shadow-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
          All visible rows selected ({selectedVideoCount.toLocaleString()})
        </div>
      )}

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
            onRowSelected={onRowSelectedHandler}
            onSelectionChanged={onSelectionChangedHandler}
            onFilterChanged={onFilterChangedHandler}
            onSortChanged={onSortChangedHandler}
            onColumnResized={onColumnResizedHandler}
            onCellClicked={onCellClicked}
            onCellContextMenu={handleCellContextMenu}
            rowSelection={{
              mode: 'multiRow',
              enableClickSelection: true,
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
