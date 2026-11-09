// @vitest-environment jsdom
/**
 * NOTHING TO PRESS WHILE IT LOADS (code review, 2026-11-08). The loading
 * screen's creature became a "light up" button with the rest; there is
 * nothing to answer a press during a load, so it is a picture, named.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. `LoadingHome` renders with
 * jsdom's canvas, which draws nothing; only the markup is asked about.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { LoadingHome } from '../src/components/LoadingHome';

it('draws the creature as a picture, with no button to press, while home loads', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(<LoadingHome />));
  expect(host.querySelector('.waka-companion button'), 'the loading creature is a button').toBeNull();
  expect(host.querySelector('.waka-companion [role="img"]')?.getAttribute('aria-label')).toBe('WAKA');
  await act(async () => root.unmount()); host.remove();
});
