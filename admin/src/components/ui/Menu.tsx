import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface MenuAction {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** Row action menu (WAI-ARIA menu button): arrows move, Enter selects, Escape and Tab close. */
export function Menu({ label, actions }: { label: string; actions: MenuAction[] }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, right: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = actions.map((action, index) => (action.disabled ? -1 : index)).filter((index) => index >= 0);

  useEffect(() => {
    if (!open) return undefined;
    itemRefs.current[enabled[0]]?.focus({ preventScroll: true });
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const onMove = () => setOpen(false);
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open, enabled[0]]);

  const toggle = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setOpen((value) => !value);
  };

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = enabled.indexOf(itemRefs.current.findIndex((node) => node === document.activeElement));
    const moves: Record<string, number> = {
      ArrowDown: current + 1,
      ArrowUp: current - 1,
      Home: 0,
      End: enabled.length - 1,
    };
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') {
      close(false);
    } else if (event.key in moves) {
      event.preventDefault();
      const next = (moves[event.key] + enabled.length) % enabled.length;
      itemRefs.current[enabled[next]]?.focus();
    }
  };

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            toggle();
          }
        }}
        className="flex size-8 cursor-pointer items-center justify-center rounded-md text-ink-muted hover:bg-hover hover:text-ink"
      >
        <MoreHorizontal aria-hidden="true" size={16} />
      </button>
      {open
        ? createPortal(
        <div
          ref={menuRef}
          id={id}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          style={{ top: position.top, right: position.right }}
          className="fixed z-50 flex min-w-48 flex-col rounded-lg border border-stroke bg-surface p-1 shadow-modal"
        >
          {actions.map((action, index) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={action.disabled}
                onClick={() => {
                  close(true);
                  action.onSelect();
                }}
                className={cn(
                  'flex h-8 cursor-pointer items-center gap-2 rounded-md px-2.5 text-left text-[13px] font-medium whitespace-nowrap hover:bg-hover focus:bg-hover focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
                  action.danger ? 'text-danger-fg' : 'text-ink',
                )}
              >
                {Icon ? <Icon aria-hidden="true" size={14} /> : null}
                {action.label}
              </button>
            );
          })}
        </div>,
            document.body,
          )
        : null}
    </div>
  );
}
