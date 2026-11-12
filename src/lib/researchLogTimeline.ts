import type { ResearchHistoryEvent } from '../types';

// The research log's timeline: the researcher's notes and the actions the app recorded, as plain
// sentences, with undone and superseded actions netted out so the log shows what actually changed.

export type TimelineCategory = 'note' | 'data' | 'views' | 'analysis';

export interface TimelineEntry {
  /** The id of the event that represents the entry (the last one, when several were merged). */
  id: string;
  category: TimelineCategory;
  createdAt: string;
  /** One plain sentence. */
  title: string;
  /** Extra lines shown when the entry is expanded (filters, reasons, mappings). */
  details: string[];
  /** Videos the action applied to, for the expanded list. */
  videoIds: string[];
  /** The researcher's note: the text of a note entry, or a note attached to an action. */
  note?: string;
  /** Every event folded into this entry; attaching a note goes to `id`. */
  eventIds: string[];
  /** How many raw steps were folded in or cancelled out to produce this entry. */
  mergedSteps: number;
}

const CATEGORY: Partial<Record<ResearchHistoryEvent['type'], TimelineCategory>> = {
  note: 'note',
  import_replace_completed: 'data',
  import_merge_completed: 'data',
  videos_excluded: 'data',
  videos_restored: 'data',
  column_deleted: 'data',
  column_restored: 'data',
  columns_restored_all: 'data',
  source_deleted: 'data',
  source_visibility_toggled: 'data',
  source_visibility_bulk_changed: 'data',
  source_column_visibility_toggled: 'data',
  special_mapping_updated: 'data',
  tag_applied: 'data',
  saved_view_created: 'views',
  saved_view_deleted: 'views',
};

export function categoryOf(event: ResearchHistoryEvent): TimelineCategory {
  return CATEGORY[event.type] ?? 'analysis';
}

const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
const text = (value: unknown) => (value === null || value === undefined ? '' : String(value));
/** Term lists are stored newline-joined in event meta. */
const termList = (value: unknown): string[] | null => (typeof value === 'string' ? value.split('\n').filter(Boolean) : null);

/** Detail lines from an event's stored details, without the long manual-selection title lists. */
function detailLines(event: ResearchHistoryEvent): string[] {
  return text(event.details).split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('- ') && !/^Manually selected rows/.test(line));
}

/** A plain-language sentence for an event (videos counted from `videoIds`, which netting may shrink). */
export function describeEvent(event: ResearchHistoryEvent, videoIds: string[] = event.affectedIds ?? []): string {
  const meta = event.meta ?? {};
  const filter = text(meta.filterSummary);
  switch (event.type) {
    case 'note': return text(event.note || event.summary);
    case 'videos_excluded':
      return meta.selectionMode === 'filtered_bulk' && filter
        ? `Excluded ${plural(videoIds.length, 'video')} matching: ${filter}`
        : `Excluded ${plural(videoIds.length, 'video')} by hand`;
    case 'videos_restored': return `Restored ${plural(videoIds.length, 'video')} to the corpus`;
    case 'saved_view_created': {
      const count = Number(meta.videoCount);
      return `Saved view “${text(meta.viewName)}”${filter ? `: ${filter}` : ''}${Number.isFinite(count) && meta.videoCount !== undefined ? ` (${plural(count, 'video')})` : ''}`;
    }
    case 'saved_view_deleted': return `Deleted saved view “${text(meta.viewName)}”`;
    case 'column_deleted': return `Deleted the column “${text(meta.column)}”`;
    case 'column_restored': return `Restored the column “${text(meta.column)}”`;
    case 'linking_summary_generated':
    case 'linking_summary_refreshed': return `Generated the link summary from “${text(meta.sourceColumn)}”`;
    case 'linking_bucket_override_created':
    case 'linking_bucket_override_changed':
      return meta.domain ? `Moved ${text(meta.domain)} to the “${text(meta.newBaseBucket)}” bucket` : text(event.summary);
    case 'vernacular_terms_changed': {
      const now = termList(meta.hiddenTerms);
      const before = termList(meta.previousTerms);
      if (!now || !before) return text(event.summary).replace(/\.$/, '');
      const added = now.filter((term) => !before.includes(term));
      const removed = before.filter((term) => !now.includes(term));
      const parts = [added.length ? `hid ${added.join(', ')}` : '', removed.length ? `showed ${removed.join(', ')} again` : ''].filter(Boolean).join('; ');
      return `Vernacular analysis: ${parts || 'no change to the hidden terms'}`;
    }
    case 'dashboard_generated': return `Generated the dashboard for the ${text(meta.scopeLabel) || 'dataset'}`;
    default: return text(event.summary).replace(/\.$/, '');
  }
}

function entryFor(event: ResearchHistoryEvent, overrides: Partial<TimelineEntry> = {}): TimelineEntry {
  const videoIds = overrides.videoIds ?? event.affectedIds ?? [];
  return {
    id: event.id,
    category: categoryOf(event),
    createdAt: event.createdAt,
    title: describeEvent(event, videoIds),
    details: detailLines(event),
    videoIds,
    note: event.type === 'note' ? text(event.note || event.summary) : event.note,
    eventIds: [event.id],
    mergedSteps: 1,
    ...overrides,
  };
}

/**
 * Older projects recorded the field mappings chosen at import as a separate step right after the
 * import; fold them into the import's details.
 */
function foldImportMappings(events: ResearchHistoryEvent[]): ResearchHistoryEvent[] {
  const result: ResearchHistoryEvent[] = [];
  events.forEach((event) => {
    const previous = result[result.length - 1];
    if (event.type === 'special_mapping_updated' && /during (import|merge)/.test(event.summary)
      && previous && (previous.type === 'import_replace_completed' || previous.type === 'import_merge_completed')) {
      result[result.length - 1] = { ...previous, details: [text(previous.details), `Fields used: ${text(event.details)}`].filter(Boolean).join('\n') };
      return;
    }
    result.push(event);
  });
  return result;
}

/** Every recorded event as its own entry, undone ones included: the "show all steps" view. */
export function rawTimeline(events: ResearchHistoryEvent[]): TimelineEntry[] {
  return foldImportMappings(events).map((event) => entryFor(event, event.reverted ? { title: `${describeEvent(event)} (undone)` } : {}));
}

/**
 * The net timeline:
 * - undone events are dropped;
 * - exclusions and restores cancel out per video (exclude 12 then restore 3 of them = excluded 9;
 *   exclude 5 then restore those 5 = nothing);
 * - a saved view that was later deleted disappears together with its deletion;
 * - a column deleted and then restored disappears; domain overrides and repeated generations
 *   (link summaries, dashboards, mappings, hidden terms) collapse to their latest state.
 * Notes attached to dropped events are kept on the entry that replaces them.
 */
export function netTimeline(events: ResearchHistoryEvent[]): TimelineEntry[] {
  const live = foldImportMappings(events.filter((event) => !event.reverted).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)));
  const dropped = new Set<string>();
  // Superseded events and the later event that replaces them, with how many steps each entry folds in.
  const absorbedInto = new Map<string, string>();
  const steps = new Map<string, number>();
  const absorb = (from: ResearchHistoryEvent, into: ResearchHistoryEvent) => {
    dropped.add(from.id);
    absorbedInto.set(from.id, into.id);
    steps.set(into.id, (steps.get(into.id) ?? 1) + (steps.get(from.id) ?? 1));
  };
  const finalTarget = (id: string): string => {
    let current = id;
    while (absorbedInto.has(current)) current = absorbedInto.get(current)!;
    return current;
  };

  // Exclusions and restores, per video. Each exclusion keeps the videos that are still excluded.
  const remaining = new Map<string, Set<string>>();
  const excludedBy = new Map<string, string>();
  live.forEach((event) => {
    if (event.type === 'videos_excluded') {
      const ids = new Set(event.affectedIds ?? []);
      remaining.set(event.id, ids);
      ids.forEach((videoId) => excludedBy.set(videoId, event.id));
    } else if (event.type === 'videos_restored') {
      const ids = new Set(event.affectedIds ?? []);
      ids.forEach((videoId) => {
        const exclusion = excludedBy.get(videoId);
        if (!exclusion) return;
        remaining.get(exclusion)?.delete(videoId);
        ids.delete(videoId);
        excludedBy.delete(videoId);
      });
      remaining.set(event.id, ids);
    }
  });

  // Saved views created and later deleted; columns deleted and later restored.
  const viewCreated = new Map<string, ResearchHistoryEvent>();
  const columnDeleted = new Map<string, ResearchHistoryEvent>();
  const latestBy = new Map<string, ResearchHistoryEvent>();
  const firstBy = new Map<string, ResearchHistoryEvent>();
  live.forEach((event) => {
    const meta = event.meta ?? {};
    if (event.type === 'saved_view_created' && meta.viewId) viewCreated.set(text(meta.viewId), event);
    if (event.type === 'saved_view_deleted' && meta.viewId && viewCreated.has(text(meta.viewId))) {
      dropped.add(event.id);
      dropped.add(viewCreated.get(text(meta.viewId))!.id);
    }
    if (event.type === 'column_deleted' && meta.column) columnDeleted.set(text(meta.column), event);
    if (event.type === 'column_restored' && meta.column && columnDeleted.has(text(meta.column))) {
      dropped.add(event.id);
      dropped.add(columnDeleted.get(text(meta.column))!.id);
      columnDeleted.delete(text(meta.column));
    }
    if (event.type === 'columns_restored_all') {
      columnDeleted.forEach((deletion) => dropped.add(deletion.id));
      columnDeleted.clear();
    }

    // Things that only matter in their latest state.
    const key = (() => {
      switch (event.type) {
        case 'linking_source_selected':
        case 'linking_summary_generated':
        case 'linking_summary_refreshed': return 'linking-summary';
        case 'linking_bucket_override_created':
        case 'linking_bucket_override_changed':
        case 'linking_bucket_override_reverted': return meta.domain ? `override:${text(meta.domain)}` : null;
        case 'dashboard_generated': return `dashboard:${text(meta.scope)}`;
        case 'dashboard_snapshots_recalculated': return 'dashboard:all';
        case 'special_mapping_updated': return 'mapping';
        case 'vernacular_terms_changed': return 'hidden-terms';
        case 'channel_linking_refreshed': return 'channel-linking';
        case 'source_visibility_toggled':
        case 'source_column_visibility_toggled': return `visibility:${event.type}:${text(meta.sourceId)}:${text(meta.scope)}`;
        default: return null;
      }
    })();
    if (key) {
      const previous = latestBy.get(key);
      if (previous) absorb(previous, event);
      else firstBy.set(key, event);
      latestBy.set(key, event);
    }
  });

  // Hidden terms: show the change from before the first edit to after the last, or nothing if they match.
  const rewritten = new Map<string, ResearchHistoryEvent>();
  const firstTerms = firstBy.get('hidden-terms');
  const lastTerms = latestBy.get('hidden-terms');
  const beforeTerms = termList(firstTerms?.meta?.previousTerms);
  const afterTerms = termList(lastTerms?.meta?.hiddenTerms);
  if (firstTerms && lastTerms && beforeTerms && afterTerms) {
    const before = new Set(beforeTerms);
    if (before.size === new Set(afterTerms).size && afterTerms.every((term) => before.has(term))) dropped.add(lastTerms.id);
    else rewritten.set(lastTerms.id, { ...lastTerms, meta: { ...lastTerms.meta, previousTerms: firstTerms.meta!.previousTerms } });
  }

  // An override reverted back to automatic leaves nothing behind.
  latestBy.forEach((event, key) => {
    if (key.startsWith('override:') && event.type === 'linking_bucket_override_reverted') dropped.add(event.id);
  });
  // Visibility toggled an even number of times is back where it started.
  const toggles = new Map<string, number>();
  live.forEach((event) => {
    if (event.type !== 'source_visibility_toggled' && event.type !== 'source_column_visibility_toggled') return;
    const key = `${event.type}:${text(event.meta?.sourceId)}:${text(event.meta?.scope)}`;
    toggles.set(key, (toggles.get(key) ?? 0) + 1);
  });
  latestBy.forEach((event, key) => {
    if (key.startsWith('visibility:') && (toggles.get(key.slice('visibility:'.length)) ?? 0) % 2 === 0) dropped.add(event.id);
  });

  // Notes on superseded events move to the entry that replaced them; notes on cancelled-out events
  // stay as notes of their own, so nothing the researcher wrote is lost.
  const isGone = (event: ResearchHistoryEvent) => {
    const ids = remaining.get(event.id);
    return dropped.has(event.id) || (ids !== undefined && ids.size === 0);
  };
  const carriedNotes = new Map<string, string[]>();
  live.forEach((event) => {
    if (!isGone(event) || !event.note?.trim() || !absorbedInto.has(event.id)) return;
    const target = finalTarget(event.id);
    carriedNotes.set(target, [...(carriedNotes.get(target) ?? []), event.note.trim()]);
  });
  return live.flatMap((event): TimelineEntry[] => {
    if (isGone(event)) {
      const target = absorbedInto.has(event.id) ? finalTarget(event.id) : null;
      const targetSurvives = target ? !isGone(live.find((entry) => entry.id === target)!) : false;
      if (event.note?.trim() && !targetSurvives) {
        return [{ ...entryFor(event), category: 'note', title: `Note on an undone step (${describeEvent(event)})`, note: event.note.trim(), videoIds: [] }];
      }
      return [];
    }
    const ids = remaining.get(event.id);
    const videoIds = ids ? [...ids] : event.affectedIds ?? [];
    const partlyUndone = ids !== undefined && (event.affectedIds?.length ?? 0) !== ids.size;
    const notes = [event.note?.trim(), ...(carriedNotes.get(event.id) ?? [])].filter(Boolean) as string[];
    return [entryFor(rewritten.get(event.id) ?? event, {
      videoIds,
      note: event.type === 'note' ? text(event.note || event.summary) : (notes.length ? notes.join('\n\n') : undefined),
      mergedSteps: (steps.get(event.id) ?? 1) + (partlyUndone ? 1 : 0),
    })];
  });
}

/** Entries grouped by local calendar day, newest day first and newest entry first within a day. */
export function groupByDay(entries: TimelineEntry[], now = new Date()): Array<{ key: string; label: string; entries: TimelineEntry[] }> {
  const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const groups = new Map<string, TimelineEntry[]>();
  [...entries].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).forEach((entry) => {
    const key = dayKey(new Date(entry.createdAt));
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  });
  return [...groups.entries()].map(([key, list]) => ({
    key,
    label: key === today ? 'Today' : key === yesterday ? 'Yesterday' : new Date(list[0].createdAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
    entries: list,
  }));
}

/**
 * The old free-text diary as note entries: one per "## <date>" or "### <date>" heading block, dated
 * from the heading when it parses, otherwise `fallbackDate`.
 */
export function diaryToNotes(diary: string, fallbackDate: string): Array<{ createdAt: string; note: string }> {
  const lines = String(diary || '').replace(/\r\n/g, '\n').split('\n');
  const blocks: Array<{ heading: string | null; body: string[] }> = [];
  let current: { heading: string | null; body: string[] } = { heading: null, body: [] };
  lines.forEach((line) => {
    const heading = /^#{1,4}\s+(.+?)\s*$/.exec(line);
    if (heading) {
      if (current.heading !== null || current.body.some((entry) => entry.trim())) blocks.push(current);
      current = { heading: heading[1], body: [] };
    } else current.body.push(line);
  });
  if (current.heading !== null || current.body.some((entry) => entry.trim())) blocks.push(current);
  return blocks.flatMap((block) => {
    const body = block.body.join('\n').trim();
    if (/^research diary$/i.test(block.heading ?? '') && !body) return [];
    const parsed = block.heading ? Date.parse(block.heading) : Number.NaN;
    const note = Number.isFinite(parsed) ? body : [block.heading, body].filter(Boolean).join('\n');
    if (!note.trim()) return [];
    return [{ createdAt: Number.isFinite(parsed) ? new Date(parsed + 12 * 3600_000).toISOString() : fallbackDate, note: note.trim() }];
  });
}
