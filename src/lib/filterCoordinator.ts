import { ColumnSchema } from '../types';
import { isDateLikeColumn, parseDurationToSeconds, TRANSCRIPT_COLUMN } from './data';

export const parseListString = (val: any): string[] => {
  if (val === null || val === undefined) return [];
  if (Array.isArray(val)) return val.map((v) => String(v).trim()).filter(Boolean);
  if (typeof val !== 'string') return [String(val).trim()].filter(Boolean);

  const trimmed = val.trim();
  if (!trimmed || trimmed === '[]') return [];

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v).trim()).filter(Boolean);
      }
    } catch {
      return trimmed
        .slice(1, -1)
        .split(',')
        .map((v) => v.trim().replace(/^["']|["']$/g, '').trim())
        .filter(Boolean);
    }
  }

  return trimmed
    .split(/[|,;]/)
    .map((v) => v.trim().replace(/^["']|["']$/g, '').trim())
    .filter(Boolean);
};

export type TagFilterModel = {
  values: string[];
  matchMode: 'any' | 'all' | 'only';
};

export type BooleanMapSelectionState = 'true' | 'false';
export type BooleanMapFilterModel = {
  selections: Record<string, BooleanMapSelectionState>;
};

export type BooleanMapSchema = {
  column: string;
  keys: string[];
  labels: Record<string, string>;
  quickKeys: string[];
};

export type GenericFilterKind = 'text' | 'number' | 'duration' | 'date';
export type GenericTextOperator = 'contains' | 'equals' | 'startsWith' | 'endsWith';
export type GenericNumericOperator = 'eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between';
export type GenericFilterModel = {
  filterKind: GenericFilterKind;
  operator: GenericTextOperator | GenericNumericOperator;
  value: string;
};

export type ExplorerColumnFilterModel = GenericFilterModel | TagFilterModel | BooleanMapFilterModel | null;
export type ExplorerFilterModel = Record<string, ExplorerColumnFilterModel>;

type CompiledPredicate = (row: any) => boolean;

function toDisplayLabel(key: string) {
  const spaced = String(key || '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
  if (!spaced) return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function parseBooleanMapValue(value: any): Record<string, boolean | null> | null {
  if (value == null) return null;
  let parsed: any = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || !trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const entries = Object.entries(parsed);
  if (!entries.length) return null;

  const normalized: Record<string, boolean | null> = {};
  for (const [key, raw] of entries) {
    if (typeof raw === 'boolean') {
      normalized[key] = raw;
      continue;
    }
    if (raw == null || raw === '') {
      normalized[key] = null;
      continue;
    }
    return null;
  }
  return normalized;
}

export function detectBooleanMapColumns(rows: any[], schema: ColumnSchema[]): Record<string, BooleanMapSchema> {
  const sampleRows = rows.slice(0, 250);
  const result: Record<string, BooleanMapSchema> = {};

  schema.forEach((col) => {
    const parsedSamples = sampleRows
      .map((row) => parseBooleanMapValue(row?.[col.column_name]))
      .filter((value): value is Record<string, boolean | null> => !!value);

    if (parsedSamples.length < Math.min(8, Math.max(3, Math.floor(sampleRows.length * 0.15)))) return;

    const keyCounts: Record<string, number> = {};
    let validValueCount = 0;
    let totalValueCount = 0;
    parsedSamples.forEach((sample) => {
      Object.entries(sample).forEach(([key, value]) => {
        keyCounts[key] = (keyCounts[key] || 0) + 1;
        totalValueCount += 1;
        if (typeof value === 'boolean' || value === null) validValueCount += 1;
      });
    });

    const commonKeys = Object.entries(keyCounts)
      .filter(([, count]) => count >= Math.max(2, Math.ceil(parsedSamples.length * 0.5)))
      .map(([key]) => key)
      .sort((a, b) => a.localeCompare(b));

    if (commonKeys.length < 2 || commonKeys.length > 30) return;
    if (totalValueCount === 0 || validValueCount / totalValueCount < 0.85) return;

    const labels = Object.fromEntries(commonKeys.map((key) => [key, toDisplayLabel(key)]));
    const quickKeys = commonKeys.slice(0, 8);
    result[col.column_name] = {
      column: col.column_name,
      keys: commonKeys,
      labels,
      quickKeys,
    };
  });

  return result;
}

export function detectListLikeColumns(rows: any[], schema: ColumnSchema[], booleanMapColumns: Record<string, BooleanMapSchema> = {}) {
  const sampleRows = rows.slice(0, 200);
  return new Set(
    schema
      .filter((col) => !booleanMapColumns[col.column_name])
      .filter((col) => sampleRows.some((row) => {
        const value = row?.[col.column_name];
        if (Array.isArray(value)) return true;
        return typeof value === 'string' && value.trim().startsWith('[') && value.trim().endsWith(']');
      }))
      .map((col) => col.column_name),
  );
}

export function isTagLikeColumn(columnName: string, columnType: string, listLikeColumns: Set<string>) {
  const name = columnName.toLowerCase();
  const type = columnType.toLowerCase();
  const isGeneratedLinkTagColumn = [
    'content_intent',
    'linking_base_labels',
    'linking_recipe',
    'linking_top_domains',
    'linking_raw_links',
    'linking_raw_domains',
  ].includes(name);
  return columnName !== TRANSCRIPT_COLUMN && (
    isGeneratedLinkTagColumn ||
    type.includes('[]') ||
    name.includes('tag') ||
    name.includes('reason') ||
    name.includes('category') ||
    name.includes('community') ||
    name.includes('topic') ||
    name.includes('label') ||
    name.includes('intent') ||
    name.includes('practice') ||
    listLikeColumns.has(columnName)
  );
}

export function normalizeTextOperator(value: string | undefined): GenericTextOperator {
  if (value === 'equals' || value === 'startsWith' || value === 'endsWith') return value;
  return 'contains';
}

export function normalizeNumericOperator(value: string | undefined): GenericNumericOperator {
  switch (value) {
    case 'equals':
    case 'eq':
      return 'eq';
    case 'greaterThan':
    case 'gt':
      return 'gt';
    case 'greaterThanOrEqual':
    case 'gte':
      return 'gte';
    case 'lessThan':
    case 'lt':
      return 'lt';
    case 'lessThanOrEqual':
    case 'lte':
      return 'lte';
    case 'between':
      return 'between';
    default:
      return 'eq';
  }
}

export function normalizeGenericModel(model: any, filterKind: GenericFilterKind): GenericFilterModel | null {
  if (!model) return null;

  if ('filterKind' in model && 'operator' in model) {
    return {
      filterKind,
      operator: model.operator,
      value: model.value ?? '',
    } as GenericFilterModel;
  }

  if (filterKind === 'text' && model.filterType === 'text') {
    return {
      filterKind: 'text',
      operator: normalizeTextOperator(model.type),
      value: model.filter == null ? '' : String(model.filter),
    };
  }

  if ((filterKind === 'number' || filterKind === 'duration' || filterKind === 'date') && (model.filterType === 'number' || model.filterType === 'date' || model.filterType === 'text')) {
    const value = model.filter ?? model.dateFrom ?? model.value ?? '';
    return {
      filterKind,
      operator: normalizeNumericOperator(model.type),
      value: value == null ? '' : String(value),
    };
  }

  return null;
}

export function normalizeTagModel(model: any): TagFilterModel | null {
  if (!model || !Array.isArray(model.values) || model.values.length === 0) return null;
  return {
    values: model.values.map((value: any) => String(value)).filter(Boolean),
    matchMode: model.matchMode === 'all' ? 'all' : (model.matchMode === 'only' ? 'only' : 'any'),
  };
}

export function normalizeBooleanMapModel(model: any): BooleanMapFilterModel | null {
  if (!model || typeof model !== 'object') return null;
  const rawSelections = model.selections && typeof model.selections === 'object' ? model.selections : null;
  if (!rawSelections) return null;
  const selections = Object.fromEntries(
    Object.entries(rawSelections)
      .filter(([, value]) => value === 'true' || value === 'false')
      .map(([key, value]) => [String(key), value]),
  ) as Record<string, BooleanMapSelectionState>;
  if (!Object.keys(selections).length) return null;
  return { selections };
}

function compareText(operator: GenericTextOperator, sourceValue: string, filterValue: string) {
  const source = sourceValue.toLowerCase();
  const target = filterValue.toLowerCase();
  switch (operator) {
    case 'equals':
      return source === target;
    case 'startsWith':
      return source.startsWith(target);
    case 'endsWith':
      return source.endsWith(target);
    case 'contains':
    default:
      return source.includes(target);
  }
}

function compareNumbers(operator: GenericNumericOperator, sourceValue: number, filterValue: number) {
  switch (operator) {
    case 'gt':
      return sourceValue > filterValue;
    case 'gte':
      return sourceValue >= filterValue;
    case 'lt':
      return sourceValue < filterValue;
    case 'lte':
      return sourceValue <= filterValue;
    case 'eq':
    default:
      return sourceValue === filterValue;
  }
}

function compareBetween(sourceValue: number, rawRange: string) {
  const [rawMin, rawMax] = String(rawRange || '').split('..');
  const minValue = Number(rawMin);
  const maxValue = Number(rawMax);
  if (Number.isNaN(minValue) || Number.isNaN(maxValue)) return false;
  return sourceValue >= minValue && sourceValue < maxValue;
}



function parseDateToTimestamp(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? value : (value > 1e9 ? value * 1000 : value);
  }
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    const numeric = Number(text);
    if (!Number.isFinite(numeric)) return null;
    return numeric > 1e12 ? numeric : (numeric > 1e9 ? numeric * 1000 : numeric);
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : parsed;
}

function resolveFilterKind(column: ColumnSchema, listLikeColumns: Set<string>, booleanMapColumns: Record<string, BooleanMapSchema>): GenericFilterKind | 'tag' | 'booleanMap' {
  if (booleanMapColumns[column.column_name]) return 'booleanMap';
  if (isTagLikeColumn(column.column_name, column.column_type, listLikeColumns)) return 'tag';
  const type = column.column_type.toLowerCase();
  const isNumeric = type.includes('int') || type.includes('double') || type.includes('float') || type.includes('decimal');
  const isDuration = column.column_name.toLowerCase().includes('duration');
  const isDate = isDateLikeColumn(column.column_name, column.column_type);
  if (isDuration) return 'duration';
  if (isDate) return 'date';
  if (isNumeric) return 'number';
  return 'text';
}

function buildPredicate(
  column: ColumnSchema,
  rawModel: ExplorerColumnFilterModel,
  listLikeColumns: Set<string>,
  booleanMapColumns: Record<string, BooleanMapSchema>,
): CompiledPredicate | null {
  const filterKind = resolveFilterKind(column, listLikeColumns, booleanMapColumns);
  if (filterKind === 'booleanMap') {
    const model = normalizeBooleanMapModel(rawModel);
    if (!model) return null;
    return (row: any) => {
      const parsed = parseBooleanMapValue(row?.[column.column_name]);
      if (!parsed) return false;
      return Object.entries(model.selections).every(([key, requirement]) => {
        const value = parsed[key];
        if (requirement === 'true') return value === true;
        return value === false;
      });
    };
  }

  if (filterKind === 'tag') {
    const model = normalizeTagModel(rawModel);
    if (!model) return null;
    return (row: any) => {
      const itemValues = parseListString(row?.[column.column_name]);
      if (model.values.length === 0) return true;
      if (itemValues.length === 0) return false;
      if (model.matchMode === 'all') {
        return model.values.every((value) => itemValues.includes(value));
      }
      if (model.matchMode === 'only') {
        const selected = new Set(model.values);
        const actual = Array.from(new Set(itemValues));
        return actual.length === selected.size && actual.every((value) => selected.has(value));
      }
      return model.values.some((value) => itemValues.includes(value));
    };
  }

  const model = normalizeGenericModel(rawModel, filterKind);
  if (!model || !String(model.value ?? '').trim()) return null;

  if (filterKind === 'text') {
    return (row: any) => {
      const rawValue = row?.[column.column_name];
      const sourceValue = rawValue == null ? '' : String(rawValue);
      return compareText(model.operator as GenericTextOperator, sourceValue, model.value);
    };
  }

  return (row: any) => {
    const rawValue = row?.[column.column_name];
    const parsedFilterValue = filterKind === 'duration'
      ? parseDurationToSeconds(model.value)
      : filterKind === 'date'
        ? parseDateToTimestamp(model.value)
        : Number(model.value);
    const parsedSourceValue = filterKind === 'duration'
      ? parseDurationToSeconds(rawValue)
      : filterKind === 'date'
        ? parseDateToTimestamp(rawValue)
        : Number(rawValue);

    if (rawValue === null || rawValue === undefined || parsedSourceValue === null || Number.isNaN(parsedSourceValue)) {
      return false;
    }

    if (model.operator === 'between') {
      return compareBetween(Number(parsedSourceValue), model.value);
    }

    if (parsedFilterValue === null || Number.isNaN(parsedFilterValue)) {
      return false;
    }

    return compareNumbers(model.operator as GenericNumericOperator, Number(parsedSourceValue), Number(parsedFilterValue));
  };
}

export function sanitizeFilterModel(rawModel: Record<string, any> | null | undefined) {
  if (!rawModel) return {} as ExplorerFilterModel;
  const nextEntries = Object.entries(rawModel).filter(([, model]) => {
    if (!model) return false;
    if (Array.isArray((model as any).values)) return (model as any).values.length > 0;
    if ((model as any).selections && typeof (model as any).selections === 'object') return Object.keys((model as any).selections).length > 0;
    const value = (model as any).value ?? (model as any).filter ?? '';
    return String(value).trim().length > 0;
  });
  return Object.fromEntries(nextEntries) as ExplorerFilterModel;
}

export function buildUnifiedFilterState(args: {
  rows: any[];
  schema: ColumnSchema[];
  filterModel: Record<string, any> | null | undefined;
  listLikeColumns: Set<string>;
  booleanMapColumns?: Record<string, BooleanMapSchema>;
}) {
  const sanitizedFilterModel = sanitizeFilterModel(args.filterModel);
  const schemaByColumn = new Map(args.schema.map((column) => [column.column_name, column]));
  const booleanMapColumns = args.booleanMapColumns || {};
  const predicateEntries = Object.entries(sanitizedFilterModel)
    .map(([columnName, model]) => {
      const column = schemaByColumn.get(columnName);
      if (!column) return null;
      const predicate = buildPredicate(column, model, args.listLikeColumns, booleanMapColumns);
      return predicate ? ([columnName, predicate] as const) : null;
    })
    .filter((entry): entry is readonly [string, CompiledPredicate] => !!entry);

  const filteredRows = predicateEntries.length === 0
    ? args.rows
    : args.rows.filter((row) => predicateEntries.every(([, predicate]) => predicate(row)));

  const tagValueIndexByColumn: Record<string, string[]> = {};
  const tagColumns = args.schema.filter((column) => !booleanMapColumns[column.column_name] && isTagLikeColumn(column.column_name, column.column_type, args.listLikeColumns));

  tagColumns.forEach((column) => {
    const otherPredicates = predicateEntries.filter(([columnName]) => columnName !== column.column_name);
    const values = new Set<string>();
    const candidateRows = otherPredicates.length === predicateEntries.length ? filteredRows : args.rows.filter((row) => otherPredicates.every(([, predicate]) => predicate(row)));
    candidateRows.forEach((row) => {
      parseListString(row?.[column.column_name]).forEach((value) => values.add(value));
    });
    tagValueIndexByColumn[column.column_name] = Array.from(values).sort((a, b) => a.localeCompare(b));
  });

  return {
    filterModel: sanitizedFilterModel,
    filteredRows,
    filteredColumns: Object.keys(sanitizedFilterModel),
    tagValueIndexByColumn,
  };
}
