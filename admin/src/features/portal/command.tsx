import { useState } from 'react';
import { Command } from 'cmdk';
import * as RadixDialog from '@radix-ui/react-dialog';
import { useNavigate } from '@tanstack/react-router';
import { Building2, Mail, ShieldCheck, UserRound, Users } from 'lucide-react';
import type { MembersSearch } from './tabs';
import { COMMAND_CONTENT, COMMAND_INPUT, COMMAND_OVERLAY, CommandItem, ThemeCommands } from '@/components/layout/CommandMenu';
import { PORTAL_PATHS } from './tabs';
import { PORTAL_NAV } from './sidebar';
import { useAccess } from './access';

const MEMBER_TABS: { label: string; search: MembersSearch; icon: typeof Users }[] = [
  { label: 'Invited members', search: { tab: 'invited' }, icon: Mail },
  { label: 'Members not covered', search: { tab: 'not_covered' }, icon: Users },
  { label: 'Members on a personal plan', search: { tab: 'personal_plan' }, icon: UserRound },
];

/** ⌘K in the institution console: its pages and Members tabs, the other institutions and consoles, the theme. */
export function PortalCommandMenu({ slug, open, onOpenChange }: { slug: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const { session, institutions } = useAccess();
  const [search, setSearch] = useState('');
  const others = institutions.filter((institution) => institution.slug !== slug);

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
      <RadixDialog.Description className="sr-only">Search the console's pages, or change the theme.</RadixDialog.Description>
      <Command.Input value={search} onValueChange={setSearch} placeholder="Search pages…" className={COMMAND_INPUT} />
      <Command.List className="max-h-96 overflow-y-auto p-2">
        <Command.Empty className="px-4 py-8 text-center text-sm text-ink-muted">No results</Command.Empty>
        <Command.Group heading="Pages">
          {PORTAL_NAV.flatMap((section) => section.items).map((item) => (
            <CommandItem
              key={item.page}
              icon={item.icon}
              value={`page ${item.label}`}
              keywords={item.keywords}
              onSelect={() => {
                close();
                void navigate({ to: PORTAL_PATHS[item.page], params: { slug } });
              }}
            >
              {item.label}
            </CommandItem>
          ))}
          {MEMBER_TABS.map((item) => (
            <CommandItem
              key={item.label}
              icon={item.icon}
              value={`page ${item.label}`}
              keywords={['members', 'tab']}
              onSelect={() => {
                close();
                void navigate({ to: PORTAL_PATHS.members, params: { slug }, search: item.search });
              }}
            >
              <span className="flex-1 truncate">{item.label}</span>
              <span className="text-xs text-ink-muted">Members</span>
            </CommandItem>
          ))}
        </Command.Group>
        {others.length > 0 || session ? (
          <Command.Group heading="Consoles">
            {others.map((institution) => (
              <CommandItem
                key={institution.slug}
                icon={Building2}
                value={`institution ${institution.name} ${institution.slug}`}
                onSelect={() => {
                  close();
                  void navigate({ to: PORTAL_PATHS.dashboard, params: { slug: institution.slug } });
                }}
              >
                <span className="flex-1 truncate">{institution.name}</span>
                <span className="text-xs text-ink-muted">Institution</span>
              </CommandItem>
            ))}
            {session ? (
              <CommandItem
                icon={ShieldCheck}
                value="console platform"
                keywords={['superadmin']}
                onSelect={() => {
                  close();
                  void navigate({ to: '/' });
                }}
              >
                Platform console
              </CommandItem>
            ) : null}
          </Command.Group>
        ) : null}
        <ThemeCommands onDone={close} />
      </Command.List>
    </Command.Dialog>
  );
}
