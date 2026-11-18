import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';

interface SearchInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  delay?: number;
  className?: string;
}

/** Keeps typing responsive and reports the value after a short pause. */
export function SearchInput({ label, value, onChange, placeholder, delay = 250, className }: SearchInputProps) {
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  useEffect(() => {
    if (draft === value) return undefined;
    const timer = window.setTimeout(() => onChange(draft), delay);
    return () => window.clearTimeout(timer);
  }, [draft, value, delay, onChange]);

  return (
    <div className={cn('relative w-full max-w-xs', className)}>
      <Search aria-hidden="true" size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted" />
      <input
        type="search"
        aria-label={label}
        value={draft}
        placeholder={placeholder ?? label}
        onChange={(event) => setDraft(event.target.value)}
        className="h-10 w-full rounded-lg border border-stroke bg-surface pr-9 pl-9 text-sm text-ink placeholder:text-ink-muted hover:border-stroke-intense focus:border-brand focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-outline [&::-webkit-search-cancel-button]:hidden"
      />
      {draft ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setDraft('');
            onChange('');
          }}
          className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-ink-muted hover:bg-hover hover:text-ink"
        >
          <X aria-hidden="true" size={14} />
        </button>
      ) : null}
    </div>
  );
}
