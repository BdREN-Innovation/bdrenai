import { useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TabItem<T extends string> {
  value: T;
  label: string;
  count?: number;
}

interface TabsProps<T extends string> {
  label: string;
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Rendered as the tab panel; omit when the tabs only filter content below them. */
  children?: ReactNode;
}

/** WAI-ARIA tabs with automatic activation: arrows, Home and End move and select. */
export function Tabs<T extends string>({ label, items, value, onChange, children }: TabsProps<T>) {
  const baseId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = Math.max(
    items.findIndex((item) => item.value === value),
    0,
  );

  const focusAt = (index: number) => {
    const next = (index + items.length) % items.length;
    refs.current[next]?.focus();
    onChange(items[next].value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const moves: Record<string, number> = {
      ArrowRight: selectedIndex + 1,
      ArrowLeft: selectedIndex - 1,
      Home: 0,
      End: items.length - 1,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    focusAt(moves[event.key]);
  };

  const tabId = (index: number) => `${baseId}-tab-${index}`;
  const panelId = `${baseId}-panel`;

  return (
    <>
      <div role="tablist" aria-label={label} className="flex shrink-0 gap-1 overflow-x-auto border-b border-stroke-muted">
        {items.map((item, index) => {
          const selected = index === selectedIndex;
          return (
            <button
              key={item.value}
              ref={(node) => {
                refs.current[index] = node;
              }}
              id={tabId(index)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={children ? panelId : undefined}
              tabIndex={selected ? 0 : -1}
              onKeyDown={onKeyDown}
              onClick={() => onChange(item.value)}
              className={cn(
                '-mb-px flex h-10 shrink-0 cursor-pointer items-center gap-2 border-b-2 px-3 text-sm whitespace-nowrap transition-colors',
                selected
                  ? 'border-brand font-semibold text-ink'
                  : 'border-transparent font-medium text-ink-muted hover:text-ink',
              )}
            >
              {item.label}
              {item.count !== undefined ? (
                <span className="tabular rounded-full bg-neutral-bg px-1.5 text-[11px] font-semibold text-neutral-fg">
                  {item.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {children ? (
        <div role="tabpanel" id={panelId} aria-labelledby={tabId(selectedIndex)} className="pt-5">
          {children}
        </div>
      ) : null}
    </>
  );
}
