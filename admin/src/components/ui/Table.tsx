import type { HTMLAttributes, KeyboardEvent, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export function Table({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto rounded-xl border border-stroke bg-surface', className)}>
      <table aria-label={label} className="w-full border-collapse text-left text-[13px]">
        {children}
      </table>
    </div>
  );
}

export function Th({ className, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn('h-10 border-b border-stroke px-4 text-xs font-semibold whitespace-nowrap text-ink-muted', className)}
      {...rest}
    />
  );
}

export function Td({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('border-t border-stroke-muted px-4 py-2.5 align-middle text-ink', className)} {...rest} />;
}

interface RowProps extends HTMLAttributes<HTMLTableRowElement> {
  /** Makes the whole row open something; Enter and Space work when it has focus. */
  onOpen?: () => void;
  openLabel?: string;
}

export function Tr({ onOpen, openLabel, className, ...rest }: RowProps) {
  if (!onOpen) return <tr className={className} {...rest} />;
  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onOpen();
  };
  return (
    <tr
      tabIndex={0}
      aria-label={openLabel}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('button, a, input, select, [role="menu"]')) return;
        onOpen();
      }}
      onKeyDown={onKeyDown}
      className={cn('cursor-pointer transition-colors hover:bg-hover focus-visible:bg-hover', className)}
      {...rest}
    />
  );
}

export function TableMessage({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="border-t border-stroke-muted px-4 py-10 text-center text-[13px] text-ink-muted">
        {children}
      </td>
    </tr>
  );
}
