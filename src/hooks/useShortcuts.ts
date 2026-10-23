import { useEffect, useRef } from 'react';
import { isEditableShortcutTarget, isGridShortcutTarget } from '../lib/keyboard';
import { dispatchShortcut, type AppShortcutId } from '../lib/shortcuts';

/**
 * Registers one window keydown listener for the app-level shortcuts in APP_SHORTCUTS. Handlers and
 * the overlay flag are read from a ref, so the listener never needs re-registering.
 */
export function useShortcuts(
  handlers: Partial<Record<AppShortcutId, () => boolean | void>>,
  options: { hasBlockingOverlay: boolean },
) {
  const latest = useRef({ handlers, options });
  latest.current = { handlers, options };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      dispatchShortcut(event, {
        isTyping: isEditableShortcutTarget(event.target),
        isGridTarget: isGridShortcutTarget(event.target),
        hasBlockingOverlay: latest.current.options.hasBlockingOverlay,
      }, latest.current.handlers);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
