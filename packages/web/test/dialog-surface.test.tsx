// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `visualViewport` supplies resize/scroll
 * metrics in jsdom, which has no software keyboard. Actual dialog focus and
 * event ownership run unchanged, without a canvas or network. */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DialogSurface } from "../src/components/DialogSurface";

let host: HTMLDivElement;
let root: Root;
let opener: HTMLButtonElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  opener = document.createElement("button"); document.body.append(opener); opener.focus();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); opener.remove(); vi.unstubAllGlobals(); });

async function mount(onClose = vi.fn()) {
  await act(async () => root.render(<DialogSurface aria-label="Reflection" onClose={onClose}>
    <textarea aria-label="Your answer" />
    <button disabled>Waiting</button>
    <button>Continue</button>
    <button>Done</button>
  </DialogSurface>));
  return onClose;
}

describe("dialog input ownership", () => {
  it('keeps Escape usable when a focused action disappears during a loading transition',async()=>{
    const close=vi.fn();
    await act(async()=>root.render(<DialogSurface onClose={close}><button>Next inspiration</button></DialogSurface>));
    expect(document.activeElement).toBe(host.querySelector('button'));
    await act(async()=>root.render(<DialogSurface onClose={close}><p role="status">Opening inspiration…</p></DialogSurface>));
    const dialog=host.querySelector<HTMLElement>('[role="dialog"]')!;expect(document.activeElement).toBe(dialog);
    await act(async()=>dialog.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
    expect(close).toHaveBeenCalledOnce();
  });
  it('keeps collapsed customization controls out of the keyboard loop',async()=>{
    await act(async()=>root.render(<DialogSurface onClose={()=>{}}><button>Save image</button><details><summary>Customize</summary><input aria-label="Hidden wording"/><details><summary>More</summary><button>Hidden action</button></details></details></DialogSurface>));
    const first=host.querySelector('button')!,summary=host.querySelector('summary')!;
    first.focus();await act(async()=>first.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true})));
    expect(document.activeElement).toBe(summary);
    await act(async()=>summary.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true})));
    expect(document.activeElement).toBe(first);
    host.querySelector('details')!.open=true;
    first.focus();await act(async()=>first.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true})));
    expect(document.activeElement).toBe(host.querySelectorAll('summary')[1]);
  });
  it('tracks the visible keyboard area and removes viewport listeners when inactive', async () => {
    const viewport = Object.assign(new EventTarget(), { height: 760, offsetTop: 0 });
    const remove = vi.spyOn(viewport, 'removeEventListener');
    vi.stubGlobal('visualViewport', viewport);
    await mount();
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.style.getPropertyValue('--dialog-visible-height')).toBe('760px');
    viewport.height = 350; viewport.offsetTop = 40;
    viewport.dispatchEvent(new Event('resize'));
    expect(dialog.style.getPropertyValue('--dialog-visible-height')).toBe('350px');
    expect(dialog.style.getPropertyValue('--dialog-visible-top')).toBe('40px');
    viewport.offsetTop = 70; viewport.dispatchEvent(new Event('scroll'));
    expect(dialog.style.getPropertyValue('--dialog-visible-top')).toBe('70px');
    await act(async () => root.render(<DialogSurface active={false} onClose={() => undefined} />));
    expect(dialog.hasAttribute('data-visual-viewport')).toBe(false);
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
  });
  it("leaves modified Tab to browser tab navigation", async () => {
    await mount();
    const last = [...host.querySelectorAll("button")].at(-1)!;
    last.focus();
    const key = new KeyboardEvent("keydown", { key: "Tab", ctrlKey: true, bubbles: true, cancelable: true });
    await act(async () => last.dispatchEvent(key));
    expect(key.defaultPrevented).toBe(false);
  });
  it("focuses inside and cycles Tab in both directions, skipping disabled controls", async () => {
    await mount();
    const first = host.querySelector("textarea")!;
    const last = [...host.querySelectorAll("button")].at(-1)!;
    expect(document.activeElement).toBe(first);
    await act(async () => first.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(last);
    await act(async () => last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(first);
  });

  it("closes on Escape from the writer and returns focus when removed", async () => {
    const close = await mount();
    const escaped = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => host.querySelector("textarea")!.dispatchEvent(escaped));
    expect(close).toHaveBeenCalledOnce();
    expect(escaped.defaultPrevented).toBe(true);
    await act(async () => root.render(null));
    expect(document.activeElement).toBe(opener);
  });

  it("lets an editor consume Escape without dismissing the whole reading", async () => {
    const close = vi.fn();
    await act(async () => root.render(<DialogSurface onClose={close}>
      <textarea onKeyDown={(event) => { if (event.key === "Escape") event.preventDefault(); }} />
    </DialogSurface>));
    await act(async () => host.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(close).not.toHaveBeenCalled();
  });
});
