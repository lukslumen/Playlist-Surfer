import type { ColumnSchema } from '../types';
import type { OverviewDrilldown } from './dashboardTemplateTypes';
import type { ExplorerFilterModel } from './filterCoordinator';
import {
  findDashboardCategoryColumn,
  findDashboardDurationColumn,
  findDashboardLanguageColumn,
  findDashboardPublishedColumn,
  findDashboardViewsColumn,
} from './columnDefaults';
import { formatDurationDisplay } from './data';

const isoDay = (ts: number) => new Date(ts).toISOString().slice(0, 10);

/** Every column an overview drill-down can filter, so a new drill-down replaces the previous one. */
export function overviewDrilldownColumns(schema: ColumnSchema[]): string[] {
  return [
    findDashboardPublishedColumn(schema),
    findDashboardViewsColumn(schema),
    findDashboardDurationColumn(schema),
    findDashboardCategoryColumn(schema),
    findDashboardLanguageColumn(schema, 'audio'),
    findDashboardLanguageColumn(schema, 'declared'),
  ].filter((column): column is string => Boolean(column));
}

/**
 * The explorer filter for a click in the overview, written the way the filter popup shows it (dates as
 * YYYY-MM-DD, lengths as mm:ss), or null when the dataset has no matching column.
 */
export function buildOverviewDrilldownFilter(drilldown: OverviewDrilldown, schema: ColumnSchema[]): ExplorerFilterModel | null {
  switch (drilldown.kind) {
    case 'published': {
      const column = findDashboardPublishedColumn(schema);
      if (!column) return null;
      return { [column]: { filterKind: 'date', operator: 'between', value: `${isoDay(drilldown.startTs)}..${isoDay(drilldown.endTs)}` } };
    }
    case 'length': {
      const column = findDashboardDurationColumn(schema);
      if (!column) return null;
      const min = formatDurationDisplay(drilldown.min);
      return {
        [column]: drilldown.max === null
          ? { filterKind: 'duration', operator: 'gte', value: min }
          : { filterKind: 'duration', operator: 'between', value: `${min}..${formatDurationDisplay(drilldown.max)}` },
      };
    }
    case 'views': {
      const column = findDashboardViewsColumn(schema);
      if (!column) return null;
      return {
        [column]: drilldown.max === null
          ? { filterKind: 'number', operator: 'gte', value: String(drilldown.min) }
          : { filterKind: 'number', operator: 'between', value: `${drilldown.min}..${drilldown.max}` },
      };
    }
    case 'category': {
      const column = findDashboardCategoryColumn(schema);
      if (!column) return null;
      return { [column]: { values: [drilldown.value], matchMode: 'any' } } as ExplorerFilterModel;
    }
    case 'language': {
      const column = findDashboardLanguageColumn(schema, drilldown.source);
      if (!column) return null;
      return { [column]: { filterKind: 'text', operator: 'startsWith', value: drilldown.value } };
    }
  }
}
