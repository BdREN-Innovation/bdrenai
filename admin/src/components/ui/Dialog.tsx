import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { FormEvent, ReactNode } from 'react';
import { IconButton } from './Button';
import { cn } from '@/lib/cn';

interface BaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Wraps the body and footer in a form so Enter submits. */
  onSubmit?: () => void;
}

function Body({ children, footer, onSubmit }: Pick<BaseProps, 'children' | 'footer' | 'onSubmit'>) {
  const content = (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">{children}</div>
      {footer ? (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-stroke-muted px-5 py-3">
          {footer}
        </div>
      ) : null}
    </>
  );
  if (!onSubmit) return content;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <form noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      {content}
    </form>
  );
}

function Header({ title, description }: Pick<BaseProps, 'title' | 'description'>) {
  return (
    <div className="flex shrink-0 items-start gap-3 border-b border-stroke-muted px-5 py-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <RadixDialog.Title className="text-[15px] font-semibold text-ink">{title}</RadixDialog.Title>
        {description ? (
          <RadixDialog.Description className="text-[13px] text-ink-muted">{description}</RadixDialog.Description>
        ) : (
          <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
        )}
      </div>
      <RadixDialog.Close asChild>
        <IconButton icon={X} label="Close" size="sm" className="-mr-1" />
      </RadixDialog.Close>
    </div>
  );
}

export type DialogSize = 'md' | 'lg' | 'xl';

const DIALOG_WIDTH: Record<DialogSize, string> = { md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  onSubmit,
  size = 'md',
}: BaseProps & { size?: DialogSize }) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-60 animate-overlay-in bg-scrim" />
        <RadixDialog.Content
          className={cn(
            'fixed top-1/2 left-1/2 z-60 flex max-h-[calc(100vh-48px)] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 animate-dialog-in flex-col rounded-xl border border-stroke bg-surface shadow-modal',
            DIALOG_WIDTH[size],
          )}
        >
          <Header title={title} description={description} />
          <Body footer={footer} onSubmit={onSubmit}>
            {children}
          </Body>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export function Drawer({ open, onOpenChange, title, description, children, footer }: BaseProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-60 animate-overlay-in bg-scrim" />
        <RadixDialog.Content className="fixed inset-y-0 right-0 z-60 flex w-full max-w-md animate-drawer-in flex-col border-l border-stroke bg-surface shadow-modal">
          <Header title={title} description={description} />
          <Body footer={footer}>{children}</Body>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
