export function isEditableShortcutTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return !!element.closest([
    'input',
    'textarea',
    'select',
    '[contenteditable]',
    '.ag-popup',
    '.ag-popup-editor',
    '.ag-cell-inline-editing',
    '.ag-rich-select',
    '.ag-large-text',
    '.ag-menu',
    '.ag-input-field-input',
    '.ag-text-field-input',
    '[data-markdown-editor]',
  ].join(','));
}

export function isGridShortcutTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return Boolean(element.closest('[data-metadata-grid-root="true"]'));
}

export function hasShortcutModifier(event: KeyboardEvent) {
  return event.ctrlKey || event.metaKey;
}

export function matchesAltShiftShortcut(event: KeyboardEvent, key: string) {
  return !hasShortcutModifier(event) && event.altKey && event.shiftKey && event.code === `Key${key.toUpperCase()}`;
}

export function matchesStandardShortcut(event: KeyboardEvent, key: string) {
  return hasShortcutModifier(event) && !event.shiftKey && !event.altKey && event.code === `Key${key.toUpperCase()}`;
}

export function matchesStandardShiftShortcut(event: KeyboardEvent, key: string) {
  return hasShortcutModifier(event) && event.shiftKey && !event.altKey && event.code === `Key${key.toUpperCase()}`;
}

/** Mac keyboards send Backspace for the key labelled "delete"; treat both as Delete. */
export function isDeleteKey(key: string) {
  return key === 'Delete' || key === 'Backspace';
}
