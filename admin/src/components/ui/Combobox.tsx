import { useId, useState } from 'react';
import { LoaderCircle, Search } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface ComboboxOption {
  value: string;
  label: string;
  hint?: ReactNode;
}

interface ComboboxProps {
  label: string;
  inputValue: string;
  onInputChange: (value: string) => void;
  options: ComboboxOption[];
  onSelect: (option: ComboboxOption) => void;
  loading?: boolean;
  placeholder?: string;
  emptyText?: string;
  required?: boolean;
  error?: string;
  autoFocus?: boolean;
}

/** WAI-ARIA combobox with a listbox popup: type to filter, arrows to move, Enter to pick, Escape to close. */
export function Combobox({
  label,
  inputValue,
  onInputChange,
  options,
  onSelect,
  loading = false,
  placeholder,
  emptyText = 'No matches',
  required,
  error,
  autoFocus,
}: ComboboxProps) {
  const id = useId();
  const listId = `${id}-list`;
  const errorId = `${id}-error`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const activeIndex = Math.min(active, Math.max(options.length - 1, 0));
  const optionId = (index: number) => `${id}-option-${index}`;

  const pick = (option: ComboboxOption) => {
    onSelect(option);
    setOpen(false);
  };

  const move = (step: number) => {
    if (!open) {
      setOpen(true);
      return;
    }
    if (options.length > 0) setActive((activeIndex + step + options.length) % options.length);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter' && open && options[activeIndex]) {
      event.preventDefault();
      pick(options[activeIndex]);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-ink">
        {label}
        {required ? <span className="text-ink-muted"> (required)</span> : null}
      </label>
      <div className="relative">
        <Search aria-hidden="true" size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted" />
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options.length > 0 ? optionId(activeIndex) : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          autoComplete="off"
          autoFocus={autoFocus}
          value={inputValue}
          placeholder={placeholder}
          onChange={(event) => {
            onInputChange(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className="h-10 w-full rounded-lg border border-stroke bg-surface pr-9 pl-9 text-sm text-ink placeholder:text-ink-muted hover:border-stroke-intense focus:border-brand focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-outline aria-invalid:border-danger-fg"
        />
        {loading ? (
          <LoaderCircle aria-hidden="true" size={15} className="absolute top-1/2 right-3 -translate-y-1/2 animate-spin text-ink-muted" />
        ) : null}
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} suggestions`}
          hidden={!open}
          className="absolute top-full right-0 left-0 z-70 mt-1 max-h-64 overflow-y-auto rounded-lg border border-stroke bg-surface p-1 shadow-modal"
        >
          {options.length === 0 ? (
            <li role="presentation" className="px-3 py-2 text-[13px] text-ink-muted">
              {loading ? 'Searching…' : emptyText}
            </li>
          ) : (
            options.map((option, index) => (
              <li
                key={option.value}
                id={optionId(index)}
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(option)}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 text-[13px] text-ink',
                  index === activeIndex && 'bg-brand-tint',
                )}
              >
                <span className="truncate font-medium">{option.label}</span>
                {option.hint ? <span className="shrink-0 text-xs text-ink-muted">{option.hint}</span> : null}
              </li>
            ))
          )}
        </ul>
      </div>
      {error ? (
        <p id={errorId} className="text-xs font-medium text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}
