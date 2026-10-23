import { DatasetDashboardSnapshot, SavedViewDashboardSnapshot } from '../types';
import { resolveVideoTitle, resolveChannelName, resolveVideoId, isDurationColumn, formatDateDisplay } from './data';
import { BooleanMapSchema, ExplorerFilterModel, isTagLikeColumn } from './filterCoordinator';

export function createHistoryId(prefix = 'event') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

export function formatDurationLabel(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${remainder}s`;
  if (minutes > 0) return `${minutes}m ${remainder}s`;
  return `${remainder}s`;
}

export function summarizeFilterModel(filterModel: ExplorerFilterModel) {
  const entries = Object.entries(filterModel || {});
  if (!entries.length) return 'No active filters';
  return entries.map(([column, model]) => {
    const anyModel = model as any;
    if (anyModel?.selections && typeof anyModel.selections === 'object') {
      const parts = Object.entries(anyModel.selections).map(([key, state]) => `${key}:${state === 'true' ? 'yes' : 'no'}`).slice(0, 4);
      const total = Object.keys(anyModel.selections).length;
      const suffix = total > 4 ? ` (+${total - 4} more)` : '';
      return `${column}: ${parts.join(', ')}${suffix}`;
    }
    if (Array.isArray(anyModel?.values)) {
      const values = anyModel.values.map((value: any) => String(value)).slice(0, 4);
      const suffix = anyModel.values.length > 4 ? ` (+${anyModel.values.length - 4} more)` : '';
      return `${column}: [${values.join(', ')}]${suffix}`;
    }
    const operator = anyModel?.operator || anyModel?.type || 'contains';
    const value = anyModel?.value ?? anyModel?.filter ?? '';
    return `${column}: ${operator} ${String(value)}`;
  }).join(' | ');
}

export function formatVideoTitleChannelLabel(row: any) {
  const title = resolveVideoTitle(row).trim() || 'Untitled video';
  const channel = resolveChannelName(row).trim() || 'Unknown channel';
  return `${title} — ${channel}`;
}

export function buildAlphabetizedVideoTitleChannelList(rows: any[]) {
  const byVideoId = new Map<string, string>();
  rows.forEach((row) => {
    const videoId = resolveVideoId(row);
    if (!videoId || byVideoId.has(videoId)) return;
    byVideoId.set(videoId, formatVideoTitleChannelLabel(row));
  });
  return Array.from(byVideoId.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export function describeFilterModelEntry(column: string, model: any) {
  if (model?.selections && typeof model.selections === 'object') {
    const parts = Object.entries(model.selections).map(([key, state]) => `${key}: ${state === 'true' ? 'Yes' : 'No'}`).slice(0, 4);
    const total = Object.keys(model.selections).length;
    const suffix = total > 4 ? ` (+${total - 4} more)` : '';
    return `${parts.join(', ')}${suffix}`;
  }
  if (Array.isArray(model?.values)) {
    const values = model.values.map((value: any) => String(value)).slice(0, 4);
    const suffix = model.values.length > 4 ? ` (+${model.values.length - 4} more)` : '';
    return `${values.join(', ')}${suffix}`;
  }
  const operator = model?.operator || model?.type || 'contains';
  const value = model?.value ?? model?.filter ?? '';
  return `${operator} ${String(value)}`.trim();
}

export function resolveEditViewFilterKind(columnName: string, columnType: string, listLikeColumns: Set<string>, booleanMapColumns: Record<string, BooleanMapSchema> = {}) {
  if (booleanMapColumns[columnName]) return 'booleanMap' as const;
  if (isTagLikeColumn(columnName, columnType, listLikeColumns)) return 'tag' as const;
  if (isDurationColumn(columnName)) return 'duration' as const;
  const type = columnType.toLowerCase();
  const isNumeric = type.includes('int') || type.includes('double') || type.includes('float') || type.includes('decimal') || type.includes('numeric');
  return isNumeric ? 'number' as const : 'text' as const;
}

export function summarizeDashboardSnapshot(snapshot: DatasetDashboardSnapshot | SavedViewDashboardSnapshot | undefined) {
  if (!snapshot) return 'No entries recorded';
  const views = snapshot.stats.attention.medianViews ?? 0;
  const comments = snapshot.stats.comments.totalVideoComments ?? 0;
  const warnings = snapshot.stats.warnings.slice(0, 2);
  return [
    `Median views: ${Math.round(views).toLocaleString()}`,
    `Comments: ${Math.round(comments).toLocaleString()}`,
    warnings.length ? `Warnings: ${warnings.join(', ')}` : 'Warnings: none',
  ].join('\n');
}

export function parseDateLabel(timestamp: string | number | null | undefined) {
  if (!timestamp) return 'n/a';
  return formatDateDisplay(new Date(timestamp).toISOString());
}
