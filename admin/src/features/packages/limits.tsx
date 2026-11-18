import { Plus, Trash2 } from 'lucide-react';
import type { ConfigApp, Feature, LimitPeriod, OnLimit } from '@/api/types';
import type { DraftErrors, LimitField, LimitRow } from './draft';
import { Button, IconButton, Input, Select, Table, Td, Th } from '@/components/ui';
import { LIMIT_PERIODS, ON_LIMIT } from '@/lib/labels';
import { limitError, newRowKey } from './draft';
import { groupBy } from './describe';

interface LimitsEditorProps {
  /** The apps included in the package, in display order. */
  apps: ConfigApp[];
  rows: LimitRow[];
  onChange: (rows: LimitRow[]) => void;
  errors: DraftErrors;
}

const usable = (feature: Feature, taken: Set<string>, current: string) =>
  feature.id === current || (feature.status === 'active' && !taken.has(feature.id));

/** Error state of one control in a limit row: the props that tie it to its message, and the message. */
function controlError(errors: DraftErrors, row: LimitRow, field: LimitField) {
  const id = limitError(row.key, field);
  const message = errors[id];
  return {
    message: message ? <p id={id} className="pt-1 text-xs font-medium text-danger-fg">{message}</p> : null,
    props: message ? { 'aria-invalid': true, 'aria-describedby': id } : {},
  };
}

type RowsUpdate = (update: (rows: LimitRow[]) => LimitRow[]) => void;

interface AppLimitsProps {
  app: ConfigApp;
  rows: LimitRow[];
  taken: Set<string>;
  onRows: RowsUpdate;
  errors: DraftErrors;
}

function AppLimits({ app, rows, taken, onRows, errors }: AppLimitsProps) {
  const free = app.features.filter((feature) => usable(feature, taken, ''));
  const patch = (key: string, change: Partial<LimitRow>) =>
    onRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));
  const add = () =>
    onRows((current) => [
      ...current,
      { key: newRowKey(), app: app.slug, feature_id: free[0]?.id ?? '', limit_value: '', limit_period: 'monthly', on_limit: 'block' },
    ]);

  return (
    <div role="group" aria-label={`${app.name} limits`} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-[13px] font-semibold text-ink">{app.name}</h4>
        <Button size="sm" variant="ghost" icon={Plus} onClick={add} disabled={free.length === 0}>
          Add {app.name} limit
        </Button>
      </div>
      {app.features.length === 0 ? (
        <p className="text-xs text-ink-muted">{app.name} has no features yet. Add them under Apps &amp; features.</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-ink-muted">No limits: {app.name} is unlimited in this package.</p>
      ) : (
        <Table label={`${app.name} limits`}>
          <thead>
            <tr>
              <Th>Feature</Th>
              <Th>Limit</Th>
              <Th>Period</Th>
              <Th>At the limit</Th>
              <Th className="w-12">
                <span className="sr-only">Remove</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const feature = app.features.find((item) => item.id === row.feature_id);
              const name = feature?.name ?? `${app.name} row ${index + 1}`;
              const [featureError, valueError, periodError, onLimitError] = (
                ['feature_id', 'limit_value', 'limit_period', 'on_limit'] as const
              ).map((field) => controlError(errors, row, field));
              return (
                <tr key={row.key}>
                  <Td className="min-w-48">
                    <Select
                      aria-label={`${app.name} feature ${index + 1}`}
                      {...featureError.props}
                      value={row.feature_id}
                      onChange={(event) => patch(row.key, { feature_id: event.target.value })}
                    >
                      {row.feature_id ? null : <option value="">Choose a feature</option>}
                      {app.features
                        .filter((item) => usable(item, taken, row.feature_id))
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} ({item.unit})
                          </option>
                        ))}
                    </Select>
                    {featureError.message}
                  </Td>
                  <Td className="w-32">
                    <Input
                      aria-label={`${name} limit`}
                      {...valueError.props}
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      value={row.limit_value}
                      onChange={(event) => patch(row.key, { limit_value: event.target.value })}
                    />
                    {valueError.message}
                  </Td>
                  <Td className="w-36">
                    <Select
                      aria-label={`${name} period`}
                      {...periodError.props}
                      value={row.limit_period}
                      onChange={(event) => patch(row.key, { limit_period: event.target.value as LimitPeriod })}
                    >
                      {LIMIT_PERIODS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                    {periodError.message}
                  </Td>
                  <Td className="w-36">
                    <Select
                      aria-label={`${name} at the limit`}
                      {...onLimitError.props}
                      value={row.on_limit}
                      onChange={(event) => patch(row.key, { on_limit: event.target.value as OnLimit })}
                    >
                      {ON_LIMIT.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                    {onLimitError.message}
                  </Td>
                  <Td className="text-right">
                    <IconButton
                      icon={Trash2}
                      size="sm"
                      label={`Remove ${name}`}
                      onClick={() => onRows((current) => current.filter((item) => item.key !== row.key))}
                    />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}

/** Limits grouped by included app; each app offers only its own features, each feature at most once. */
export function LimitsEditor({ apps, rows, onChange, errors }: LimitsEditorProps) {
  const taken = new Set(rows.map((row) => row.feature_id).filter(Boolean));
  const byApp = groupBy(rows, (row) => row.app);
  const onRows: RowsUpdate = (update) => onChange(update(rows));

  if (apps.length === 0) {
    return <p className="text-[13px] text-ink-muted">Choose the package’s apps first; limits use their features.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {apps.map((app) => (
        <AppLimits
          key={app.slug}
          app={app}
          rows={byApp.get(app.slug) ?? []}
          taken={taken}
          onRows={onRows}
          errors={errors}
        />
      ))}
    </div>
  );
}
