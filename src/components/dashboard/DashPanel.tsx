import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Info, MoreHorizontal } from 'lucide-react';
import { saveCsv, saveElementAsPng, saveElementAsSvg, slugify } from '../../lib/exportImage';
import { useToast } from '../toast/ToastProvider';

/** How a panel's numbers were made, for the info popover and the copyable method note. */
export interface MethodNote {
  /** How the numbers are computed: fields, thresholds, formulas. */
  computed: string;
  /** How to read the chart. */
  read: string;
  /** What to watch out for when interpreting it. */
  caveats?: string[];
}

export interface PanelCsv {
  columns: string[];
  rows: Array<Array<string | number | null | undefined>>;
}

export function formatMethodNote(title: string, note: MethodNote, context?: string): string {
  return [
    title,
    context ? `Scope: ${context}` : null,
    `Method: ${note.computed}`,
    `How to read: ${note.read}`,
    note.caveats?.length ? `Watch out for:\n${note.caveats.map((caveat) => `- ${caveat}`).join('\n')}` : null,
  ].filter(Boolean).join('\n');
}

async function copyToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

/** Closes a popover when clicking outside `ref` or pressing Escape. */
function useDismiss(open: boolean, close: () => void, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener('pointerdown', handlePointer, true);
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointer, true);
      document.removeEventListener('keydown', handleKey, true);
    };
  }, [close, open, ref]);
}

/**
 * A dashboard panel: title, plain-language headline, optional controls, and a menu to export the
 * data (CSV), the panel (PNG/SVG) or its method note.
 */
export function DashPanel({
  title,
  headline,
  method,
  csv,
  controls,
  extraActions,
  context,
  className,
  children,
}: {
  title: string;
  /** One sentence stating the main finding. */
  headline?: ReactNode;
  method: MethodNote;
  /** Built on demand, so large exports don't cost anything until asked for. */
  csv?: () => PanelCsv;
  controls?: ReactNode;
  /** More export options, e.g. "Download GEXF". */
  extraActions?: Array<{ label: string; run: () => void | Promise<void> }>;
  /** The scope the panel describes, e.g. "full dataset", added to exported notes. */
  context?: string;
  className?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const infoRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const { showToast } = useToast();
  useDismiss(menuOpen, () => setMenuOpen(false), menuRef);
  useDismiss(infoOpen, () => setInfoOpen(false), infoRef);
  const fileBase = slugify(`${title}${context ? `-${context}` : ''}`);

  const run = (action: () => void | Promise<void>, success?: string) => {
    setMenuOpen(false);
    // Let the menu close before capturing the panel.
    window.requestAnimationFrame(async () => {
      try {
        await action();
        if (success) showToast({ kind: 'success', message: success });
      } catch (error) {
        showToast({ kind: 'error', message: `Couldn't export "${title}"`, detail: error instanceof Error ? error.message : undefined });
      }
    });
  };

  return (
    <section ref={panelRef} className={`dash-card dash-panel ${className ?? ''}`} aria-label={title}>
      <div className="dash-panel-head">
        <h3>{title}</h3>
        <div className="dash-panel-tools" data-export-ignore>
          {controls}
          <div className="dash-popover-anchor" ref={infoRef}>
            <button type="button" className="dash-icon-button" aria-label={`How "${title}" is calculated`} aria-expanded={infoOpen} onClick={() => setInfoOpen((open) => !open)}>
              <Info size={14} />
            </button>
            {infoOpen ? (
              <div className="dash-popover dash-method" role="dialog" aria-label={`Method: ${title}`}>
                <h4>How it's calculated</h4>
                <p>{method.computed}</p>
                <h4>How to read it</h4>
                <p>{method.read}</p>
                {method.caveats?.length ? (
                  <>
                    <h4>Watch out for</h4>
                    <ul>{method.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}</ul>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="dash-popover-anchor" ref={menuRef}>
            <button type="button" className="dash-icon-button" aria-label={`Export "${title}"`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
              <MoreHorizontal size={15} />
            </button>
            {menuOpen ? (
              <div className="dash-popover dash-menu" role="menu">
                {csv ? (
                  <button type="button" role="menuitem" onClick={() => run(() => {
                    const table = csv();
                    saveCsv(table.columns, table.rows, `${fileBase}.csv`);
                  })}>Download CSV</button>
                ) : null}
                {extraActions?.map((action) => (
                  <button key={action.label} type="button" role="menuitem" onClick={() => run(action.run)}>{action.label}</button>
                ))}
                <button type="button" role="menuitem" onClick={() => run(() => saveElementAsPng(panelRef.current!, `${fileBase}.png`))}>Save as PNG</button>
                <button type="button" role="menuitem" onClick={() => run(() => saveElementAsSvg(panelRef.current!, `${fileBase}.svg`))}>Save as SVG</button>
                <button type="button" role="menuitem" onClick={() => run(() => copyToClipboard(formatMethodNote(title, method, context)), 'Method note copied')}>Copy method note</button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {headline ? <p className="dash-headline">{headline}</p> : null}
      {children}
    </section>
  );
}

/** A compact segmented control for panel options (unit, metric, sort). */
export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="dash-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          disabled={option.disabled}
          className={value === option.value ? 'is-active' : undefined}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
