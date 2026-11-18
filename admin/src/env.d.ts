/// <reference types="vite/client" />

declare module '@fontsource-variable/inter';

interface ImportMetaEnv {
  /** Where "BDREN AI website" links go; defaults to `/` (the same origin). */
  readonly VITE_WEBSITE_URL?: string;
}
