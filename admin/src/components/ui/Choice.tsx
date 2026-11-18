import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

const BOX = 'size-4 shrink-0 cursor-pointer accent-brand disabled:cursor-not-allowed';

interface CheckboxProps {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Shown as a dash: some, not all, of a group is checked. */
  indeterminate?: boolean;
  disabled?: boolean;
  className?: string;
}

export function Checkbox({ label, hint, checked, onChange, indeterminate = false, disabled, className }: CheckboxProps) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <input
        ref={ref}
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.target.checked)}
        className={cn(BOX, 'mt-0.5 rounded')}
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={id} className="cursor-pointer text-[13px] font-medium text-ink">
          {label}
        </label>
        {hint ? (
          <p id={`${id}-hint`} className="text-xs text-ink-muted">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export interface RadioOption<T extends string> {
  value: T;
  label: string;
  hint?: ReactNode;
}

interface RadioGroupProps<T extends string> {
  legend: string;
  options: RadioOption<T>[];
  value: T;
  onChange: (value: T) => void;
  error?: string;
}

/** Native radios in a fieldset: arrows move between options, each with its explanation. */
export function RadioGroup<T extends string>({ legend, options, value, onChange, error }: RadioGroupProps<T>) {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={error ? `${name}-error` : undefined}>
      <legend className="pb-1.5 text-xs font-semibold text-ink">{legend}</legend>
      {options.map((option) => {
        const id = `${name}-${option.value}`;
        const selected = option.value === value;
        return (
          <div
            key={option.value}
            className={cn(
              'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors',
              selected ? 'border-brand bg-brand-tint' : 'border-stroke hover:bg-hover',
            )}
          >
            <input
              id={id}
              type="radio"
              name={name}
              value={option.value}
              checked={selected}
              aria-describedby={option.hint ? `${id}-hint` : undefined}
              onChange={() => onChange(option.value)}
              className={cn(BOX, 'mt-0.5')}
            />
            <div className="flex min-w-0 flex-col gap-0.5">
              <label htmlFor={id} className="cursor-pointer text-[13px] font-semibold text-ink">
                {option.label}
              </label>
              {option.hint ? (
                <p id={`${id}-hint`} className="text-xs text-ink-muted">
                  {option.hint}
                </p>
              ) : null}
            </div>
          </div>
        );
      })}
      {error ? (
        <p id={`${name}-error`} className="text-xs font-medium text-danger-fg">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

interface SegmentedProps<T extends string> {
  label: string;
  options: RadioOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** Toolbar filter of a few exclusive choices, built on native radios. */
export function Segmented<T extends string>({ label, options, value, onChange }: SegmentedProps<T>) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={label} className="flex h-10 rounded-lg border border-stroke bg-ground p-0.5">
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            'flex cursor-pointer items-center rounded-md px-3 text-[13px] whitespace-nowrap transition-colors has-focus-visible:outline-2 has-focus-visible:outline-outline',
            option.value === value
              ? 'bg-surface font-semibold text-ink shadow-[0_1px_2px_rgb(0_0_0/0.05)]'
              : 'font-medium text-ink-muted hover:text-ink',
          )}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
            className="sr-only"
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
