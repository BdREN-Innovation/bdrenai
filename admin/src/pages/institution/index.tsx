import { useState } from 'react';
import { Link, getRouteApi } from '@tanstack/react-router';
import { Ban, Banknote, Building2, Mail, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import type { StatusRequest } from '@/features/institutions/status';
import { Button, EmptyState, ErrorState, LoadingState, StatusChip, Tabs } from '@/components/ui';
import { InstitutionStatusDialog } from '@/features/institutions/status';
import { InviteAdminDialog } from '@/features/invitations/invite';
import { RecordPaymentDialog } from '@/features/billing/record';
import { InstitutionInvitations } from './invitations';
import { useInstitution } from '@/api/queries';
import { Page } from '@/components/layout/Page';
import { ApiError } from '@/api/client';
import { EditInstitutionDialog } from './edit';
import { TYPE_LABEL } from '@/lib/labels';
import { History } from './history';
import { Billing } from './billing';
import { Overview } from './overview';
import { Members } from './members';
import { Import } from './import';

export const INSTITUTION_TABS = ['overview', 'members', 'invitations', 'import', 'billing', 'history'] as const;
export type InstitutionTab = (typeof INSTITUTION_TABS)[number];

const TAB_LABEL: Record<InstitutionTab, string> = {
  overview: 'Overview',
  members: 'Members',
  invitations: 'Invitations',
  import: 'Import',
  billing: 'Billing',
  history: 'History',
};

const route = getRouteApi('/institutions/$slug');

export function InstitutionDetailPage() {
  const { slug } = route.useParams();
  const { tab = 'overview' } = route.useSearch();
  const navigate = route.useNavigate();
  const detail = useInstitution(slug);
  const [editing, setEditing] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [statusRequest, setStatusRequest] = useState<StatusRequest | null>(null);

  if (detail.isPending) {
    return (
      <Page title="Institution">
        <LoadingState />
      </Page>
    );
  }

  if (detail.isError) {
    const missing = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <Page title="Institution">
        {missing ? (
          <EmptyState
            icon={Building2}
            title="Institution not found"
            action={
              <Link to="/institutions" className="text-[13px] font-semibold text-brand hover:underline">
                Back to institutions
              </Link>
            }
          >
            No institution uses the slug “{slug}”.
          </EmptyState>
        ) : (
          <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
        )}
      </Page>
    );
  }

  const institution = detail.data;
  const ref = { slug: institution.slug, name: institution.name };
  const removed = institution.status === 'deactivated';
  const counts = institution.counts;

  return (
    <Page
      title={institution.name}
      subtitle={
        <span className="inline-flex items-center gap-2">
          <Link to="/institutions" className="hover:text-ink hover:underline">
            Institutions
          </Link>
          <span aria-hidden="true">/</span>
          <span>
            {TYPE_LABEL[institution.type]} · {institution.slug}
          </span>
          <StatusChip status={institution.status} />
        </span>
      }
      actions={
        <>
          {!removed ? (
            <Button icon={Pencil} onClick={() => setEditing(true)}>
              Edit
            </Button>
          ) : null}
          {institution.status === 'active' ? (
            <Button variant="danger" icon={Ban} onClick={() => setStatusRequest({ institution: ref, action: 'suspend' })}>
              Suspend
            </Button>
          ) : (
            <Button icon={RotateCcw} onClick={() => setStatusRequest({ institution: ref, action: 'reactivate' })}>
              Reactivate
            </Button>
          )}
          {!removed ? (
            <Button variant="danger" icon={Trash2} onClick={() => setStatusRequest({ institution: ref, action: 'deactivate' })}>
              Remove
            </Button>
          ) : null}
          {!removed ? (
            <Button icon={Banknote} onClick={() => setRecording(true)}>
              Record payment
            </Button>
          ) : null}
          {!removed ? (
            <Button variant="primary" icon={Mail} onClick={() => setInviting(true)}>
              Invite admin
            </Button>
          ) : null}
        </>
      }
    >
      <Tabs
        label="Institution sections"
        value={tab}
        onChange={(next) => void navigate({ search: next === 'overview' ? {} : { tab: next }, replace: true })}
        items={INSTITUTION_TABS.map((value) => ({
          value,
          label: TAB_LABEL[value],
          count:
            value === 'members'
              ? counts.members
              : value === 'invitations'
                ? counts.pending_invitations + counts.expired_invitations
                : undefined,
        }))}
      >
        {tab === 'overview' ? <Overview institution={institution} onEdit={() => setEditing(true)} /> : null}
        {tab === 'members' ? <Members institution={institution} /> : null}
        {tab === 'invitations' ? <InstitutionInvitations institution={institution} onInvite={() => setInviting(true)} /> : null}
        {tab === 'import' ? <Import institution={institution} /> : null}
        {tab === 'billing' ? <Billing institution={institution} onRecordPayment={() => setRecording(true)} /> : null}
        {tab === 'history' ? <History slug={institution.slug} /> : null}
      </Tabs>

      <EditInstitutionDialog institution={institution} open={editing} onOpenChange={setEditing} />
      <InviteAdminDialog open={inviting} onOpenChange={setInviting} institution={inviting ? ref : undefined} />
      <RecordPaymentDialog open={recording} onOpenChange={setRecording} institution={ref} />
      <InstitutionStatusDialog request={statusRequest} onClose={() => setStatusRequest(null)} />
    </Page>
  );
}
