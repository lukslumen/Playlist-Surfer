import { expect, test } from 'vitest';
import { describeInclusionResult, restoreFailedToast, saveFailedToast } from '../feedbackMessages';

test('exclusion feedback only when something was skipped', () => {
  expect(describeInclusionResult({ kind: 'exclude', requestedCount: 3, changedCount: 3, skippedCount: 0 })).toBeNull();
  expect(describeInclusionResult({ kind: 'exclude', requestedCount: 2, changedCount: 0, skippedCount: 2 }))
    .toMatchObject({ kind: 'warning', message: 'Nothing was excluded', detail: expect.stringContaining('already excluded') });
  expect(describeInclusionResult({ kind: 'restore', requestedCount: 1, changedCount: 0, skippedCount: 1 }))
    .toMatchObject({ message: 'Nothing was restored', detail: expect.stringContaining('video is already included') });
  expect(describeInclusionResult({ kind: 'exclude', requestedCount: 5, changedCount: 3, skippedCount: 2 }))
    .toMatchObject({ kind: 'info', message: 'Excluded 3 videos of 5', detail: '2 videos were already excluded or not part of this dataset.' });
});

test('error toasts carry the underlying reason', () => {
  expect(restoreFailedToast('backup.zip', new Error('missing project.json'))).toMatchObject({ kind: 'error', message: "Couldn't restore backup.zip", detail: 'missing project.json' });
  expect(saveFailedToast('state', 'quota')).toMatchObject({ key: 'save-failed', detail: expect.stringContaining('(quota)') });
});
