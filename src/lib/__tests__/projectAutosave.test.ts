import {
  LAST_PROJECT_AUTOSAVE_VERSION,
  isValidLastProjectAutosaveSnapshot,
  shouldAttemptLastProjectRestore,
} from '../projectAutosave';

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

const validSnapshot = {
  version: LAST_PROJECT_AUTOSAVE_VERSION,
  savedAt: '2026-04-20T12:00:00.000Z',
  fileName: 'videos.csv',
  sourceSchema: [
    { column_name: 'videoId', column_type: 'VARCHAR' },
    { column_name: 'title', column_type: 'VARCHAR' },
  ],
  rows: [
    { videoId: 'v1', title: 'Title 1' },
    { videoId: 'v2', title: 'Title 2' },
  ],
};

assert(isValidLastProjectAutosaveSnapshot(validSnapshot), 'Valid autosave snapshot should pass validation');

assert(
  !isValidLastProjectAutosaveSnapshot({ ...validSnapshot, version: 999 }),
  'Snapshot with mismatched version must fail validation',
);

assert(
  !isValidLastProjectAutosaveSnapshot({ ...validSnapshot, sourceSchema: [{ bad: true }] }),
  'Snapshot with invalid schema must fail validation',
);

assert(
  !isValidLastProjectAutosaveSnapshot({ ...validSnapshot, rows: 'nope' }),
  'Snapshot with non-array rows must fail validation',
);

assert(
  shouldAttemptLastProjectRestore({ currentRowCount: 0, currentSchemaCount: 0 }),
  'Restore should run when dataset is blank',
);

assert(
  shouldAttemptLastProjectRestore({ currentRowCount: 0, currentSchemaCount: 2 }),
  'Restore should run when rows are missing but schema exists',
);

assert(
  shouldAttemptLastProjectRestore({ currentRowCount: 10, currentSchemaCount: 0 }),
  'Restore should run when schema is missing but rows exist',
);

assert(
  !shouldAttemptLastProjectRestore({ currentRowCount: 10, currentSchemaCount: 2 }),
  'Restore should skip when dataset is already loaded',
);

console.log('projectAutosave.test.ts: ok');
