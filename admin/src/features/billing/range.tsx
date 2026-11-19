import type { DateRange } from '@/api/types';
import { Input, Select } from '@/components/ui';
import { addDays, isoDay } from './labels';

export type RangePreset = '30d' | '90d' | 'month' | 'year' | 'custom';

const PRESETS: { value: RangePreset; label: string }[] = [
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'month', label: 'This month' },
  { value: 'year', label: 'This year' },
  { value: 'custom', label: 'Custom range' },
];

export interface RangeValue extends DateRange {
  preset: RangePreset;
}

/** The dates a preset stands for, counted back from `now` (both ends inclusive). */
export function presetRange(preset: Exclude<RangePreset, 'custom'>, now: Date = new Date()): DateRange {
  const to = isoDay(now);
  if (preset === '30d') return { from: addDays(to, -29), to };
  if (preset === '90d') return { from: addDays(to, -89), to };
  if (preset === 'month') return { from: `${to.slice(0, 7)}-01`, to };
  return { from: `${to.slice(0, 4)}-01-01`, to };
}

export const defaultRange = (): RangeValue => ({ preset: '30d', ...presetRange('30d') });

export function RangePicker({ value, onChange }: { value: RangeValue; onChange: (value: RangeValue) => void }) {
  return (
    <div role="group" aria-label="Date range" className="flex flex-wrap items-center gap-2">
      <Select
        aria-label="Period"
        inline
        value={value.preset}
        onChange={(event) => {
          const preset = event.target.value as RangePreset;
          onChange(preset === 'custom' ? { ...value, preset } : { preset, ...presetRange(preset) });
        }}
      >
        {PRESETS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      {value.preset === 'custom' ? (
        <>
          <Input
            type="date"
            aria-label="From"
            className="w-40"
            value={value.from}
            max={value.to}
            onChange={(event) => event.target.value && onChange({ ...value, from: event.target.value })}
          />
          <span aria-hidden="true" className="text-ink-muted">
            –
          </span>
          <Input
            type="date"
            aria-label="To"
            className="w-40"
            value={value.to}
            min={value.from}
            onChange={(event) => event.target.value && onChange({ ...value, to: event.target.value })}
          />
        </>
      ) : null}
    </div>
  );
}
