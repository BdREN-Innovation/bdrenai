import { useState } from 'react';
import { Command } from 'cmdk';
import * as RadixDialog from '@radix-ui/react-dialog';
import { useNavigate } from '@tanstack/react-router';
import { Building2, Monitor, Moon, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { ThemeMode } from '@/lib/theme';
import { useInstitutionOptions } from '@/api/queries';
import { CONFIGURATION_PAGES, NAV_ITEMS } from './nav';
import { useTheme } from '@/lib/theme';

interface CommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandItem({ icon: Icon, value, keywords, onSelect, children }: { icon: LucideIcon; value: string; keywords?: string[]; onSelect: () => void; children: ReactNode }) {
  return (
    <Command.Item
      value={value}
      keywords={keywords}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-ink data-[selected=true]:bg-brand-tint"
    >
      <Icon aria-hidden="true" size={16} className="shrink-0 text-ink-muted" />
      {children}
    </Command.Item>
  );
}

export const COMMAND_OVERLAY = 'fixed inset-0 z-69 bg-scrim';
export const COMMAND_CONTENT =
  'fixed top-[15vh] left-1/2 z-70 w-[calc(100vw-32px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-stroke bg-surface shadow-modal';
export const COMMAND_INPUT =
  'w-full border-b border-stroke bg-transparent px-4 py-3 text-sm text-ink outline-none placeholder:text-ink-muted';

/** ⌘K: jump to a page, an institution (searched on the server), or switch the theme. */
export function CommandMenu({ open, onOpenChange }: CommandMenuProps) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const institutions = useInstitutionOptions(search.trim(), open);

  const close = () => {
    onOpenChange(false);
    setSearch('');
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      label="Command menu"
      overlayClassName={COMMAND_OVERLAY}
      contentClassName={COMMAND_CONTENT}
    >
      <RadixDialog.Title className="sr-only">Command menu</RadixDialog.Title>
      <RadixDialog.Description className="sr-only">Search pages and institutions, or change the theme.</RadixDialog.Description>
      <Command.Input
        value={search}
        onValueChange={setSearch}
        placeholder="Search pages and institutions…"
        className={COMMAND_INPUT}
      />
      <Command.List className="max-h-96 overflow-y-auto p-2">
        <Command.Empty className="px-4 py-8 text-center text-sm text-ink-muted">No results</Command.Empty>
        <Command.Group heading="Pages">
          {NAV_ITEMS.map((item) => (
            <CommandItem
              key={item.path}
              icon={item.icon}
              value={`page ${item.label}`}
              keywords={item.keywords}
              onSelect={() => {
                close();
                void navigate({ to: item.path });
              }}
            >
              <span className="flex-1 truncate">{item.label}</span>
              {item.soon ? <span className="text-xs text-ink-muted">Soon</span> : null}
            </CommandItem>
          ))}
          {CONFIGURATION_PAGES.map((item) => (
            <CommandItem
              key={item.tab}
              icon={item.icon}
              value={`page ${item.label}`}
              keywords={item.keywords}
              onSelect={() => {
                close();
                void navigate({ to: '/configuration', search: item.tab === 'packages' ? {} : { tab: item.tab } });
              }}
            >
              <span className="flex-1 truncate">{item.label}</span>
              <span className="text-xs text-ink-muted">Configuration</span>
            </CommandItem>
          ))}
        </Command.Group>
        {(institutions.data?.results.length ?? 0) > 0 ? (
          <Command.Group heading="Institutions">
            {institutions.data?.results.map((institution) => (
              <CommandItem
                key={institution.slug}
                icon={Building2}
                value={`institution ${institution.name} ${institution.slug}`}
                keywords={[search]}
                onSelect={() => {
                  close();
                  void navigate({ to: '/institutions/$slug', params: { slug: institution.slug } });
                }}
              >
                <span className="flex-1 truncate">{institution.name}</span>
                <span className="text-xs text-ink-muted">{institution.slug}</span>
              </CommandItem>
            ))}
          </Command.Group>
        ) : null}
        <ThemeCommands onDone={close} />
      </Command.List>
    </Command.Dialog>
  );
}

/** The Theme group of a command menu; `onDone` closes the menu. */
export function ThemeCommands({ onDone }: { onDone: () => void }) {
  const { setMode } = useTheme();
  const choose = (mode: ThemeMode) => {
    setMode(mode);
    onDone();
  };
  return (
    <Command.Group heading="Theme">
      <CommandItem icon={Sun} value="theme light" keywords={['appearance', 'mode']} onSelect={() => choose('light')}>
        Use light theme
      </CommandItem>
      <CommandItem icon={Moon} value="theme dark" keywords={['appearance', 'mode']} onSelect={() => choose('dark')}>
        Use dark theme
      </CommandItem>
      <CommandItem icon={Monitor} value="theme system" keywords={['appearance', 'mode', 'auto']} onSelect={() => choose('system')}>
        Match system theme
      </CommandItem>
    </Command.Group>
  );
}
