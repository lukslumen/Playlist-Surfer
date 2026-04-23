import { TimestampRef } from '../types';

const TIMESTAMP_SECTION_HEADINGS = new Set(['timestamp annotations', 'timestamps']);
const FREEFORM_SECTION_HEADING = 'freeform notes';
const TOP_LEVEL_HEADING_RE = /^##\s+(.+?)\s*$/;
const TIMESTAMP_HEADING_RE = /^###\s+\[([0-9]{1,3}:[0-9]{2}(?::[0-9]{2})?)\]\s*$/;
const LEGACY_TIMESTAMP_RE = /^-\s*\[?([0-9]{1,3}:[0-9]{2}(?::[0-9]{2})?)\]?\s*$/;

interface TopLevelSection {
  heading: string;
  normalizedHeading: string;
  startLine: number;
  endLine: number;
}

interface RawTimestampEntry {
  seconds: number;
  body: string;
  parsedOrder: number;
  headingStart: number;
  headingLineLength: number;
}

export interface TimestampNoteEntry {
  id: string;
  time_seconds: number;
  time_label: string;
  heading: string;
  body: string;
  preview: string;
  createdAt: number;
  occurrence: number;
  headingStart: number;
  headingLineLength: number;
}

export interface ParsedTimestampDocument {
  entries: TimestampNoteEntry[];
  timestampRefs: TimestampRef[];
  hasFreeformSection: boolean;
  withoutTimestampSections: string;
}

export interface InsertTimestampAtPlayheadResult {
  notes: string;
  entries: TimestampNoteEntry[];
  timestampRefs: TimestampRef[];
  targetId: string;
  inserted: boolean;
  cursorPosition: number | null;
}

export interface RemoveTimestampByIdResult {
  notes: string;
  entries: TimestampNoteEntry[];
  timestampRefs: TimestampRef[];
  removed: boolean;
  removedEntry: TimestampNoteEntry | null;
}

function normalizeHeading(value: string) {
  return value.trim().toLowerCase();
}

function parseTimestampToken(value: string): number | null {
  const token = String(value || '').trim();
  if (!token) return null;
  const parts = token.split(':').map((part) => part.trim());
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) return null;
  if (parts.length === 2) {
    const minutes = Number(parts[0]);
    const seconds = Number(parts[1]);
    if (seconds > 59) return null;
    return Math.max(0, (minutes * 60) + seconds);
  }
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  const seconds = Number(parts[2]);
  if (minutes > 59 || seconds > 59) return null;
  return Math.max(0, (hours * 3600) + (minutes * 60) + seconds);
}

function normalizeTimestampLabel(seconds: number, durationSeconds?: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;
  const useHours = hours > 0 || (durationSeconds ?? 0) >= 3600;
  if (useHours) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function normalizeRefSeconds(ref: TimestampRef) {
  if (Number.isFinite(ref.seconds)) return Math.max(0, Math.floor(ref.seconds));
  const parsed = parseTimestampToken(ref.label.replace(/[\[\]]/g, ''));
  return parsed ?? 0;
}

function buildLineOffsets(lines: string[]) {
  const offsets: number[] = [];
  let running = 0;
  lines.forEach((line) => {
    offsets.push(running);
    running += line.length + 1;
  });
  return offsets;
}

function getTopLevelSections(lines: string[]) {
  const sections: TopLevelSection[] = [];
  let active: TopLevelSection | null = null;

  lines.forEach((line, index) => {
    const match = line.match(TOP_LEVEL_HEADING_RE);
    if (!match) return;
    if (active) active.endLine = index;
    active = {
      heading: match[1].trim(),
      normalizedHeading: normalizeHeading(match[1]),
      startLine: index,
      endLine: lines.length,
    };
    sections.push(active);
  });

  return sections;
}

function stripTimestampSections(lines: string[], sections: TopLevelSection[]) {
  const timestampRanges = sections
    .filter((section) => TIMESTAMP_SECTION_HEADINGS.has(section.normalizedHeading))
    .map((section) => ({ startLine: section.startLine, endLine: section.endLine }));

  if (!timestampRanges.length) return lines.join('\n');

  const keptLines: string[] = [];
  lines.forEach((line, index) => {
    const inTimestampRange = timestampRanges.some((range) => index >= range.startLine && index < range.endLine);
    if (!inTimestampRange) keptLines.push(line);
  });
  return keptLines.join('\n');
}

function extractRawTimestampEntries(notes: string) {
  const lines = notes.split('\n');
  const lineOffsets = buildLineOffsets(lines);
  const sections = getTopLevelSections(lines);
  const rawEntries: RawTimestampEntry[] = [];
  let parsedOrder = 0;

  sections
    .filter((section) => TIMESTAMP_SECTION_HEADINGS.has(section.normalizedHeading))
    .forEach((section) => {
      let current: Omit<RawTimestampEntry, 'body'> & { bodyLines: string[] } | null = null;

      const flushCurrent = () => {
        if (!current) return;
        rawEntries.push({
          seconds: current.seconds,
          parsedOrder: current.parsedOrder,
          headingStart: current.headingStart,
          headingLineLength: current.headingLineLength,
          body: current.bodyLines.join('\n').replace(/\s+$/, ''),
        });
        current = null;
      };

      for (let lineIndex = section.startLine + 1; lineIndex < section.endLine; lineIndex += 1) {
        const line = lines[lineIndex] ?? '';
        const headingMatch = line.match(TIMESTAMP_HEADING_RE);
        if (headingMatch) {
          const parsed = parseTimestampToken(headingMatch[1]);
          if (parsed === null) continue;
          flushCurrent();
          current = {
            seconds: parsed,
            parsedOrder,
            headingStart: lineOffsets[lineIndex] ?? 0,
            headingLineLength: line.length,
            bodyLines: [],
          };
          parsedOrder += 1;
          continue;
        }

        const legacyMatch = line.match(LEGACY_TIMESTAMP_RE);
        if (legacyMatch) {
          const parsed = parseTimestampToken(legacyMatch[1]);
          if (parsed === null) continue;
          flushCurrent();
          current = {
            seconds: parsed,
            parsedOrder,
            headingStart: lineOffsets[lineIndex] ?? 0,
            headingLineLength: line.length,
            bodyLines: [],
          };
          parsedOrder += 1;
          continue;
        }

        if (current) current.bodyLines.push(line);
      }

      flushCurrent();
    });

  const hasFreeformSection = sections.some((section) => section.normalizedHeading === FREEFORM_SECTION_HEADING);
  const withoutTimestampSections = stripTimestampSections(lines, sections);

  return { rawEntries, hasFreeformSection, withoutTimestampSections };
}

function groupRefsBySecond(timestampRefs: TimestampRef[]) {
  const grouped = new Map<number, TimestampRef[]>();
  const sortedRefs = [...timestampRefs].sort((a, b) => (normalizeRefSeconds(a) - normalizeRefSeconds(b)) || (a.createdAt - b.createdAt));
  sortedRefs.forEach((ref) => {
    const seconds = normalizeRefSeconds(ref);
    const bucket = grouped.get(seconds) || [];
    bucket.push(ref);
    grouped.set(seconds, bucket);
  });
  return grouped;
}

function createTimestampId() {
  return `ts_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function reconcileEntries(
  rawEntries: RawTimestampEntry[],
  timestampRefs: TimestampRef[],
  durationSeconds?: number,
): TimestampNoteEntry[] {
  const refsBySecond = groupRefsBySecond(timestampRefs);
  const sortedBySecond = [...rawEntries].sort((a, b) => (a.seconds - b.seconds) || (a.parsedOrder - b.parsedOrder));
  const occurrenceByRawOrder = new Map<number, number>();
  const occurrenceCounter = new Map<number, number>();

  sortedBySecond.forEach((entry) => {
    const current = occurrenceCounter.get(entry.seconds) ?? 0;
    occurrenceByRawOrder.set(entry.parsedOrder, current);
    occurrenceCounter.set(entry.seconds, current + 1);
  });

  const now = Date.now();
  const reconciled = rawEntries.map((entry, index) => {
    const occurrence = occurrenceByRawOrder.get(entry.parsedOrder) ?? 0;
    const match = refsBySecond.get(entry.seconds)?.[occurrence] || null;
    const timeLabel = normalizeTimestampLabel(entry.seconds, durationSeconds);
    const heading = `### [${timeLabel}]`;
    return {
      id: match?.id || createTimestampId(),
      time_seconds: entry.seconds,
      time_label: timeLabel,
      heading,
      body: entry.body,
      preview: buildMarkerPreview(entry.body),
      createdAt: match?.createdAt || (now + index),
      occurrence,
      headingStart: entry.headingStart,
      headingLineLength: heading.length,
    } satisfies TimestampNoteEntry;
  });

  return reconciled.sort((a, b) => (a.time_seconds - b.time_seconds) || (a.createdAt - b.createdAt));
}

function buildTimestampSection(entries: TimestampNoteEntry[]) {
  const sectionParts = ['## Timestamp annotations'];
  entries.forEach((entry) => {
    sectionParts.push('');
    sectionParts.push(entry.heading);
    if (entry.body.length > 0) {
      sectionParts.push(entry.body.replace(/\s+$/, ''));
    }
  });
  return sectionParts.join('\n').replace(/\s+$/, '');
}

function ensureFreeformSection(notesWithoutTimestamp: string) {
  if (new RegExp(`^##\\s+${FREEFORM_SECTION_HEADING}\\s*$`, 'im').test(notesWithoutTimestamp)) {
    return notesWithoutTimestamp;
  }

  const trimmed = notesWithoutTimestamp.replace(/\s+$/, '');
  if (!trimmed) return '## Freeform notes\n';
  if (trimmed.endsWith('\n')) return `${trimmed}\n## Freeform notes\n`;
  return `${trimmed}\n\n## Freeform notes\n`;
}

function refsFromEntries(entries: TimestampNoteEntry[]): TimestampRef[] {
  return entries.map((entry) => ({
    id: entry.id,
    seconds: entry.time_seconds,
    label: `[${entry.time_label}]`,
    createdAt: entry.createdAt,
  }));
}

export function parseTimestampDocument(
  notes: string,
  timestampRefs: TimestampRef[] = [],
  durationSeconds?: number,
): ParsedTimestampDocument {
  const sourceNotes = String(notes || '');
  const { rawEntries, hasFreeformSection, withoutTimestampSections } = extractRawTimestampEntries(sourceNotes);
  const entries = reconcileEntries(rawEntries, timestampRefs, durationSeconds);
  return {
    entries,
    timestampRefs: refsFromEntries(entries),
    hasFreeformSection,
    withoutTimestampSections,
  };
}

export function serializeTimestampNotes(
  baseNotes: string,
  entries: TimestampNoteEntry[],
): string {
  const sourceNotes = String(baseNotes || '');
  const { withoutTimestampSections } = extractRawTimestampEntries(sourceNotes);
  const canonicalRemainder = ensureFreeformSection(withoutTimestampSections).replace(/^\n+/, '').replace(/\s+$/, '');
  const timestampSection = buildTimestampSection([...entries].sort((a, b) => (a.time_seconds - b.time_seconds) || (a.createdAt - b.createdAt)));
  if (!canonicalRemainder) return `${timestampSection}\n\n## Freeform notes\n`;
  return `${timestampSection}\n\n${canonicalRemainder}\n`;
}

export function findHeadingCursorPosition(
  notes: string,
  timestampRefs: TimestampRef[] = [],
  entryId: string,
  durationSeconds?: number,
) {
  const parsed = parseTimestampDocument(notes, timestampRefs, durationSeconds);
  const entry = parsed.entries.find((candidate) => candidate.id === entryId);
  if (!entry) return null;
  return entry.headingStart + entry.headingLineLength + 1;
}

export function buildMarkerPreview(body: string) {
  const firstMeaningfulLine = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstMeaningfulLine) return 'No note text yet.';
  if (firstMeaningfulLine.length <= 96) return firstMeaningfulLine;
  return `${firstMeaningfulLine.slice(0, 93)}...`;
}

export function insertAtPlayhead(args: {
  notes: string;
  timestampRefs?: TimestampRef[];
  playheadSeconds: number;
  durationSeconds?: number;
}): InsertTimestampAtPlayheadResult {
  const sourceNotes = String(args.notes || '');
  const parsed = parseTimestampDocument(sourceNotes, args.timestampRefs || [], args.durationSeconds);
  const targetSeconds = Math.max(0, Math.floor(args.playheadSeconds || 0));
  const existing = parsed.entries.find((entry) => entry.time_seconds === targetSeconds) || null;
  const targetId = existing?.id || createTimestampId();

  const nextEntries = existing
    ? parsed.entries
    : [
      ...parsed.entries,
      {
        id: targetId,
        time_seconds: targetSeconds,
        time_label: normalizeTimestampLabel(targetSeconds, args.durationSeconds),
        heading: `### [${normalizeTimestampLabel(targetSeconds, args.durationSeconds)}]`,
        body: '',
        preview: buildMarkerPreview(''),
        createdAt: Date.now(),
        occurrence: 0,
        headingStart: 0,
        headingLineLength: 0,
      } satisfies TimestampNoteEntry,
    ];

  const nextNotes = serializeTimestampNotes(sourceNotes, nextEntries);
  const reparsed = parseTimestampDocument(nextNotes, refsFromEntries(nextEntries), args.durationSeconds);
  const cursorPosition = findHeadingCursorPosition(nextNotes, reparsed.timestampRefs, targetId, args.durationSeconds);
  return {
    notes: nextNotes,
    entries: reparsed.entries,
    timestampRefs: reparsed.timestampRefs,
    targetId,
    inserted: !existing,
    cursorPosition,
  };
}

export function removeById(args: {
  notes: string;
  timestampRefs?: TimestampRef[];
  entryId: string;
  durationSeconds?: number;
}): RemoveTimestampByIdResult {
  const sourceNotes = String(args.notes || '');
  const parsed = parseTimestampDocument(sourceNotes, args.timestampRefs || [], args.durationSeconds);
  const removedEntry = parsed.entries.find((entry) => entry.id === args.entryId) || null;
  if (!removedEntry) {
    return {
      notes: serializeTimestampNotes(sourceNotes, parsed.entries),
      entries: parsed.entries,
      timestampRefs: parsed.timestampRefs,
      removed: false,
      removedEntry: null,
    };
  }

  const nextEntries = parsed.entries.filter((entry) => entry.id !== args.entryId);
  const nextNotes = serializeTimestampNotes(sourceNotes, nextEntries);
  const reparsed = parseTimestampDocument(nextNotes, refsFromEntries(nextEntries), args.durationSeconds);
  return {
    notes: nextNotes,
    entries: reparsed.entries,
    timestampRefs: reparsed.timestampRefs,
    removed: true,
    removedEntry,
  };
}

