import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { InstitutionDetail } from '@/api/types';
import { Button, Card, ErrorState, LoadingState } from '@/components/ui';
import { SubscriptionTable } from '@/features/billing/subscriptions';
import { PaymentTable } from '@/features/billing/payments';
import { PaymentDrawer } from '@/features/billing/drawer';
import { useInstitutionBilling } from '@/api/queries';

export function Billing({ institution, onRecordPayment }: { institution: InstitutionDetail; onRecordPayment: () => void }) {
  const billing = useInstitutionBilling(institution.slug);
  const [openId, setOpenId] = useState<string | null>(null);

  if (billing.isPending) return <LoadingState />;
  if (billing.isError) return <ErrorState error={billing.error} onRetry={() => void billing.refetch()} />;

  return (
    <div className="flex flex-col gap-5">
      <Card
        title="Subscriptions"
        description="Packages this institution has had, current first."
        action={
          <Button size="sm" variant="primary" icon={Plus} onClick={onRecordPayment}>
            Record payment
          </Button>
        }
      >
        <SubscriptionTable
          label={`Subscriptions of ${institution.name}`}
          subscriptions={billing.data.subscriptions}
          loading={false}
          emptyText="No subscriptions yet. Record a payment to start one."
          showInstitution={false}
        />
      </Card>
      <Card title="Payments" description="The latest 50 payments, by bKash and manual.">
        <PaymentTable
          label={`Payments of ${institution.name}`}
          payments={billing.data.payments}
          loading={false}
          emptyText="No payments yet."
          showInstitution={false}
          onOpen={(payment) => setOpenId(payment.id)}
        />
      </Card>
      <PaymentDrawer paymentId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
