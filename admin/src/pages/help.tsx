import { Building2, Command, LifeBuoy, Mail, ScrollText } from 'lucide-react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui';
import { Page } from '@/components/layout/Page';

function Tip({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3 border-t border-stroke-muted py-3 first:border-t-0 first:pt-0">
      <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-tint text-brand-ink">
        <Icon size={15} />
      </span>
      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] font-semibold text-ink">{title}</span>
        <span className="text-[13px] text-ink-muted">{children}</span>
      </div>
    </li>
  );
}

export function HelpPage() {
  return (
    <Page title="Help">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Getting around">
          <ul className="flex flex-col">
            <Tip icon={Command} title="Command menu">
              Press ⌘K (Ctrl K on Windows and Linux) to jump to any page or institution, or to change the theme.
            </Tip>
            <Tip icon={Building2} title="Institutions and seats">
              Seats count covered members (active or suspended) plus pending invitations across every app. People who joined with their institution email but are not on the package are listed as Not covered and use no seat. A person belongs to one institution at most; Take out of institution on the Members tab moves them out.
            </Tip>
            <Tip icon={Mail} title="Invitations">
              Invite an institution admin from Invitations; if the institution is not listed, create it in the same dialog. Resend gives a new link and the old one stops working.
            </Tip>
            <Tip icon={ScrollText} title="Audit log">
              Every change made here is recorded with who, when and the reason you gave.
            </Tip>
          </ul>
        </Card>
        <Card title="Contact the BdREN NOC">
          <div className="flex gap-3">
            <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-tint text-brand-ink">
              <LifeBuoy size={15} />
            </span>
            <div className="flex flex-col gap-2 text-[13px] text-ink-muted">
              <p>For sign-in problems, ZITADEL issues, or anything this panel cannot do yet, contact the BdREN AI platform team.</p>
              <p>
                Email{' '}
                <a href="mailto:noc@bdren.edu.bd" className="font-semibold text-brand hover:underline">
                  noc@bdren.edu.bd
                </a>{' '}
                with the institution slug, the affected email address and what you tried. Include the time it happened so we can find it in the audit log.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </Page>
  );
}
