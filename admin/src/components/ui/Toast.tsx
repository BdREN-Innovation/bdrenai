import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type ToastTone = 'success' | 'warning' | 'danger';

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

type Notify = (message: string, tone?: ToastTone) => void;

const ToastContext = createContext<Notify | null>(null);

const TOAST_MS = 6000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), []);

  const notify = useCallback<Notify>(
    (message, tone = 'success') => {
      const id = nextId.current++;
      setItems((current) => [...current.slice(-3), { id, tone, message }]);
      window.setTimeout(() => dismiss(id), TOAST_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => notify, [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" role="region" aria-label="Notifications" className="pointer-events-none fixed right-4 bottom-4 z-80 flex w-80 flex-col gap-2">
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              'pointer-events-auto flex items-start gap-2 rounded-lg border p-3 text-[13px] font-medium shadow-modal',
              item.tone === 'success' && 'border-stroke bg-surface text-ink',
              item.tone === 'warning' && 'border-stroke bg-warning-bg text-warning-fg',
              item.tone === 'danger' && 'border-danger-border bg-danger-bg text-danger-fg',
            )}
          >
            {item.tone === 'success' ? (
              <CircleCheck aria-hidden="true" size={16} className="mt-0.5 shrink-0 text-success-fg" />
            ) : (
              <CircleAlert aria-hidden="true" size={16} className="mt-0.5 shrink-0" />
            )}
            <span className="flex-1">{item.message}</span>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismiss(item.id)}
              className="flex size-5 cursor-pointer items-center justify-center rounded text-ink-muted hover:text-ink"
            >
              <X aria-hidden="true" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): Notify {
  const notify = useContext(ToastContext);
  if (!notify) throw new Error('useToast must be used inside ToastProvider');
  return notify;
}
