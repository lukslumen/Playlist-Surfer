import { expect, test } from 'vitest';
import { structurallyEqual } from '../../hooks/useStableValue';

test('structurallyEqual compares the shapes the grid receives', () => {
  expect(structurallyEqual(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true);
  expect(structurallyEqual(new Set(['a']), new Set(['a', 'b']))).toBe(false);
  expect(structurallyEqual({ tags: ['x', 'y'] }, { tags: ['x', 'y'] })).toBe(true);
  expect(structurallyEqual({ tags: ['x', 'y'] }, { tags: ['y', 'x'] })).toBe(false);
  expect(structurallyEqual({ a: { keys: ['k'], kind: 'map' } }, { a: { keys: ['k'], kind: 'map' } })).toBe(true);
  expect(structurallyEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  expect(structurallyEqual(new Map([['a', [1]]]), new Map([['a', [1]]]))).toBe(true);
  expect(structurallyEqual([], {})).toBe(false);
  expect(structurallyEqual(null, {})).toBe(false);
});
