// @vitest-environment jsdom

/**
 * THE WORLD, MOUNTED IN KOREAN.
 *
 * NOTHING IN THIS REPOSITORY HAD EVER DONE THIS. Before this file,
 * `preferredLocale` appeared in zero tests and zero walks: every one of the
 * fifty suites and thirty browser walks ran the product in English, because
 * `Home.tsx` takes its language from `auth.profile.preferredLocale` and every
 * mock supplied a profile without one. The offline fixture cannot help — it
 * has no profile at all, so a browser pointed at it is English by
 * construction.
 *
 * WHAT THAT COST. Seven `aria-label`, `title` and `placeholder` strings sat
 * written into the JSX in English on surfaces that ship in Korean, and
 * survived every instrument this repo has. `LoadingHome` is the sharpest
 * case: its visible word has read `불러오는 중` since the face shipped, three
 * lines under an `aria-label="loading"` that never did. The eye got Korean
 * and the ear got English, on one element, and nothing could see it.
 *
 * `every-label-says-it-twice.test.ts` now holds the rule by reading source
 * text — no label is a bare literal. This file holds the other half, which
 * source text cannot reach: that what the running product actually HANDS a
 * person is in their language. A label can go through `say()` and still be
 * wrong; only a mounted world can say otherwise.
 *
 * THE RULE IS DISCOVERED, NOT LISTED. Case two does not name the labels it
 * expects. It sweeps whatever the surface is currently handing out and asks
 * that all of it be Korean — so a label added next year is covered by a file
 * written today, which is the only kind of coverage that survives a product
 * that is still moving.
 *
 * THE ONE EXEMPTION IS THE PRODUCT'S OWN NAME, for the reason the sibling
 * gate gives: `Waka` is a proper noun and translating it would be the bug.
 *
 * WHY EVERY CASE CARRIES A COUNT. "Every spoken attribute is Korean" is true
 * of a world that mounted nothing, and a world that fails to mount is exactly
 * what a broken fixture produces. Each case asserts what it found before it
 * asserts what it is — a blind sweep must fail here, not pass silently.
 *
 * WHAT THIS DOES NOT SAY. Nothing about whether the Korean is good; no test
 * can hold that. And nothing about the two surfaces it cannot reach from a
 * mounted Home — `LoadingHome`, which renders before this world exists, and
 * `PublicProfile`, which is a different route. Those stay held by the source
 * gate alone, and that is written down rather than left to be assumed.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6).
 *
 *   `lib/auth-context` — THE SEAM THIS FILE IS ABOUT. The language is not a
 *   setting the page reads; it is a property of the signed-in profile, taken
 *   at `Home.tsx:2092` from `auth.profile.preferredLocale`. There is no other
 *   way in: the offline fixture has no profile, so a real browser pointed at
 *   it renders English whatever the browser or the storage says. Replacing
 *   this seam is not a convenience here, it is the only door to the subject.
 *
 *   `lib/data` — the seam for the three layers, and mocking `lib/api` INSTEAD
 *   is the mistake this project has already made once: a loader throws on a
 *   shape it does not know, the page answers by replacing the world with the
 *   dev fixture, and the suite passes while describing that fixture. It would
 *   be worse than usually invisible here — the fixture's own chrome is drawn
 *   by the same components, so a sweep of it would find Korean labels and
 *   agree, while measuring a world the test never built.
 *
 *   `lib/api` — for the group reads only, which have no loader above them.
 *   These facts hold no groups, so it keeps those fetches off the network
 *   rather than supplying anything.
 *
 *   `helpers/canvas-stub` and `helpers/render-home` — the canvas, the clock,
 *   the frame loop and the viewport. The canvas matters here for an unusual
 *   reason: the orbs are painted, not rendered, so the only way to reach the
 *   memory panel is to press across the ground until one answers, and the
 *   stub is what lets the audit say where the ground actually is.
 *
 * `home-field.test.tsx` gives the long version of all four.
 */
import { act } from "react";
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { installCanvasStub, setViewport } from "./helpers/canvas-stub";
import { apiMockFrom, dataMockFrom, mountWorld, VIEWER_ID, type MountedWorld } from "./helpers/render-home";

const VIEW_W = 1280;
const VIEW_H = 900;

/** Enough memories for the field to have orbs to press, and no more. */
const FACTS = {
  inspirations: [0, 4, 21, 40, 61].map((daysAgo, i) => ({
    id: `own-${i}`,
    text: `something I kept, ${i}`,
    daysAgo,
  })),
  groups: [],
};

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return { ...actual, ...apiMockFrom(FACTS) };
});

vi.mock("../src/lib/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/data")>();
  return { ...actual, ...dataMockFrom(FACTS) };
});

/* THE ONE LINE THIS WHOLE FILE EXISTS FOR: a profile that prefers Korean.
   Every other suite's session omits `preferredLocale`, which is why every
   other suite has been measuring the English product without saying so. */
vi.mock("../src/lib/auth-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/auth-context")>();
  const session = {
    status: "authenticated",
    account: { id: "account-1", email: "you@example.test" },
    profile: { id: VIEWER_ID, name: "You", type: "human", preferredLocale: "ko-KR" },
    profiles: [],
    refresh: async () => undefined,
    signOut: async () => undefined,
  };
  return { ...actual, useOptionalAuth: () => session, useAuth: () => session };
});

/** Hangul, including the compatibility jamo block: any Korean at all. */
const HANGUL = /[ㄱ-힝]/;

/** The product's own name, which reads the same in every language. */
const EXEMPT = new Set(["Waka"]);

const SPOKEN = ["aria-label", "aria-description", "aria-roledescription", "aria-placeholder", "title", "placeholder", "alt"];

interface Said {
  readonly where: string;
  readonly attr: string;
  readonly value: string;
}

/** Everything the surface is currently handing a person as words. */
function spoken(root: ParentNode): Said[] {
  const out: Said[] = [];
  for (const el of Array.from(root.querySelectorAll("*"))) {
    for (const attr of SPOKEN) {
      const value = el.getAttribute(attr);
      if (!value || !value.trim()) continue;
      const cls = typeof el.className === "string" ? el.className.split(" ")[0] : "";
      out.push({ where: `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}`, attr, value });
    }
  }
  return out;
}

/** The ones that are not Korean and are not the product's name. */
const english = (said: Said[]): Said[] =>
  said.filter((s) => !EXEMPT.has(s.value.trim()) && !HANGUL.test(s.value));

const print = (said: Said[]): string[] => said.map((s) => `${s.where}  ${s.attr}="${s.value}"`);

let layout: MountedWorld;

const pointer = { pointerId: 1, pointerType: "mouse", bubbles: true } as const;

async function pressOn(el: HTMLElement, x: number, y: number): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, cancelable: true, clientX: x, clientY: y }));
  });
}

async function liftAt(x: number, y: number): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new PointerEvent("pointerup", { ...pointer, clientX: x, clientY: y }));
  });
}

function canvas(): HTMLElement {
  const el = layout.container.querySelector("canvas");
  if (!el) throw new Error("no canvas — the layout never mounted");
  return el as HTMLElement;
}

/** Press across the field until a memory's panel opens. Same route as
    `home-memory.test.tsx`; the band comes from the audit, not from a guess. */
async function tapAnOrb(): Promise<HTMLElement> {
  const a = layout.audit();
  if (a.drawn.active === 0) throw new Error("the field is empty — nothing to tap");
  const step = Math.max(12, Math.floor(a.drawn.rMin));
  for (let y = Math.floor(a.highest); y <= Math.ceil(a.lowest); y += step) {
    for (let x = 20; x <= VIEW_W + 120; x += step) {
      await pressOn(canvas(), x, y);
      await liftAt(x, y);
      await layout.step(24);
      const open = layout.container.querySelector<HTMLElement>(".jar-panel--in");
      if (open) return open;
    }
  }
  throw new Error(
    `no tap anywhere across the field opened a memory: ${a.drawn.active} drawn, ` +
      `band ${a.highest}–${a.lowest}, radii ${a.drawn.rMin}–${a.drawn.rMax}`,
  );
}

beforeAll(() => {
  installCanvasStub();
  setViewport(VIEW_W, VIEW_H);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(async () => {
  layout = await mountWorld(FACTS);
});

afterEach(() => {
  layout?.unmount();
});

describe("the world, mounted in Korean", () => {
  it("really is in Korean — the control every other case rests on", () => {
    const said = spoken(layout.container);
    expect(said.length, "the world handed out nothing at all — it never mounted").toBeGreaterThan(1);
    const korean = said.filter((s) => HANGUL.test(s.value));
    expect(
      korean.length,
      `not one word of Korean on a surface that asked for it: ${print(said).join(" | ")}`,
    ).toBeGreaterThan(0);
  });

  it("hands a person nothing in English but the product's own name", () => {
    const said = spoken(layout.container);
    expect(said.length).toBeGreaterThan(1);
    expect(
      print(english(said)),
      "these were handed to a Korean speaker in English — give each a catalogue key",
    ).toEqual([]);
  });

  it("names the dates' group in Korean when the days are open", async () => {
    const when = layout.container.querySelector<HTMLElement>(".jar-when");
    expect(when, "no `now` to press — the dates cannot be reached").not.toBeNull();
    await act(async () => when!.click());
    await layout.step(8);

    const list = layout.container.querySelector<HTMLElement>(".jar-dial-list");
    expect(list, "pressing the word opened no list of days").not.toBeNull();
    expect(list!.getAttribute("aria-label")).toBe("이 벽을 어떤 날로 되감기");

    /* and the whole surface, now that a new piece of it exists */
    expect(print(english(spoken(layout.container)))).toEqual([]);
  });

  it("names the step carets in Korean, on the label and on the tooltip", async () => {
    const panel = await tapAnOrb();
    /* BY THE CARET, NOT BY `[title]`. The panel's private/public pair also
       carries a `title` — Korean, and correctly so — and matching on the
       attribute swept them in and read their absent labels as a failure.
       The step carets are the buttons holding a left or right caret, and the
       wall navigation that shares those classes lives outside the panel. */
    const carets = Array.from(panel.querySelectorAll<HTMLElement>("button")).filter(
      (b) => b.querySelector(".jar-caret--left, .jar-caret--right") !== null,
    );
    expect(
      carets.length,
      "the opened memory offered no stepping control — this case measured nothing",
    ).toBeGreaterThan(0);

    for (const caret of carets) {
      const label = caret.getAttribute("aria-label") ?? "";
      const tip = caret.getAttribute("title") ?? "";
      expect(["이 앞의 영감", "이 다음의 영감"]).toContain(label);
      /* the tooltip said the same English sentence as the label for as long
         as both were literals; they must stay one string, not two */
      expect(tip).toBe(label);
    }

    expect(print(english(spoken(layout.container)))).toEqual([]);
  });
});
