import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import type { ConfigApp } from '@/api/types';
import type { FeatureTarget } from '@/features/apps/feature';
import { Button, Card, Chip, ErrorState, IconButton, LoadingState, StatusChip, Table, Td, Th } from '@/components/ui';
import { FeatureDialog } from '@/features/apps/feature';
import { QUOTA_POLICY_LABEL } from '@/lib/labels';
import { useConfigApps } from '@/api/queries';
import { AppDialog } from '@/features/apps/app';

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

function AppCard({ app, onEdit, onFeature }: { app: ConfigApp; onEdit: () => void; onFeature: (target: FeatureTarget) => void }) {
  return (
    <Card
      title={app.name}
      description={app.description || 'No description yet.'}
      action={
        <div className="flex shrink-0 gap-2">
          <Button size="sm" icon={Pencil} onClick={onEdit}>
            Edit app
          </Button>
          <Button size="sm" variant="primary" icon={Plus} onClick={() => onFeature({ app, feature: null })}>
            Add feature
          </Button>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        <StatusChip status={app.status} />
        <span className="font-mono">{app.slug}</span>
        <span aria-hidden="true">·</span>
        <span>
          {plural(app.packages.single, 'single package')} · {plural(app.packages.bundle, 'combined package')}
        </span>
      </div>
      {app.features.length === 0 ? (
        <p className="text-[13px] text-ink-muted">No features yet. Add one so packages can set limits for {app.name}.</p>
      ) : (
        <Table label={`${app.name} features`}>
          <thead>
            <tr>
              <Th>Key</Th>
              <Th>Name</Th>
              <Th>Unit</Th>
              <Th>Quota policy</Th>
              <Th>Status</Th>
              <Th>In use</Th>
              <Th className="w-12">
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {app.features.map((feature) => (
              <tr key={feature.id}>
                <Td className="font-mono text-xs">{feature.key}</Td>
                <Td className="font-medium">{feature.name}</Td>
                <Td>{feature.unit}</Td>
                <Td className="whitespace-nowrap">{QUOTA_POLICY_LABEL[feature.quota_policy]}</Td>
                <Td>
                  <StatusChip status={feature.status} />
                </Td>
                <Td>{feature.in_use ? <Chip tone="brand">In use</Chip> : <span className="text-ink-muted">No</span>}</Td>
                <Td className="text-right">
                  <IconButton icon={Pencil} size="sm" label={`Edit ${feature.name}`} onClick={() => onFeature({ app, feature })} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

/** One card per app sold on the platform, with the features its packages can limit. */
export function AppsTab() {
  const apps = useConfigApps();
  const [editing, setEditing] = useState<ConfigApp | null>(null);
  const [feature, setFeature] = useState<FeatureTarget | null>(null);

  if (apps.isPending) return <LoadingState />;
  if (apps.isError) return <ErrorState error={apps.error} onRetry={() => void apps.refetch()} />;

  return (
    <div className="flex flex-col gap-5">
      {apps.data.results.map((app) => (
        <AppCard key={app.slug} app={app} onEdit={() => setEditing(app)} onFeature={setFeature} />
      ))}
      <AppDialog app={editing} onClose={() => setEditing(null)} />
      <FeatureDialog target={feature} onClose={() => setFeature(null)} />
    </div>
  );
}
