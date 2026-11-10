import { describe, expect, test } from 'vitest';
import { planAutosaveRestore, planBackupRestore, unpackProjectBackup } from '../projectRestore';
import type { ProjectArchiveManifest } from '../../types';

const snapshot = {
  version: 1,
  savedAt: '2026-10-23T12:00:00.000Z',
  fileName: 'videos.csv',
  sourceSchema: [{ column_name: 'videoId', column_type: 'VARCHAR' }],
  rows: [{ videoId: 'a' }, { videoId: 'b' }],
};

describe('planAutosaveRestore', () => {
  test('restores curation from the saved state', () => {
    const plan = planAutosaveRestore(snapshot, {
      excludedVideoIds: ['a'],
      inclusionView: 'included',
      projectNotes: 'notes',
      userTagsByVideoId: { b: ['keep'] },
    });
    expect(plan.project.rows).toHaveLength(2);
    expect(plan.project.excludedVideoIds).toEqual(['a']);
    expect(plan.project.projectNotes).toBe('notes');
    expect(plan.project.annotations?.b?.tags).toEqual(['keep']);
    expect(plan.recoveredInclusion).toBe('included');
  });

  test('switches to the included view when the saved excluded view would be empty', () => {
    const plan = planAutosaveRestore(snapshot, { excludedVideoIds: [], inclusionView: 'excluded' });
    expect(plan.preferredInclusion).toBe('excluded');
    expect(plan.recoveredInclusion).toBe('included');
    expect(plan.project.inclusionView).toBe('included');
  });

  test('works with an empty saved state', () => {
    const plan = planAutosaveRestore(snapshot, {});
    expect(plan.project.viewScope).toBe('videos');
    expect(plan.project.savedViewsVersion).toBe(0);
  });
});

describe('project backups', () => {
  const encode = (text: string) => new TextEncoder().encode(text);

  test('rejects archives without project.json or data.csv, or of another version', () => {
    expect(() => unpackProjectBackup({ 'data.csv': encode('videoId\na') })).toThrow(/missing project.json or data.csv/);
    expect(() => unpackProjectBackup({ 'project.json': encode('{"version":9}'), 'data.csv': encode('x') })).toThrow(/version 9/);
  });

  test('restores excluded videos and starts in the included view', () => {
    const manifest = { version: 10, originalFileName: 'videos.csv', excluded_videos: ['a'], annotations: {} } as unknown as ProjectArchiveManifest;
    const unpacked = unpackProjectBackup({ 'project.json': encode(JSON.stringify(manifest)), 'data.csv': encode('videoId\na') });
    const project = planBackupRestore({ manifest: unpacked.manifest, noteFiles: unpacked.noteFiles, parsed: { rows: [{ videoId: 'a' }], schema: [] } });
    expect(project.excludedVideoIds).toEqual(['a']);
    expect(project.inclusionView).toBe('included');
    expect(project.fileName).toBe('videos.csv');
    expect(project.channelSnapshotShouldBeFresh).toBe(true);
  });
});
