// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): nothing imported. `matchMedia` supplies
 * the phone viewport that JSDOM cannot lay out. The menu and keyboard handlers
 * are real, so selection must retain the profile ID as names change. */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ProfileSwitcher } from '../src/components/ProfileSwitcher';

it('shows complete names on a phone and selects the correct profile with keyboard navigation', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host), select = vi.fn();
  const options = [{ id: null, name: 'Me', selected: true }, { id: 'noah-id', name: 'noah', selected: false }, { id: 'another-id', name: 'anotherone', selected: false }];
  try {
    await act(async () => root.render(<ProfileSwitcher label="Choose a profile" options={options} onSelect={select} />));
    const trigger = host.querySelector<HTMLButtonElement>('button')!;
    await act(async () => { trigger.focus(); trigger.click(); });
    expect([...host.querySelectorAll('[role="menuitemradio"]')].map(node => node.textContent)).toEqual(['Me✓', 'noah', 'anotherone']);
    const menu = host.querySelector('[role="menu"]')!;
    await act(async () => menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
    expect(document.activeElement?.textContent).toBe('anotherone');
    await act(async () => (document.activeElement as HTMLButtonElement).click());
    expect(select).toHaveBeenCalledWith('another-id');
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
