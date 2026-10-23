import { Annotation } from '../types';
import { decodeTextFile } from './archive';
import { parseListString } from './filterCoordinator';
import { resolveVideoId, USER_TAGS_COLUMN } from './data';

export function getArchiveEntry(files: Record<string, Uint8Array>, targetName: string) {
  return files[targetName] || Object.entries(files).find(([name]) => name === targetName || name.endsWith(`/${targetName}`))?.[1];
}

export function stripNotesFromAnnotations(annotations: Record<string, Annotation>) {
  return Object.fromEntries(
    Object.entries(annotations).map(([videoId, annotation]) => {
      const { notes, ...rest } = annotation;
      return [videoId, rest];
    })
  ) as Record<string, Annotation>;
}

export function buildLegacyNotesFromAnnotations(annotations: Record<string, Annotation>) {
  const notesByVideoId: Record<string, string> = {};
  Object.entries(annotations).forEach(([videoId, annotation]) => {
    const notes = annotation?.notes;
    if (typeof notes === 'string' && notes.trim().length > 0) {
      notesByVideoId[videoId] = notes;
    }
  });
  return notesByVideoId;
}

export function buildNoteArchiveFiles(notesByVideoId: Record<string, string>, folder: string) {
  return Object.entries(notesByVideoId)
    .filter(([, notes]) => notes.trim().length > 0)
    .map(([videoId, notes]) => ({
      name: `${folder}/video_notes/${videoId}.txt`,
      data: notes,
    }));
}

export function extractNotesFromArchive(files: Record<string, Uint8Array>) {
  const notes: Record<string, string> = {};
  Object.entries(files).forEach(([name, data]) => {
    const match = name.match(/(?:^|\/)video_notes\/([^/]+)\.txt$/i);
    if (!match) return;
    notes[match[1]] = decodeTextFile(data);
  });
  return notes;
}

export function extractAnnotationsFromRows(rows: any[], seed: Record<string, Annotation> = {}) {
  const nextAnnotations: Record<string, Annotation> = { ...seed };

  rows.forEach((row) => {
    const videoId = resolveVideoId(row);
    if (!videoId) return;

    const tags = row[USER_TAGS_COLUMN] || row.User_Tags;

    if (tags) {
      nextAnnotations[videoId] = {
        ...nextAnnotations[videoId],
        tags: parseListString(tags),
        transcriptOverride: nextAnnotations[videoId]?.transcriptOverride,
        quoteRefs: nextAnnotations[videoId]?.quoteRefs || [],
        timestampRefs: nextAnnotations[videoId]?.timestampRefs || [],
      };
    }
  });

  return nextAnnotations;
}

export function appendNotesBlock(existingNotes: string | null | undefined, nextBlock: string | null | undefined) {
  const incoming = String(nextBlock ?? '').trim();
  const current = String(existingNotes ?? '').trimEnd();
  if (!incoming) return current;
  return current ? `${current}\n\n${incoming}` : incoming;
}

export function buildTagUsageSummary(userTagsByVideoId: Record<string, string[]>) {
  const counts = new Map<string, number>();
  Object.values(userTagsByVideoId).forEach((tags) => {
    const unique = new Set(tags || []);
    unique.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1));
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12);
}
