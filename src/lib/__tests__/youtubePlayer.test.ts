import { expect, test } from 'vitest';
import { qualifiesAsWatched } from '../../components/detail/useYouTubePlayer';

test('a viewing counts as watched after 30 s, or for short videos when (almost) complete', () => {
  expect(qualifiesAsWatched(31, 600)).toBe(true);
  expect(qualifiesAsWatched(30, 600)).toBe(false);
  expect(qualifiesAsWatched(19, 20)).toBe(true);
  expect(qualifiesAsWatched(10, 20)).toBe(false);
  expect(qualifiesAsWatched(5, null)).toBe(false);
});
