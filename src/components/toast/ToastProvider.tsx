import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '../../lib/utils';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface ToastOptions {
  kind?: ToastKind;
  message: string;
  /** Optional second line with detail. */
  detail?: string;
  /** Milliseconds before it closes; errors stay until dismissed unless set. */
  durationMs?: number;
  /** Toasts with the same key replace each other instead of stacking. */
  key?: string;
}

interface Toast extends Required<Pick<ToastOptions, 'kind' | 'message'>> {
  id: number;
  detail?: string;
  durationMs: number | null;
  key?: string;
}

interface ToastApi {
  showToast: (options: ToastOptions) => void;
  dismissToast: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
const MAX_VISIBLE = 4;
const DEFAULT_DURATION_MS = 5000;

/** Short, non-blocking messages about what just happened (or didn't), e.g. a failed restore. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextIdRef = useRef(1);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((options: ToastOptions) => {
    const kind = options.kind ?? 'info';
    const toast: Toast = {
      id: nextIdRef.current++,
      kind,
      message: options.message,
      detail: options.detail,
      durationMs: options.durationMs ?? (kind === 'error' ? null : DEFAULT_DURATION_MS),
      key: options.key,
    };
    setToasts((current) => {
      const rest = toast.key ? current.filter((existing) => existing.key !== toast.key) : current;
      return [...rest, toast].slice(-MAX_VISIBLE);
    });
  }, []);

  const api = useMemo(() => ({ showToast, dismissToast }), [dismissToast, showToast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside <ToastProvider>.');
  return api;
}

const KIND_STYLES: Record<ToastKind, { icon: typeof Info; accent: string }> = {
  info: { icon: Info, accent: 'text-[var(--accent)]' },
  success: { icon: CheckCircle2, accent: 'text-green-600' },
  warning: { icon: AlertTriangle, accent: 'text-amber-600' },
  error: { icon: XCircle, accent: 'text-red-600' },
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    if (toast.durationMs === null) return;
    const timeout = window.setTimeout(() => onDismiss(toast.id), toast.durationMs);
    return () => window.clearTimeout(timeout);
  }, [onDismiss, toast.durationMs, toast.id]);

  const { icon: Icon, accent } = KIND_STYLES[toast.kind];
  return (
    <div
      role={toast.kind === 'error' ? 'alert' : 'status'}
      data-toast-kind={toast.kind}
      className="pointer-events-auto flex w-[360px] max-w-[calc(100vw-2rem)] items-start gap-3 border border-[var(--border-color)] bg-[var(--bg-secondary)] px-4 py-3 text-sm text-[var(--text-main)] shadow-2xl"
    >
      <Icon size={16} className={cn('mt-0.5 shrink-0', accent)} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{toast.message}</div>
        {toast.detail && <div className="mt-1 break-words text-xs text-[var(--text-muted)]">{toast.detail}</div>}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-main)]"
        aria-label="Dismiss notification"
      >
        <X size={14} />
      </button>
    </div>
  );
}

function Toaster({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-10 right-4 z-[200] flex flex-col items-end gap-2">
      {toasts.map((toast) => (
        <div key={toast.id} className="contents">
          <ToastItem toast={toast} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}
