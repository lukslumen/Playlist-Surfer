import { expect, test } from 'vitest';
import { rowChunkId, splitRowsIntoChunks } from '../projectAutosave';

test('splitRowsIntoChunks keeps every row in order', () => {
  const rows = Array.from({ length: 2501 }, (_, index) => ({ index }));
  const chunks = splitRowsIntoChunks(rows, 1000);
  expect(chunks.map((chunk) => chunk.length)).toEqual([1000, 1000, 501]);
  expect(chunks.flat()).toEqual(rows);
  expect(splitRowsIntoChunks([], 1000)).toEqual([]);
});

test('rowChunkId sorts lexicographically in numeric order', () => {
  const ids = [0, 1, 9, 10, 99, 100, 1000].map(rowChunkId);
  expect([...ids].sort()).toEqual(ids);
});
