import {
  hasShortcutModifier,
  isDeleteKey,
  matchesAltShiftShortcut,
  matchesStandardShiftShortcut,
  matchesStandardShortcut,
} from './keyboard';

/** Where a key press happened, so shortcuts can stay out of text fields, the grid or open dialogs. */
export interface ShortcutContext {
  isTyping: boolean;
  isGridTarget: boolean;
  hasBlockingOverlay: boolean;
}

export interface ShortcutDefinition {
  /** Label shown in the keyboard shortcuts dialog. */
  keys: string;
  description: string;
  match: (event: KeyboardEvent) => boolean;
  /** When the shortcut may fire. Defaults to: not typing in a field and no dialog open. */
  when?: (context: ShortcutContext) => boolean;
}

const outsideFieldsAndDialogs = (context: ShortcutContext) => !context.isTyping && !context.hasBlockingOverlay;
// The grid handles arrows and Delete itself, so the app-level versions only apply elsewhere.
const outsideGrid = (context: ShortcutContext) => outsideFieldsAndDialogs(context) && !context.isGridTarget;
const plainKey = (event: KeyboardEvent) => !event.shiftKey && !event.altKey && !hasShortcutModifier(event);

/**
 * Every app-level keyboard shortcut. Order matters: the first entry whose key matches, whose
 * condition holds and whose handler doesn't decline (returns false) handles the event.
 */
export const APP_SHORTCUTS = {
  closeOverlay: {
    keys: 'Esc',
    description: 'close the open dialog',
    match: (event) => event.key === 'Escape',
    when: () => true,
  },
  historyBack: {
    keys: 'Ctrl + ←',
    description: 'go back in navigation history',
    match: (event) => event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && event.key === 'ArrowLeft',
    when: outsideGrid,
  },
  historyForward: {
    keys: 'Ctrl + →',
    description: 'go forward in navigation history',
    match: (event) => event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && event.key === 'ArrowRight',
    when: outsideGrid,
  },
  selectNext: {
    keys: '↓',
    description: 'select the next row',
    match: (event) => plainKey(event) && event.key === 'ArrowDown',
    when: outsideGrid,
  },
  selectPrevious: {
    keys: '↑',
    description: 'select the previous row',
    match: (event) => plainKey(event) && event.key === 'ArrowUp',
    when: outsideGrid,
  },
  toggleThumbnailView: { keys: 'Alt/Option + Shift + T', description: 'switch the videos view between table and thumbnails', match: (event) => matchesAltShiftShortcut(event, 't') },
  openAttentionDashboard: { keys: 'Alt/Option + Shift + A', description: 'attention dashboard', match: (event) => matchesAltShiftShortcut(event, 'a') },
  openContentDashboard: { keys: 'Alt/Option + Shift + C', description: 'content dashboard', match: (event) => matchesAltShiftShortcut(event, 'c') },
  openOverviewDashboard: { keys: 'Alt/Option + Shift + O', description: 'overview dashboard', match: (event) => matchesAltShiftShortcut(event, 'o') },
  openColumns: { keys: 'Alt/Option + Shift + V', description: 'toggle column visibility / edit view', match: (event) => matchesAltShiftShortcut(event, 'v') },
  openExport: { keys: 'Alt/Option + Shift + E', description: 'export', match: (event) => matchesAltShiftShortcut(event, 'e') },
  openImport: { keys: 'Alt/Option + Shift + I', description: 'import', match: (event) => matchesAltShiftShortcut(event, 'i') },
  openKeyboardHelp: { keys: 'Alt/Option + Shift + K', description: 'keyboard shortcuts help', match: (event) => matchesAltShiftShortcut(event, 'k') },
  openCommandPalette: { keys: 'Ctrl/Cmd + K', description: 'command palette', match: (event) => matchesStandardShortcut(event, 'k') },
  saveView: { keys: 'Ctrl/Cmd + S', description: 'Save view', match: (event) => matchesStandardShortcut(event, 's') },
  undo: { keys: 'Ctrl/Cmd + Z', description: 'undo', match: (event) => matchesStandardShortcut(event, 'z') },
  redo: { keys: 'Ctrl/Cmd + Shift + Z', description: 'redo', match: (event) => matchesStandardShiftShortcut(event, 'z') },
  excludeSelection: {
    keys: 'Ctrl/Cmd + Delete',
    description: 'exclude / restore the selected videos',
    match: (event) => (event.ctrlKey || event.metaKey) && isDeleteKey(event.key),
    when: outsideGrid,
  },
  moveSelection: {
    keys: 'Delete / Backspace',
    description: 'move the selected videos between Included and Excluded',
    match: (event) => isDeleteKey(event.key),
    when: outsideGrid,
  },
} satisfies Record<string, ShortcutDefinition>;

export type AppShortcutId = keyof typeof APP_SHORTCUTS;

/** Shortcuts handled outside the app-level registry (e.g. inside the video player). */
const COMPONENT_SHORTCUTS: Array<Pick<ShortcutDefinition, 'keys' | 'description'>> = [
  { keys: 'Shift + T (player)', description: 'add timestamp annotation' },
];

/** Rows for the keyboard shortcuts dialog. */
export const KEYBOARD_SHORTCUT_HELP: Array<{ keys: string; action: string }> = [
  ...Object.values(APP_SHORTCUTS).map((shortcut: ShortcutDefinition) => ({ keys: shortcut.keys, action: shortcut.description })),
  ...COMPONENT_SHORTCUTS.map((shortcut) => ({ keys: shortcut.keys, action: shortcut.description })),
];

/**
 * Runs the first matching shortcut. A handler can return false to decline (e.g. undo with nothing
 * to undo), which lets later shortcuts try and leaves the browser default alone.
 */
export function dispatchShortcut(
  event: KeyboardEvent,
  context: ShortcutContext,
  handlers: Partial<Record<AppShortcutId, () => boolean | void>>,
): AppShortcutId | null {
  for (const [id, shortcut] of Object.entries(APP_SHORTCUTS) as Array<[AppShortcutId, ShortcutDefinition]>) {
    const handler = handlers[id];
    if (!handler || !shortcut.match(event)) continue;
    if (!(shortcut.when ?? outsideFieldsAndDialogs)(context)) continue;
    if (handler() === false) continue;
    event.preventDefault();
    return id;
  }
  return null;
}
