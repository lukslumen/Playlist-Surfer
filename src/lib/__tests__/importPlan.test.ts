import { describe, expect, test } from 'vitest';
import {
  addEnrichmentSource,
  buildMergedSourceState,
  importProgressTitle,
  planReplaceImport,
  type ImportProgress,
} from '../importPlan';
import { buildDefaultProjectSourceState } from '../projectSourceState';
import type { ColumnSchema, ImportOptions } from '../../types';

const noProgress: ImportProgress = async () => {};
const schema: ColumnSchema[] = [
  { column_name: 'videoId', column_type: 'VARCHAR' },
  { column_name: 'videoTitle', column_type: 'VARCHAR' },
];
const replaceOptions: ImportOptions = { mode: 'replace', joinColumn: 'videoId', selectedColumns: ['videoTitle'] };

test('importProgressTitle names the kind of import', () => {
  expect(importProgressTitle({ ...replaceOptions, importKind: 'channelMetadata' }, true)).toBe('Merging channel metadata');
  expect(importProgressTitle(replaceOptions, true)).toBe('Importing CSV');
  expect(importProgressTitle({ ...replaceOptions, mode: 'merge' }, true)).toBe('Merging CSV');
  expect(importProgressTitle({ ...replaceOptions, mode: 'merge' }, false)).toBe('Importing CSV');
});

describe('planReplaceImport', () => {
  test('resets curation, keeps project notes and records the import', async () => {
    const steps: string[] = [];
    const plan = await planReplaceImport({
      incomingRows: [{ videoId: 'a', videoTitle: 'A' }],
      incomingSchema: schema,
      fileName: 'videos.csv',
      options: replaceOptions,
      specialMappings: {},
      carryOver: { projectOverview: 'overview', projectNotes: 'notes', researchLogSectionComments: {} },
      isFirstDataset: true,
      progress: async (detail) => { steps.push(detail); },
    });
    expect(plan.project.rows).toHaveLength(1);
    expect(plan.project.excludedVideoIds).toEqual([]);
    expect(plan.project.inclusionView).toBe('included');
    expect(plan.project.projectNotes).toBe('notes');
    expect(plan.project.visible).toEqual(['videoTitle']);
    expect(plan.project.autoExpandPanel).toBe(true);
    expect(plan.history.map((entry) => entry.type)).toEqual(['import_replace_completed']);
    expect(steps).toEqual(['Applying mapped support fields', 'Deriving column schema', 'Rebuilding project state']);
  });

  test('logs special field mappings when any are set', async () => {
    const plan = await planReplaceImport({
      incomingRows: [],
      incomingSchema: schema,
      fileName: 'videos.csv',
      options: replaceOptions,
      specialMappings: { transcriptColumn: 'transcript' },
      carryOver: {},
      isFirstDataset: false,
      progress: noProgress,
    });
    expect(plan.history).toHaveLength(1);
    expect(plan.history[0].details).toContain('Fields used: Transcript: transcript');
  });
});

describe('buildMergedSourceState', () => {
  const existingRows = [{ videoId: 'a' }, { videoId: 'b' }];
  const base = buildDefaultProjectSourceState({ rows: existingRows, schema: [schema[0]], fileName: 'base.csv' });

  test('existing rows keep their base source and gain the incoming file only when matched', () => {
    const merged = buildMergedSourceState({
      existingRows,
      existingSourceState: base,
      mergedRows: [{ videoId: 'a', extra: 1 }, { videoId: 'b' }, { videoId: 'c', extra: 3 }],
      mergedSchema: [...schema, { column_name: 'extra', column_type: 'BIGINT' }],
      incomingRows: [{ videoId: 'a', extra: 1 }, { videoId: 'c', extra: 3 }],
      incomingSchema: [schema[0], { column_name: 'extra', column_type: 'BIGINT' }],
      incomingFileName: 'extra.csv',
      joinColumn: 'videoId',
      incomingJoinColumn: 'videoId',
      now: '2026-10-23T12:00:00.000Z',
    });
    // Source ids carry a timestamp, so look the incoming one up by its label.
    const incomingSourceId = merged.sourceRegistry.orderedIds.find((id) => merged.sourceRegistry.byId[id].label === 'extra.csv')!;
    expect(incomingSourceId).toMatch(/^source\/enrichment:extra:/);
    const lineage = Object.values(merged.rowLineage.byRowId);
    const byVideo = (id: string) => lineage.find((entry) => entry.rowId.includes(id))!;
    const baseSourceId = base.rowLineage.byRowId[Object.keys(base.rowLineage.byRowId)[0]].baseSourceId;

    expect(byVideo('a').baseSourceId).toBe(baseSourceId);
    expect(byVideo('a').contributorSourceIds).toContain(incomingSourceId);
    expect(byVideo('b').contributorSourceIds).not.toContain(incomingSourceId);
    expect(byVideo('c')).toMatchObject({ baseSourceId: incomingSourceId, contributorSourceIds: [incomingSourceId] });
    expect(merged.sourceRegistry.orderedIds).toContain(incomingSourceId);
    expect(merged.columnLineage.byColumn.extra.sourceId).toBe(incomingSourceId);
  });
});

test('addEnrichmentSource appends an enrichment source entry', () => {
  const registry = { byId: {}, orderedIds: [] };
  const next = addEnrichmentSource(registry, { fileName: 'channels.csv', rowCount: 3, columns: ['channelId'], now: 'now' });
  expect(next.orderedIds).toHaveLength(1);
  expect(next.byId[next.orderedIds[0]]).toMatchObject({ label: 'channels.csv', kind: 'enrichment', rowCount: 3, contributedColumns: ['channelId'] });
  expect(registry.orderedIds).toHaveLength(0);
});
