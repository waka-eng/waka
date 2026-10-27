// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/platform`, `@capacitor/core`
 * and `@capacitor/app` supply Capacitor's platform and Android
 * listener stand in for the device bridge; synthetic touch events supply
 * finger coordinates. Nothing else is mocked: the real control, lifecycle
 * and gesture guards run. Device gesture recognition/layout need UI checks. */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PageBack } from '../src/components/PageBack';

const device = vi.hoisted(() => ({ platform: 'ios', native: true, back: null as (() => void) | null, remove: vi.fn() }));
vi.mock('../src/lib/platform', () => ({ get isMobileBuild() { return device.native; } }));
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => device.platform } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn(async (_name: string, callback: () => void) => {
  device.back = callback; return { remove: device.remove };
}) } }));
let host: HTMLDivElement, root: Root;
const back = vi.fn();
beforeEach(() => {
  device.platform = 'ios'; device.native = true; device.back = null; device.remove.mockClear(); back.mockClear();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function mount(key = 'note', onBack = back, visible = true) {
  await act(async () => root.render(<PageBack label="All inspirations" onBack={onBack} navigationKey={key} visible={visible}/>));
}
async function touch(type: string, x: number, y: number, target: Element = host, count = 1) {
  await act(async () => {
    const point = { clientX: x, clientY: y };
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      touches: { value: type === 'touchend' ? [] : Array.from({ length: count }, () => point) },
      changedTouches: { value: [point] },
    });
    target.dispatchEvent(event);
  });
}
it('uses the same exit for the labeled button and a completed left-edge swipe', async () => {
  await mount();
  expect(host.querySelector('button')!.textContent).toBe('All inspirations');
  await act(async () => host.querySelector('button')!.click());
  await touch('touchstart', 8, 200); await touch('touchmove', 90, 205);
  expect(host.querySelector('.waka-back-swipe')).not.toBeNull();
  expect(back).toHaveBeenCalledTimes(1);
  await touch('touchend', 90, 205);
  expect(back).toHaveBeenCalledTimes(2);
  expect(host.querySelector('.waka-back-swipe')).toBeNull();
});
it('leaves interior drags, vertical scrolls, short swipes, cancellation and multiple fingers alone', async () => {
  await mount();
  for (const [x, dx, dy, finish, fingers] of [[80, 90, 0, 'touchend', 1], [8, 10, 80, 'touchend', 1],
    [8, 25, 0, 'touchend', 1], [8, 90, 0, 'touchcancel', 1], [8, 90, 0, 'touchend', 2]] as const) {
    await touch('touchstart', x, 200); await touch('touchmove', x + dx, 200 + dy, host, fingers);
    await touch(finish, x + dx, 200 + dy);
  }
  expect(back).not.toHaveBeenCalled();
});
it('does not navigate through editors or open dialogs, or finish a gesture from an old page', async () => {
  await mount();
  const editor = document.createElement('textarea'); host.append(editor);
  await touch('touchstart', 8, 200, editor); await touch('touchend', 100, 200, editor);
  const modal = document.createElement('div'); modal.setAttribute('aria-modal', 'true'); host.append(modal);
  await touch('touchstart', 8, 200); await touch('touchend', 100, 200); modal.remove();
  await touch('touchstart', 8, 200); await mount('list'); await touch('touchend', 100, 200);
  expect(back).not.toHaveBeenCalled();
});
it('keeps browser gestures untouched and offers the visible control', async () => {
  device.native = false; await mount();
  await touch('touchstart', 8, 200); await touch('touchend', 100, 200);
  expect(back).not.toHaveBeenCalled();
  await act(async () => host.querySelector('button')!.click()); expect(back).toHaveBeenCalledOnce();
});
it.each(['ios', 'android'])('keeps native Back working on %s when the list has no visible Back button', async platform => {
  device.platform = platform; await mount('list', back, false);
  expect(host.querySelector('button')).toBeNull();
  if (platform === 'android') await act(async () => device.back!());
  else { await touch('touchstart', 8, 200); await touch('touchend', 100, 200); }
  expect(back).toHaveBeenCalledOnce();
});
it('routes Android Back to the latest page action, dismissing an open sheet first', async () => {
  device.platform = 'android'; await mount();
  const updated = vi.fn(); await mount('note', updated);
  await act(async () => device.back!()); expect(updated).toHaveBeenCalledOnce(); expect(back).not.toHaveBeenCalled();
  const modal = document.createElement('div'); modal.setAttribute('aria-modal', 'true'); host.append(modal);
  const escape = vi.fn(); modal.addEventListener('keydown', escape);
  await act(async () => device.back!());
  expect(escape.mock.calls[0]![0].key).toBe('Escape'); expect(updated).toHaveBeenCalledOnce();
  await mount('list'); expect(device.remove).toHaveBeenCalledOnce();
});
