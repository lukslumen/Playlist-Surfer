import {
  findHeadingCursorPosition,
  insertAtPlayhead,
  parseTimestampDocument,
  removeById,
  serializeTimestampNotes,
} from '../timestampNotes';
import type { TimestampRef } from '../../types';

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

const baseNotes = [
  '## Freeform notes',
  'Keep this paragraph exactly as-is.',
  '',
  'Another line in freeform.',
  '',
].join('\n');

{
  const inserted = insertAtPlayhead({
    notes: baseNotes,
    playheadSeconds: 192,
    durationSeconds: 3599,
  });
  assert(inserted.notes.includes('## Timestamp annotations'), 'Insert should add Timestamp annotations section');
  assert(inserted.notes.includes('### [03:12]'), 'Insert should create heading for current playhead');
  assert(inserted.notes.includes('## Freeform notes'), 'Insert should preserve Freeform notes section');
  assert(inserted.cursorPosition !== null, 'Insert should return a cursor position');
}

{
  const unsorted = [
    '## Timestamp annotations',
    '',
    '### [08:05]',
    'late note',
    '',
    '### [00:20]',
    'early note',
    '',
    '## Freeform notes',
    'unchanged',
    '',
  ].join('\n');

  const parsed = parseTimestampDocument(unsorted, []);
  const normalized = serializeTimestampNotes(unsorted, parsed.entries);
  const firstIndex = normalized.indexOf('### [00:20]');
  const secondIndex = normalized.indexOf('### [08:05]');
  assert(firstIndex >= 0 && secondIndex > firstIndex, 'Serialization should keep timestamp headings in chronological order');
}

{
  const once = insertAtPlayhead({
    notes: baseNotes,
    playheadSeconds: 13,
    durationSeconds: 180,
  });
  const twice = insertAtPlayhead({
    notes: once.notes,
    timestampRefs: once.timestampRefs,
    playheadSeconds: 13,
    durationSeconds: 180,
  });
  const matchCount = (twice.notes.match(/### \[00:13\]/g) || []).length;
  assert(matchCount === 1, 'Adding same second twice should focus existing entry, not duplicate');
  assert(!twice.inserted, 'Second insertion at same second should report inserted=false');
}

{
  const added = insertAtPlayhead({
    notes: baseNotes,
    playheadSeconds: 25,
    durationSeconds: 180,
  });
  const targetRef = added.timestampRefs.find((ref) => ref.seconds === 25);
  assert(Boolean(targetRef), 'Timestamp ref should exist after insert');
  const removed = removeById({
    notes: added.notes,
    timestampRefs: added.timestampRefs,
    entryId: targetRef!.id,
    durationSeconds: 180,
  });
  assert(removed.removed, 'Remove should report removal');
  assert(!removed.notes.includes('### [00:25]'), 'Remove should delete timestamp heading from markdown');
}

{
  const legacy = [
    '## Timestamps',
    '- [00:20]',
    '- [01:05]',
    '',
    '## Freeform notes',
    'legacy freeform',
    '',
  ].join('\n');
  const parsed = parseTimestampDocument(legacy, []);
  const serialized = serializeTimestampNotes(legacy, parsed.entries);
  assert(serialized.includes('## Timestamp annotations'), 'Legacy heading should migrate to Timestamp annotations');
  assert(!serialized.includes('## Timestamps'), 'Legacy heading should be removed after serialization');
  assert(serialized.includes('### [00:20]') && serialized.includes('### [01:05]'), 'Legacy list items should become heading entries');
}

{
  const withTimestamp = insertAtPlayhead({
    notes: baseNotes,
    playheadSeconds: 74,
    durationSeconds: 500,
  });
  const removed = removeById({
    notes: withTimestamp.notes,
    timestampRefs: withTimestamp.timestampRefs,
    entryId: withTimestamp.targetId,
    durationSeconds: 500,
  });
  const freeformBody = 'Keep this paragraph exactly as-is.\n\nAnother line in freeform.';
  assert(removed.notes.includes(freeformBody), 'Freeform notes body should remain unchanged after add/remove cycle');
}

{
  const inserted = insertAtPlayhead({
    notes: baseNotes,
    playheadSeconds: 9,
    durationSeconds: 120,
  });
  const targetRef = inserted.timestampRefs.find((ref) => ref.seconds === 9) as TimestampRef;
  const cursor = findHeadingCursorPosition(inserted.notes, inserted.timestampRefs, targetRef.id, 120);
  assert(typeof cursor === 'number' && cursor > 0, 'findHeadingCursorPosition should resolve position for inserted entry');
}

console.log('timestampNotes.test.ts: ok');

