import { forwardRef } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'brand';
export type ButtonSize = 'md' | 'sm';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent font-bold hover:brightness-95',
  brand: 'bg-brand text-on-brand font-semibold hover:brightness-95',
  secondary: 'border border-stroke bg-surface text-ink font-semibold hover:bg-hover',
  ghost: 'text-ink font-medium hover:bg-hover',
  danger: 'border border-danger-border bg-surface text-danger-fg font-semibold hover:bg-danger-bg',
};

const SIZES: Record<ButtonSize, string> = {
  md: 'h-10 px-4 text-sm rounded-lg gap-2',
  sm: 'h-8 px-2.5 text-xs rounded-md gap-1.5',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  loading?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, loading = false, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap transition-[background-color,filter] duration-100 disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <LoaderCircle aria-hidden="true" size={size === 'sm' ? 14 : 16} className="animate-spin" />
      ) : Icon ? (
        <Icon aria-hidden="true" size={size === 'sm' ? 14 : 16} />
      ) : null}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  size?: ButtonSize;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, size = 'md', className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-50',
        size === 'md' ? 'size-10' : 'size-8',
        className,
      )}
      {...rest}
    >
      <Icon aria-hidden="true" size={size === 'md' ? 18 : 16} />
    </button>
  );
});
