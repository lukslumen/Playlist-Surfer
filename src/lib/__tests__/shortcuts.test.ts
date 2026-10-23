import { describe, expect, test, vi } from 'vitest';
import { APP_SHORTCUTS, dispatchShortcut, KEYBOARD_SHORTCUT_HELP, type ShortcutContext } from '../shortcuts';

function keyEvent(init: Partial<KeyboardEvent> & { key: string; code?: string }) {
  return {
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    code: '',
    preventDefault: vi.fn(),
    ...init,
  } as unknown as KeyboardEvent;
}

const idle: ShortcutContext = { isTyping: false, isGridTarget: false, hasBlockingOverlay: false };

describe('dispatchShortcut', () => {
  test('runs the matching handler and prevents the default', () => {
    const openCommandPalette = vi.fn();
    const event = keyEvent({ key: 'k', code: 'KeyK', metaKey: true });
    expect(dispatchShortcut(event, idle, { openCommandPalette })).toBe('openCommandPalette');
    expect(openCommandPalette).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalled();
  });

  test('ignores shortcuts while typing, except Escape', () => {
    const typing = { ...idle, isTyping: true };
    const openCommandPalette = vi.fn();
    expect(dispatchShortcut(keyEvent({ key: 'k', code: 'KeyK', metaKey: true }), typing, { openCommandPalette })).toBeNull();
    const closeOverlay = vi.fn(() => true);
    expect(dispatchShortcut(keyEvent({ key: 'Escape' }), typing, { closeOverlay })).toBe('closeOverlay');
  });

  test('a declining handler leaves the event alone', () => {
    const event = keyEvent({ key: 'z', code: 'KeyZ', ctrlKey: true });
    expect(dispatchShortcut(event, idle, { undo: () => false })).toBeNull();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  test('Ctrl/Cmd+Delete excludes, plain Delete or Backspace moves, both only outside the grid', () => {
    const excludeSelection = vi.fn();
    const moveSelection = vi.fn();
    const handlers = { excludeSelection, moveSelection };
    expect(dispatchShortcut(keyEvent({ key: 'Backspace', metaKey: true }), idle, handlers)).toBe('excludeSelection');
    expect(dispatchShortcut(keyEvent({ key: 'Backspace' }), idle, handlers)).toBe('moveSelection');
    expect(dispatchShortcut(keyEvent({ key: 'Delete' }), { ...idle, isGridTarget: true }, handlers)).toBeNull();
  });

  test('arrow keys with a modifier are not row navigation', () => {
    const selectNext = vi.fn();
    expect(dispatchShortcut(keyEvent({ key: 'ArrowDown', shiftKey: true }), idle, { selectNext })).toBeNull();
    expect(dispatchShortcut(keyEvent({ key: 'ArrowDown' }), idle, { selectNext })).toBe('selectNext');
  });
});

test('the help dialog lists every app shortcut', () => {
  const helpKeys = KEYBOARD_SHORTCUT_HELP.map((entry) => entry.keys);
  Object.values(APP_SHORTCUTS).forEach((shortcut) => expect(helpKeys).toContain(shortcut.keys));
});
