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

  /**
   * ═══ A PAGE IS NOT A DIALOG, AND THE DIFFERENCE IS ONE KEY ═══════════════
   *
   * The four dock destinations are reached from a bar that never leaves the
   * screen, and `styles/claims.css` says that bar "is how you leave one".
   * They rendered as modals anyway — `role="dialog"`, `aria-modal`, a Tab
   * trap — so Tab wrapped back inside and the bar could not be reached with
   * the keyboard at all. `test/way-out.test.ts` was exempting all four from
   * Law 2 on the strength of that bar being their way out, which made the
   * gate for the law the thing excusing its worst breach.
   *
   * These two cases hold the primitive's half of the fix. The press itself
   * lives in `tools/e2e/by-keyboard.ts`, which opens each destination from
   * the bar with keys alone and counts the presses back to it — jsdom has no
   * focus order to walk, so what can be held HERE is that the surface stops
   * swallowing the key and stops claiming the rest of the screen is gone.
   */
  it("lets Tab out of a page, and says it is a region rather than a dialog", async () => {
    const close = vi.fn();
    await act(async () => root.render(<DialogSurface modal={false} aria-label="Your Inspirations" onClose={close}>
      <input aria-label="Find" />
      <button>A memory</button>
    </DialogSurface>));
    const page = host.querySelector<HTMLElement>("section")!;
    expect(page.getAttribute("role")).toBe("region");
    expect(page.hasAttribute("aria-modal")).toBe(false);
    /* `data-jar-surface` is NOT about being modal and a page needs all of
       what hangs off it — `lib/surface-input.ts` gives the surface its keys
       before the world's shortcuts, `lib/dismiss.ts` stands aside from an
       Escape the surface handles itself, and `home.css` dresses focus
       through it. */
    expect(page.getAttribute("data-jar-surface")).toBe("1");
    /* THE WHOLE POINT: Tab at either end is left to the browser, so focus
       walks out of the page and into the chrome. A modal surface answers the
       same two presses by wrapping — the case above proves that still holds. */
    const first = host.querySelector("input")!;
    const last = host.querySelector("button")!;
    for (const [at, shiftKey] of [[first, true], [last, false]] as const) {
      at.focus();
      const key = new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true });
      await act(async () => at.dispatchEvent(key));
      expect(key.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(at);
    }
  });

  it("keeps Escape and focus return on a page, because leaving is still leaving", async () => {
    /* Escape is NOT the page's way out — the bar is, and that is why the ✕
       went: founder, "there's no reason for there to be an X button when
       we're just moving across the pages." It is kept as an accelerator for
       a press the bar already offers, and taking it away would make the
       keyboard worse in the change that was meant to make it better.
       Focus return matters more: pressing "Inspirations" and then leaving
       should put you back on the row you pressed, not at the top of the
       document. */
    const close = vi.fn();
    await act(async () => root.render(<DialogSurface modal={false} onClose={close}>
      <button>A memory</button>
    </DialogSurface>));
    expect(document.activeElement).toBe(host.querySelector("button"));
    await act(async () => host.querySelector("button")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(close).toHaveBeenCalledOnce();
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
