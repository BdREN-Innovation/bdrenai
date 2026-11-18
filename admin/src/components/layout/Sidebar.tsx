import { Link, useRouterState } from '@tanstack/react-router';
import { LogOut, Monitor, Moon, PanelLeft, Sun } from 'lucide-react';
import type { Session } from '@/api/types';
import type { ThemeMode } from '@/lib/theme';
import { NAV_SECTIONS, isActivePath } from './nav';
import { useTheme } from '@/lib/theme';
import { logout } from '@/api/client';
import { cn } from '@/lib/cn';

interface SidebarProps {
  session: Session;
  collapsed: boolean;
  onToggle: () => void;
}

const THEME_OPTIONS: { mode: ThemeMode; label: string; icon: typeof Sun }[] = [
  { mode: 'light', label: 'Light', icon: Sun },
  { mode: 'dark', label: 'Dark', icon: Moon },
  { mode: 'system', label: 'System', icon: Monitor },
];

function ThemeSwitch({ collapsed }: { collapsed: boolean }) {
  const { mode, setMode } = useTheme();
  if (collapsed) {
    const index = THEME_OPTIONS.findIndex((option) => option.mode === mode);
    const next = THEME_OPTIONS[(index + 1) % THEME_OPTIONS.length];
    const Current = THEME_OPTIONS[index].icon;
    return (
      <button
        type="button"
        onClick={() => setMode(next.mode)}
        aria-label={`Theme: ${THEME_OPTIONS[index].label}. Switch to ${next.label}`}
        title={`Theme: ${THEME_OPTIONS[index].label}`}
        className="flex size-10 cursor-pointer items-center justify-center rounded-lg text-ink-muted hover:bg-hover hover:text-ink"
      >
        <Current aria-hidden="true" size={18} />
      </button>
    );
  }
  return (
    <div role="radiogroup" aria-label="Theme" className="flex rounded-lg bg-ground p-0.5">
      {THEME_OPTIONS.map((option) => {
        const Icon = option.icon;
        const selected = option.mode === mode;
        return (
          <button
            key={option.mode}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.label}
            title={option.label}
            onClick={() => setMode(option.mode)}
            className={cn(
              'flex h-8 flex-1 cursor-pointer items-center justify-center rounded-md transition-colors',
              selected ? 'bg-surface text-brand-ink shadow-[0_1px_2px_rgb(0_0_0/0.05)]' : 'text-ink-muted hover:text-ink',
            )}
          >
            <Icon aria-hidden="true" size={15} />
          </button>
        );
      })}
    </div>
  );
}

export function Sidebar({ session, collapsed, onToggle }: SidebarProps) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <aside
      aria-label="Admin panel"
      className={cn(
        'sticky top-0 flex h-screen shrink-0 flex-col overflow-hidden border-r border-stroke bg-surface transition-[width] duration-200',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      <div className={cn('flex h-16 shrink-0 items-center gap-2.5 px-3.5', collapsed && 'justify-center px-0')}>
        <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand text-sm font-bold text-on-brand">
          B
        </span>
        {!collapsed ? (
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[15px] font-bold text-ink">BDREN AI</span>
            <span className="truncate text-xs text-ink-muted">Platform admin</span>
          </div>
        ) : null}
      </div>

      <nav aria-label="Main" className="flex flex-1 flex-col gap-4 overflow-y-auto px-2.5 py-3">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title} className="flex flex-col gap-0.5">
            {collapsed ? (
              <div aria-hidden="true" className="mx-2 mb-1 border-t border-stroke-muted" />
            ) : (
              <h2 className="px-3 pb-1.5 text-[11px] font-semibold tracking-[0.08em] text-ink-muted uppercase">{section.title}</h2>
            )}
            {section.items.map((item) => {
              const active = isActivePath(item.path, pathname);
              const Icon = item.icon;
              const name = item.soon ? `${item.label} (coming soon)` : item.label;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  aria-current={active ? 'page' : undefined}
                  aria-label={collapsed || item.soon ? name : undefined}
                  title={collapsed ? name : undefined}
                  className={cn(
                    'flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm whitespace-nowrap transition-colors',
                    collapsed && 'justify-center px-0',
                    active
                      ? 'bg-brand-tint font-semibold text-brand-ink'
                      : 'font-medium text-ink-muted hover:bg-hover hover:text-ink',
                  )}
                >
                  <Icon aria-hidden="true" size={18} className="shrink-0" />
                  {!collapsed ? <span className="flex-1 truncate">{item.label}</span> : null}
                  {!collapsed && item.soon ? (
                    <span aria-hidden="true" className="rounded-full bg-neutral-bg px-1.5 text-[10px] font-semibold tracking-wide text-neutral-fg uppercase">
                      Soon
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="flex shrink-0 flex-col gap-2 border-t border-stroke-muted p-2.5">
        <ThemeSwitch collapsed={collapsed} />
        <div className={cn('flex items-center gap-2', collapsed && 'flex-col')}>
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-tint text-xs font-bold text-brand-ink"
          >
            {session.user.initials}
          </span>
          {!collapsed ? (
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px] font-semibold text-ink">{session.user.name || session.user.email}</span>
              <span className="truncate text-xs text-ink-muted">{session.user.email}</span>
            </div>
          ) : null}
          <button
            type="button"
            aria-label="Sign out"
            title="Sign out"
            onClick={() => void logout()}
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-muted hover:bg-hover hover:text-ink"
          >
            <LogOut aria-hidden="true" size={16} />
          </button>
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          className={cn(
            'flex h-9 cursor-pointer items-center gap-3 rounded-lg px-3 text-[13px] font-medium text-ink-muted hover:bg-hover hover:text-ink',
            collapsed && 'justify-center px-0',
          )}
        >
          <PanelLeft aria-hidden="true" size={16} />
          {!collapsed ? 'Collapse' : null}
        </button>
      </div>
    </aside>
  );
}
