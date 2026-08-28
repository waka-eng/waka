// @vitest-environment jsdom
/**
 * EVERY SHEET CLOSES THE SAME TWO WAYS — press away, or press Escape.
 *
 * The founder ruled it twice in one day, each time about a single surface:
 * "if click outside modal, close it" (the make-another-place sheet) and
 * "timeline line should disappear if clicked outside of it" (the dial). Both
 * are the same expectation, and it is not about those two surfaces: it is
 * what anyone expects of a thing that opens over what they were reading.
 *
 * Five sheets never learned it — the account sheet, a room's settings, the
 * join sheet, a statement's provenance room, the antechamber — and each one
 * closed only by finding its own small word. That is survivable once and a
 * trap every time after, because the way out of the last sheet is never where
 * the way out of this one is.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. `useDismissAway` is a hook
 * over two window listeners, so it can be driven directly — a component that
 * renders one div and reports what it was told. Standing up the world to
 * assert a window listener would be testing the world, not the rule.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { useDismissAway } from "../src/lib/dismiss";

let host: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

const KEEP = [".sheet", ".opener"] as const;

/** One sheet, one count of how often it was asked to go. */
function mount(open: boolean): { closed: () => number } {
  const asked = { n: 0 };
  function Sheet(): JSX.Element {
    useDismissAway(
      open,
      () => {
        asked.n += 1;
      },
      KEEP,
    );
    return (
      <div>
        <button type="button" className="opener">
          open
        </button>
        <div className="sheet">
          <button type="button" className="inside">
            a word inside the sheet
          </button>
          <input className="field" defaultValue="half-typed name" />
        </div>
        <div className="world">the world behind it</div>
      </div>
    );
  }
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<Sheet />));
  return { closed: () => asked.n };
}

const pressOn = (sel: string) => {
  const at = host.querySelector(sel)!;
  act(() => {
    at.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
};

const escape = () => {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
};

describe("a sheet that is open", () => {
  it("goes when the press lands outside it", () => {
    const sheet = mount(true);
    pressOn(".world");
    expect(sheet.closed(), "a press on the world is how anyone puts a sheet away").toBe(1);
  });

  it("stays while the press is its own", () => {
    const sheet = mount(true);
    pressOn(".inside");
    pressOn(".opener");
    expect(
      sheet.closed(),
      "pressing inside the sheet, or the control that opened it, is not a dismissal — " +
        "treating the opener as one closes and reopens in the same press",
    ).toBe(0);
  });

  it("goes on Escape", () => {
    const sheet = mount(true);
    escape();
    expect(sheet.closed()).toBe(1);
  });
});

describe("a field inside the sheet", () => {
  it("keeps its own Escape", () => {
    /* A room's name box, an agent's name, the reflect answer — each handles
       Escape itself (leaving a half-typed name is not the same act as
       leaving the sheet). The sheet's listener is on the window in the
       CAPTURE phase, which runs before anything the field could do, so a
       sheet that does not check the target eats the field's key. */
    const sheet = mount(true);
    const field = host.querySelector(".field")!;
    act(() => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(
      sheet.closed(),
      "Escape in a field belongs to the field first; the sheet takes it only " +
        "when the press was not inside one",
    ).toBe(0);
  });
});

describe("a sheet that is closed", () => {
  it("hears nothing at all", () => {
    const sheet = mount(false);
    pressOn(".world");
    escape();
    expect(
      sheet.closed(),
      "a closed sheet listening to the whole window is how a stray Escape starts " +
        "closing things nobody opened",
    ).toBe(0);
  });
});
