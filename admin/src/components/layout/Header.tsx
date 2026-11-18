import { Search } from 'lucide-react';
import type { ReactNode } from 'react';

interface HeaderProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  onSearch: () => void;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

export function Header({ title, subtitle, actions, onSearch }: HeaderProps) {
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-stroke bg-surface px-6 py-3">
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="truncate text-xl font-bold text-ink">{title}</h1>
        {subtitle ? <div className="truncate text-[13px] text-ink-muted">{subtitle}</div> : null}
      </div>
      <div className="flex items-center gap-2">
        {actions}
        <button
          type="button"
          onClick={onSearch}
          aria-label="Open command menu"
          aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
          className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-stroke px-3 text-sm text-ink-muted transition-colors hover:border-stroke-intense hover:text-ink"
        >
          <Search aria-hidden="true" size={15} />
          <span>Search</span>
          <kbd className="rounded border border-stroke bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-ink">
            {isMac ? '⌘K' : 'Ctrl K'}
          </kbd>
        </button>
      </div>
    </header>
  );
}
