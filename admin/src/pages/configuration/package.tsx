import { useState } from 'react';
import { Link, getRouteApi } from '@tanstack/react-router';
import { Archive, ArchiveRestore, ChevronDown, Layers, Pencil, Plus } from 'lucide-react';
import type { ConfigApp, PackageDetail, PackageVersion } from '@/api/types';
import type { EditorTarget } from '@/features/packages/editor';
import type { PackageStatusAction } from '@/api/queries';
import { Button, Card, Chip, EmptyState, ErrorState, LoadingState, Notice, StatusChip } from '@/components/ui';
import { AppChips, Price, VisibilityChips, seatLimitText, trialText } from '@/features/packages/chips';
import { describeChange, formatLimit, groupBy, versionChanges } from '@/features/packages/describe';
import { MIGRATION_LABEL, PACKAGE_KIND_LABEL } from '@/lib/labels';
import { PresentationDialog } from '@/features/packages/presentation';
import { formatDate, formatDateTime, formatNumber } from '@/lib/format';
import { PackageStatusDialog } from '@/features/packages/archive';
import { PackageEditor } from '@/features/packages/editor';
import { useConfigApps, usePackage } from '@/api/queries';
import { Page } from '@/components/layout/Page';
import { ApiError } from '@/api/client';
import { cn } from '@/lib/cn';

const route = getRouteApi('/configuration/packages/$id');

function Summary({ pkg, catalog }: { pkg: PackageDetail; catalog: ConfigApp[] }) {
  return (
    <Card title="Summary">
      <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-2.5 text-[13px]">
        <dt className="text-ink-muted">Kind</dt>
        <dd>{PACKAGE_KIND_LABEL[pkg.kind]}</dd>
        <dt className="text-ink-muted">Apps</dt>
        <dd>
          <AppChips pkg={pkg} catalog={catalog} />
        </dd>
        <dt className="text-ink-muted">Price</dt>
        <dd>
          <Price terms={pkg} />
        </dd>
        <dt className="text-ink-muted">Trial</dt>
        <dd>{trialText(pkg.trial_days)}</dd>
        <dt className="text-ink-muted">Seat limit</dt>
        <dd>{seatLimitText(pkg.seat_limit)}</dd>
        <dt className="text-ink-muted">Version</dt>
        <dd className="tabular">v{pkg.current_version}</dd>
        <dt className="text-ink-muted">Subscribers</dt>
        <dd className="tabular">{formatNumber(pkg.subscribers)}</dd>
        <dt className="text-ink-muted">Visibility</dt>
        <dd>
          <VisibilityChips pkg={pkg} />
        </dd>
        <dt className="text-ink-muted">Who it is for</dt>
        <dd>{pkg.audience || '—'}</dd>
        <dt className="text-ink-muted">Description</dt>
        <dd className="whitespace-pre-line">{pkg.description || '—'}</dd>
        <dt className="text-ink-muted">Slug</dt>
        <dd className="font-mono text-xs">{pkg.slug}</dd>
        <dt className="text-ink-muted">Updated</dt>
        <dd>{formatDate(pkg.updated_at)}</dd>
      </dl>
    </Card>
  );
}

function CurrentLimits({ pkg }: { pkg: PackageDetail }) {
  const byApp = groupBy(pkg.limits, (limit) => limit.feature.app.slug);
  return (
    <Card title="Current limits" description={`What version ${pkg.current_version} allows, per app. An app without limits is unlimited.`}>
      {pkg.apps.map((app) => {
        const limits = byApp.get(app.slug) ?? [];
        return (
          <div key={app.slug} className="flex flex-col gap-1.5 border-t border-stroke-muted pt-3 first:border-t-0 first:pt-0">
            <h3 className="text-[13px] font-semibold text-ink">{app.name}</h3>
            {limits.length === 0 ? (
              <p className="text-[13px] text-ink-muted">Unlimited</p>
            ) : (
              <dl className="grid grid-cols-[minmax(8rem,14rem)_1fr] gap-x-3 gap-y-1.5 text-[13px]">
                {limits.map((limit) => (
                  <div key={limit.feature.id} className="contents">
                    <dt className="text-ink-muted">{limit.feature.name}</dt>
                    <dd className="tabular">{formatLimit(limit, limit.feature.unit)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        );
      })}
    </Card>
  );
}

interface VersionEntryProps {
  version: PackageVersion;
  /** The version before it; undefined for version 1. */
  previous: PackageVersion | undefined;
  currency: string;
  current: boolean;
  expanded: boolean;
  onToggle: () => void;
}

function VersionEntry({ version, previous, currency, current, expanded, onToggle }: VersionEntryProps) {
  const panelId = `version-${version.version}`;
  const lines = previous ? versionChanges(version, previous).map((change) => describeChange(change, currency)) : [];
  return (
    <li className="border-t border-stroke-muted first:border-t-0">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center gap-3 py-3 text-left"
      >
        <ChevronDown aria-hidden="true" size={16} className={cn('shrink-0 text-ink-muted transition-transform', !expanded && '-rotate-90')} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            Version {version.version}
            {current ? <Chip tone="brand">Current</Chip> : null}
          </span>
          <span className="truncate text-xs text-ink-muted">
            {formatDateTime(version.created_at)}
            {version.created_by ? ` · ${version.created_by.name || version.created_by.email}` : ''}
          </span>
        </span>
        <span className="tabular shrink-0 text-xs text-ink-muted">{formatNumber(version.subscribers)} subscribers</span>
      </button>
      {expanded ? (
        <div id={panelId} className="flex flex-col gap-2 pb-4 pl-7 text-[13px]">
          {version.change_reason ? <p className="text-ink">“{version.change_reason}”</p> : null}
          {previous ? (
            <>
              <p className="text-xs text-ink-muted">Existing subscribers: {MIGRATION_LABEL[version.migration_policy].toLowerCase()}</p>
              {lines.length === 0 ? (
                <p className="text-ink-muted">No commercial changes from version {previous.version}.</p>
              ) : (
                <ul aria-label={`Changes in version ${version.version}`} className="flex flex-col gap-1">
                  {lines.map((line) => (
                    <li key={line} className="flex gap-2">
                      <span aria-hidden="true" className="text-ink-muted">
                        •
                      </span>
                      {line}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="text-ink-muted">First version.</p>
          )}
        </div>
      ) : null}
    </li>
  );
}

function VersionHistory({ pkg }: { pkg: PackageDetail }) {
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set([pkg.current_version]));
  const toggle = (version: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(version)) next.delete(version);
      else next.add(version);
      return next;
    });
  return (
    <Card title="Version history" description="Every version is kept. Subscribers stay on the version they joined unless a migration moved them.">
      <ul className="flex flex-col">
        {pkg.versions.map((version, index) => (
          <VersionEntry
            key={version.version}
            version={version}
            previous={pkg.versions[index + 1]}
            currency={pkg.currency}
            current={version.version === pkg.current_version}
            expanded={open.has(version.version)}
            onToggle={() => toggle(version.version)}
          />
        ))}
      </ul>
    </Card>
  );
}

export function PackageDetailPage() {
  const { id } = route.useParams();
  const detail = usePackage(id);
  const catalog = useConfigApps();
  const [editing, setEditing] = useState(false);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [statusAction, setStatusAction] = useState<PackageStatusAction | null>(null);

  if (detail.isPending) {
    return (
      <Page title="Package">
        <LoadingState />
      </Page>
    );
  }

  if (detail.isError) {
    const missing = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <Page title="Package">
        {missing ? (
          <EmptyState
            icon={Layers}
            title="Package not found"
            action={
              <Link to="/configuration" className="text-[13px] font-semibold text-brand hover:underline">
                Back to packages
              </Link>
            }
          >
            This package does not exist, or its link is wrong.
          </EmptyState>
        ) : (
          <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
        )}
      </Page>
    );
  }

  const pkg = detail.data;
  const archived = pkg.status === 'archived';

  return (
    <Page
      title={pkg.name}
      subtitle={
        <span className="inline-flex items-center gap-2">
          <Link to="/configuration" className="hover:text-ink hover:underline">
            Packages
          </Link>
          <span aria-hidden="true">/</span>
          <span>
            {PACKAGE_KIND_LABEL[pkg.kind]} · {pkg.slug}
          </span>
          <StatusChip status={pkg.status} />
        </span>
      }
      actions={
        <>
          <Button icon={Pencil} onClick={() => setEditing(true)}>
            Edit details
          </Button>
          {archived ? (
            <Button icon={ArchiveRestore} onClick={() => setStatusAction('restore')}>
              Restore
            </Button>
          ) : (
            <Button variant="danger" icon={Archive} onClick={() => setStatusAction('archive')}>
              Archive
            </Button>
          )}
          <Button variant="primary" icon={Plus} onClick={() => setEditor({ mode: 'version', pkg })}>
            New version
          </Button>
        </>
      }
    >
      {archived ? (
        <Notice>This package is archived: it is off the pricing page and takes no new subscribers. Existing subscribers keep it.</Notice>
      ) : null}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="flex flex-col gap-5 xl:col-span-2">
          <CurrentLimits pkg={pkg} />
          <VersionHistory pkg={pkg} />
        </div>
        <Summary pkg={pkg} catalog={catalog.data?.results ?? []} />
      </div>
      <PresentationDialog pkg={pkg} open={editing} onOpenChange={setEditing} />
      <PackageEditor target={editor} onClose={() => setEditor(null)} />
      <PackageStatusDialog pkg={pkg} action={statusAction} onClose={() => setStatusAction(null)} />
    </Page>
  );
}
