// @vitest-environment jsdom
/**
 * THE THREE MACHINERY DOORS OPEN, AND CLOSING ONE LEAVES YOU SOMEWHERE.
 *
 * goal: the-legible-loop. How it reads you, the antechamber, the gardener's
 * asks were deleted with the settings page (5df201f6) under a note calling
 * it "the removal most worth disagreeing with", and restored behind the "i"
 * in the top corner the same day. This suite exists because of what the
 * restoration actually is: three rows in a popover whose handlers live in a
 * different component from the markup, which is precisely the shape Law 8
 * records shipping dead three separate times here —
 *
 *   > A dead press is worse than a missing control. A missing control reads
 *   > as a thing not offered; a dead one reads as the product being broken.
 *   > And nothing catches it — it type-checks, it renders, and the suites
 *   > that covered that bar asserted the control's TEXT, which is true of a
 *   > dead button.
 *
 * So every case here PRESSES and asserts the effect. Nothing asserts that a
 * row is on screen.
 *
 * THE THREE THINGS IT PINS, each a judgement that could be undone quietly:
 *
 *   1. Pressing a door opens that door and PUTS THE CARD AWAY. One surface
 *      at a time; the founder has twice rejected a surface stacking on
 *      another surface, and two popovers deep is the nesting the reference
 *      rules out.
 *   2. Opening a door FETCHES what it shows. A diagnostic panel that opens
 *      on last visit's data is a worse lie than one that says it is still
 *      fetching.
 *   3. Closing a door leaves focus on the "i" rather than on `<body>`. The
 *      row that opened it has unmounted by then, so `DialogSurface`'s own
 *      restore-the-opener has nothing to restore to — the same gap this
 *      corner already had to fix once for the cards themselves.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). `lib/api` — and only its three GETs
 * and two writes — because that barrel is the one seam between this corner
 * and the network, and what is under test is which panel a press opens, not
 * what the server says when it gets there. Every other name on `lib/api` is
 * the real one (`importOriginal`), because `SettingsPanel` imports
 * `ApiError` from it and a blanket mock would make this suite's own
 * neighbour unloadable. Real `Menu`, real `HowItWorksPanel`,
 * real panels, real presses, real (jsdom) document. Appearance is not
 * claimed.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchTheReading = vi.fn();
const fetchTheWeather = vi.fn();
const fetchSignalDuplicates = vi.fn();
const restoreSignal = vi.fn();
const resolveSignalDuplicate = vi.fn();

vi.mock("../src/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchTheReading,
  fetchTheWeather,
  fetchSignalDuplicates,
  restoreSignal,
  resolveSignalDuplicate,
}));

const { Menu } = await import("../src/components/Menu");

let host: HTMLDivElement, root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  fetchTheReading.mockResolvedValue({ sentences: ["three memories make a pattern."], coda: null });
  fetchTheWeather.mockResolvedValue({ told: null, days: [], antechamber: [] });
  fetchSignalDuplicates.mockResolvedValue([]);
  restoreSignal.mockResolvedValue(undefined);
  resolveSignalDuplicate.mockResolvedValue(undefined);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

async function mount(): Promise<void> {
  await act(async () => {
    root.render(<Menu locale="en-US" items={[]} current={null} />);
  });
}

const info = () => document.querySelector<HTMLButtonElement>(".waka-corner--info")!;
const doors = () => [...document.querySelectorAll<HTMLButtonElement>(".waka-about-door")];
const sheet = () => document.querySelector<HTMLElement>(".jar-machinery");
const named = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => (button.textContent ?? "").trim() === name,
  );

/** Open the "i" and press the row that says `name`. */
async function openDoor(name: string): Promise<void> {
  await mount();
  await act(async () => info().click());
  const row = doors().find((door) => (door.textContent ?? "").trim() === name);
  expect(row, `no door named ${name} in the card`).toBeTruthy();
  await act(async () => row!.click());
}

describe("the three machinery doors", () => {
  it("names all three, under one sentence, and not one of them is the panel's own heading", async () => {
    await mount();
    await act(async () => info().click());
    expect(doors().map((door) => (door.textContent ?? "").trim())).toEqual([
      "How it reads you",
      "The antechamber",
      "The gardener's asks",
    ]);
    /* ONE LEAD OVER THREE ROWS, not a gloss under each — and it names them
       in the order they stand. The recovered copy is the whole reason the
       rows need no second line of their own. */
    expect(host.textContent).toContain(
      "What it reads you by, what it set aside, and what it thinks it is hearing twice.",
    );
  });

  it("opens the reading, fetches it, and puts the card away in the same press", async () => {
    await openDoor("How it reads you");
    expect(fetchTheReading, "the door opened on nothing").toHaveBeenCalledOnce();
    expect(sheet()?.className).toContain("jar-reading");
    expect(sheet()?.textContent).toContain("Three memories make a pattern.");
    /* ONE SURFACE AT A TIME. The card the row was pressed in is gone. */
    expect(document.querySelector(".waka-about"), "the card stacked under the sheet").toBeNull();
  });

  it("asks for the reading once and no more, however often the door is opened", async () => {
    await openDoor("How it reads you");
    await act(async () => named("Close")!.click());
    await act(async () => info().click());
    await act(async () => doors()[0]!.click());
    /* The rules do not change mid-visit, and every serve of them writes a
       consultation on the server. */
    expect(fetchTheReading).toHaveBeenCalledOnce();
  });

  it("opens the antechamber on fresh refusals and says the empty state in words", async () => {
    await openDoor("The antechamber");
    expect(fetchTheWeather).toHaveBeenCalledOnce();
    expect(sheet()?.className).toContain("jar-antechamber");
    expect(sheet()?.textContent).toContain("Nothing stands here");
  });

  it("puts a refusal's anchor back, and the row answers before the server does", async () => {
    let settle: (() => void) | null = null;
    restoreSignal.mockReturnValue(new Promise<void>((resolve) => { settle = () => resolve(); }));
    fetchTheWeather.mockResolvedValue({
      told: null,
      days: [],
      antechamber: [{
        id: "sup-1",
        candidateStatement: "Mornings are your best hours.",
        anchorSignalId: "sig-anchor",
        anchorStatement: "You are a morning person.",
        anchorStillRefusing: true,
        suppressedAt: "2026-08-23T09:00:00.000Z",
      }],
    });
    await openDoor("The antechamber");
    await act(async () => named("Put it back")!.click());
    expect(restoreSignal).toHaveBeenCalledWith("sig-anchor");
    /* The answer is on screen before the network has answered — the whole
       point of the session's own set of restored anchors. */
    expect(sheet()?.textContent).toContain("stands again");
    expect(named("Put it back")).toBeUndefined();
    settle?.();
  });

  it("opens the gardener's asks, fetches them, and refuses a merge until it is asked twice", async () => {
    fetchSignalDuplicates.mockResolvedValue([{
      id: "dup-1",
      similarity: 0.9,
      createdAt: "2026-08-31T00:00:00.000Z",
      a: { signalId: "sig-a", statement: "You think in metaphors." },
      b: { signalId: "sig-b", statement: "You reach for metaphor first." },
    }]);
    await openDoor("The gardener's asks");
    expect(fetchSignalDuplicates).toHaveBeenCalledOnce();
    expect(sheet()?.className).toContain("jar-duplicates");

    /* A MEMORY-MOVING WORD IS NEVER BESIDE ITS OWN YES. The first press
       arms; nothing is written until the second. */
    await act(async () => named("These are one")!.click());
    expect(resolveSignalDuplicate).not.toHaveBeenCalled();
    expect(sheet()?.textContent).toContain("nothing is deleted");
    await act(async () => named("Yes, merge them")!.click());
    expect(resolveSignalDuplicate).toHaveBeenCalledWith("dup-1", "merge");
    /* answered, so the ask is gone from the panel at once */
    expect(sheet()?.textContent).toContain("Nothing to ask");
  });

  it("keeps a pair apart in one press, because that answer moves nothing", async () => {
    fetchSignalDuplicates.mockResolvedValue([{
      id: "dup-2",
      similarity: 0.9,
      createdAt: "2026-08-31T00:00:00.000Z",
      a: { signalId: "sig-a", statement: "You think in metaphors." },
      b: { signalId: "sig-b", statement: "You reach for metaphor first." },
    }]);
    await openDoor("The gardener's asks");
    await act(async () => named("Keep them apart")!.click());
    expect(resolveSignalDuplicate).toHaveBeenCalledWith("dup-2", "keep_apart");
  });

  it("gives the press back to the \"i\" when a door closes, never to the body", async () => {
    await openDoor("The antechamber");
    await act(async () => named("Close")!.click());
    expect(sheet(), "the visible Close did not close it").toBeNull();
    /* The row that opened the sheet has unmounted, so there is nothing for
       `DialogSurface` to hand focus back to. The door the person came in by
       is still standing, and one press from there is back in the card. */
    expect(document.activeElement).toBe(info());
  });

  it("closes a door on Escape as well, since a sheet has two ways out", async () => {
    await openDoor("The antechamber");
    await act(async () => {
      sheet()!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(sheet()).toBeNull();
    expect(document.activeElement).toBe(info());
  });
});
