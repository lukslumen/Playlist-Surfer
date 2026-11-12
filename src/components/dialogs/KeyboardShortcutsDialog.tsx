import { X, Keyboard } from 'lucide-react';
import { KEYBOARD_SHORTCUT_HELP } from '../../lib/shortcuts';

export function KeyboardShortcutsDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="dialog-shell w-full max-w-md border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--text-main)]"><Keyboard size={16} className="text-[var(--accent)]" /> Keyboard shortcuts</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-main)]"><X size={18} /></button>
        </div>
        <div className="space-y-2 p-4">
          {KEYBOARD_SHORTCUT_HELP.map((shortcut) => (
            <div key={shortcut.keys} className="flex items-center justify-between gap-3 border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-xs">
              <span className="text-[var(--text-main)]">{shortcut.action}</span>
              <kbd className="border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1 font-mono text-[11px] text-[var(--text-muted)]">{shortcut.keys}</kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
