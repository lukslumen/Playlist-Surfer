import { useState, useEffect, useMemo, useRef } from 'react';
import { Keyboard } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface CommandPaletteItem {
  id: string;
  label: string;
  description?: string;
  keywords?: string[];
  shortcut?: string;
  disabled?: boolean;
  onSelect: () => void;
}

export function CommandPaletteDialog({
  isOpen,
  onClose,
  onRunCommand,
  commands,
}: {
  isOpen: boolean;
  onClose: () => void;
  onRunCommand: () => void;
  commands: CommandPaletteItem[];
}) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setSelectedIndex(0);
      return;
    }
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen]);

  const filteredCommands = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const available = commands.filter((command) => !command.disabled);
    if (!normalized) return available;
    return available.filter((command) => {
      const haystack = [command.label, command.description || '', command.shortcut || '', ...(command.keywords || [])]
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalized);
    });
  }, [commands, query]);

  useEffect(() => {
    setSelectedIndex((current) => {
      if (filteredCommands.length === 0) return 0;
      return Math.min(current, filteredCommands.length - 1);
    });
  }, [filteredCommands]);

  if (!isOpen) return null;

  const runCommand = (command?: CommandPaletteItem) => {
    if (!command) return;
    command.onSelect();
    onRunCommand();
    setQuery('');
    setSelectedIndex(0);
  };

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        className="dialog-shell w-full max-w-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="border-b border-[var(--border-color)] px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-bold text-[var(--text-main)]">
            <Keyboard size={16} className="text-[var(--accent)]" />
            Quick actions
          </div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">Type an action, use ↑ ↓ to pick one, then press Enter.</p>
        </div>

        <div className="border-b border-[var(--border-color)] px-4 py-3">
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setSelectedIndex((current) => Math.min(current + 1, Math.max(filteredCommands.length - 1, 0)));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setSelectedIndex((current) => Math.max(current - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                runCommand(filteredCommands[selectedIndex] || filteredCommands[0]);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
              }
            }}
            placeholder="Type a command…"
            className="w-full border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            aria-label="Command palette"
          />
        </div>

        <div className="custom-scrollbar max-h-[min(56vh,28rem)] overflow-y-auto p-2">
          {filteredCommands.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-[var(--text-muted)]">No actions match “{query}”.</div>
          ) : (
            filteredCommands.map((command, index) => {
              const selected = index === selectedIndex;
              return (
                <button
                  key={command.id}
                  type="button"
                  onClick={() => runCommand(command)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={cn(
                    'flex w-full items-start justify-between gap-3 border px-3 py-3 text-left transition-colors',
                    selected
                      ? 'border-[color-mix(in_oklab,var(--accent)_35%,var(--border-color))] bg-[color-mix(in_oklab,var(--accent)_9%,var(--bg-primary))]'
                      : 'border-transparent hover:border-[var(--border-color)] hover:bg-[var(--grid-hover)]',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-[var(--text-main)]">{command.label}</span>
                    {command.description && <span className="mt-1 block text-xs leading-5 text-[var(--text-muted)]">{command.description}</span>}
                  </span>
                  {command.shortcut && (
                    <kbd className="shrink-0 border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1 font-mono text-[11px] text-[var(--text-muted)]">
                      {command.shortcut}
                    </kbd>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
