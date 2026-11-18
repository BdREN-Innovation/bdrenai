import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { Header } from './Header';

export const CommandMenuContext = createContext<() => void>(() => undefined);

interface PageProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

/** Page frame: the top header (title, actions, ⌘K button) above the scrolling content. */
export function Page({ title, subtitle, actions, children }: PageProps) {
  const openCommandMenu = useContext(CommandMenuContext);
  return (
    <>
      <Header title={title} subtitle={subtitle} actions={actions} onSearch={openCommandMenu} />
      <main id="main" tabIndex={-1} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6 focus:outline-none [&>*]:shrink-0">
        {children}
      </main>
    </>
  );
}
