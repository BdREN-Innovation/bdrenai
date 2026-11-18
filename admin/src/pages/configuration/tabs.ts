export const CONFIGURATION_TABS = ['packages', 'apps'] as const;
export type ConfigurationTab = (typeof CONFIGURATION_TABS)[number];

export const CONFIGURATION_TAB_LABEL: Record<ConfigurationTab, string> = {
  packages: 'Packages',
  apps: 'Apps & features',
};
