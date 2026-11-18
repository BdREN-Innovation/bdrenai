import { useState } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import type { EditorTarget } from '@/features/packages/editor';
import { CONFIGURATION_TABS, CONFIGURATION_TAB_LABEL } from './tabs';
import { PackageEditor } from '@/features/packages/editor';
import { Page } from '@/components/layout/Page';
import { Button, Tabs } from '@/components/ui';
import { PackagesTab } from './packages';
import { AppsTab } from './apps';

const route = getRouteApi('/configuration');

/** Platform-wide settings; each tab lives in the URL (?tab=apps). */
export function ConfigurationPage() {
  const { tab = 'packages' } = route.useSearch();
  const navigate = route.useNavigate();
  const [editor, setEditor] = useState<EditorTarget | null>(null);

  return (
    <Page
      title="Configuration"
      subtitle="What BdREN AI sells and how apps are measured. Changes to packages are versioned."
      actions={
        tab === 'packages' ? (
          <>
            <Button icon={Plus} onClick={() => setEditor({ mode: 'create', kind: 'single' })}>
              New package
            </Button>
            <Button variant="primary" icon={Plus} onClick={() => setEditor({ mode: 'create', kind: 'bundle' })}>
              New combined package
            </Button>
          </>
        ) : null
      }
    >
      <Tabs
        label="Configuration sections"
        value={tab}
        onChange={(next) => void navigate({ search: next === 'packages' ? {} : { tab: next }, replace: true })}
        items={CONFIGURATION_TABS.map((value) => ({ value, label: CONFIGURATION_TAB_LABEL[value] }))}
      >
        {tab === 'packages' ? <PackagesTab onCreate={(kind) => setEditor({ mode: 'create', kind })} /> : null}
        {tab === 'apps' ? <AppsTab /> : null}
      </Tabs>
      <PackageEditor target={editor} onClose={() => setEditor(null)} />
    </Page>
  );
}
