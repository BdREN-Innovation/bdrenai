import { ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton } from './Button';
import { formatNumber } from '@/lib/format';

interface PaginationProps {
  page: number;
  pageSize: number;
  count: number;
  onPage: (page: number) => void;
  noun?: string;
}

export function Pagination({ page, pageSize, count, onPage, noun = 'results' }: PaginationProps) {
  const pages = Math.max(Math.ceil(count / pageSize), 1);
  const first = count === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, count);
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 pt-3 text-xs text-ink-muted">
      <span className="tabular" aria-live="polite">
        {count === 0 ? `No ${noun}` : `${formatNumber(first)}–${formatNumber(last)} of ${formatNumber(count)} ${noun}`}
      </span>
      <div className="flex items-center gap-1">
        <IconButton icon={ChevronLeft} label="Previous page" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} />
        <span className="tabular px-1">
          Page {page} of {pages}
        </span>
        <IconButton icon={ChevronRight} label="Next page" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} />
      </div>
    </nav>
  );
}
