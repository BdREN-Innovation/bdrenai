import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { THEME_STORAGE_KEY, ThemeProvider, readStoredMode, useTheme } from './theme';

function Probe() {
  const { mode, setMode } = useTheme();
  return (
    <button type="button" onClick={() => setMode('dark')}>
      {mode}
    </button>
  );
}

describe('theme', () => {
  it('applies data-theme and remembers the choice', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(document.documentElement.dataset.theme).toBe('system');
    act(() => screen.getByRole('button').click());
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('falls back to system when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readStoredMode()).toBe('system');
  });
});
