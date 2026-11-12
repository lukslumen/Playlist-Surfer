import { describe, expect, test } from 'vitest';
import { appendQuotedText, timestampRefsEqual } from '../detailNotes';

describe('appendQuotedText', () => {
  test('starts a quotes section in empty notes and normalises whitespace', () => {
    expect(appendQuotedText('', 'Transcript Quotes', '  hello \n world ')).toBe('## Transcript Quotes\n- "hello world"\n');
  });

  test('adds to an existing section without duplicating quotes', () => {
    const once = appendQuotedText('My notes', 'Transcript Quotes', 'first');
    const twice = appendQuotedText(once, 'Transcript Quotes', 'second');
    expect(appendQuotedText(twice, 'Transcript Quotes', 'first')).toBe(twice);
    expect(twice).toBe('My notes\n\n## Transcript Quotes\n- "first"\n- "second"\n');
  });

  test('keeps other sections in place and escapes quotes', () => {
    const notes = '## Description Quotes\n- "a"\n\n## Transcript Quotes\n- "b"\n';
    const next = appendQuotedText(notes, 'Description Quotes', 'say "hi"');
    expect(next).toContain('## Description Quotes\n- "a"\n- "say \\"hi\\""');
    expect(next).toContain('## Transcript Quotes\n- "b"');
    expect(appendQuotedText(notes, 'X', '   ')).toBe(notes);
  });
});

test('timestampRefsEqual ignores order but not content', () => {
  const a = { id: 'a', seconds: 10, label: 'Intro', createdAt: 1 };
  const b = { id: 'b', seconds: 5, label: 'Hook', createdAt: 2 };
  expect(timestampRefsEqual([a, b], [b, a])).toBe(true);
  expect(timestampRefsEqual([a], [{ ...a, label: 'Other' }])).toBe(false);
  expect(timestampRefsEqual([a], [])).toBe(false);
  expect(timestampRefsEqual(undefined, [])).toBe(true);
});
