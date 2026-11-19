import { AtSign, ChartColumn, Command, LifeBuoy, ReceiptText, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { SUPPORT_EMAIL, supportMailto } from '@/features/portal/support';
import { usePortal } from '@/features/portal/shell';
import { Page } from '@/components/layout/Page';
import { Card } from '@/components/ui';

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

/** How the institution console works, and how to reach BDREN support. */
export function PortalHelpPage() {
  const { institution } = usePortal();
  const mailto = supportMailto(`Help with ${institution.name}`, `Institution: ${institution.name} (${institution.slug})\nWhat I need: \n`);
  return (
    <Page title="Help" subtitle={institution.name}>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Getting around">
          <ul className="flex flex-col">
            <Tip icon={Users} title="Members and seats">
              Covered members and pending invitations use your seats. People who signed up with your email domain start as Not covered on the free
              tier until you add them to your package. Members who pay for a personal plan are shown read-only and use no seat.
            </Tip>
            <Tip icon={ChartColumn} title="Usage">
              Usage shows only what your institution&apos;s package paid for, never usage by people on a personal plan. Export CSV downloads the
              same period and app.
            </Tip>
            <Tip icon={AtSign} title="Email domains">
              BdREN manages your sign-in domains. Use Request a domain on the Email domains page to ask for a new one.
            </Tip>
            <Tip icon={ReceiptText} title="Billing">
              Renew or upgrade your package and pay with bKash, one payment per period. A cheaper package can be scheduled for the next
              renewal. Receipts for every completed payment are on the Billing page.
            </Tip>
            <Tip icon={Command} title="Command menu">
              Press ⌘K (Ctrl K on Windows and Linux) to jump to any page, or to change the theme.
            </Tip>
          </ul>
        </Card>
        <Card title="Contact BDREN support">
          <div className="flex gap-3">
            <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-tint text-brand-ink">
              <LifeBuoy size={15} />
            </span>
            <div className="flex flex-col gap-2 text-[13px] text-ink-muted">
              <p>
                For a person in the wrong institution, a seat or package change, or anything this console cannot do, contact the BdREN AI platform
                team.
              </p>
              <p>
                Email{' '}
                <a href={mailto} className="font-semibold text-brand hover:underline">
                  {SUPPORT_EMAIL}
                </a>{' '}
                with your institution, the affected email address and what you tried.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </Page>
  );
}
