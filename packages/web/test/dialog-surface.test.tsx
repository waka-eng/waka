// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. Render the actual dialog to
 * verify native focus and event ownership without a canvas or network. */
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
afterEach(() => { act(() => root.unmount()); host.remove(); opener.remove(); });

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
