// @vitest-environment jsdom

/**
 * THE POSTER, AND WHETHER IT SHOWS WHAT CHANGED.
 *
 * Layer three is the most-read surface in the product and it had no test at
 * all. The thing worth pinning is not that a sentence appears — that is one
 * `textContent` check and it would pass on a page that had forgotten the whole
 * point. The point is the DRIFT READOUT: when a statement is rewritten, a word
 * that survived the rewrite stays lit and still, and only a word that is
 * genuinely new arrives. That is the entire answer this surface gives to the
 * one question a person has about their own self-description — HAS THIS BEEN
 * THE SAME THING? — and nothing checked it.
 *
 * The rule lives in two halves that have to agree, and a test that only saw
 * one of them would be useless:
 *
 *   `posterWords(text, prev)` decides which words are carried, by MULTISET —
 *   a word that was in the previous sentence is a word that survived, wherever
 *   it moved to, and a word said twice is a word that has to be found twice.
 *
 *   `setChrome` in Home.tsx supplies `prev`, by carrying the sentence being
 *   replaced forward into the next chrome. Get that half wrong — carry nothing
 *   forward, or carry the NEW sentence forward — and `posterWords` is
 *   flawlessly correct about the wrong input: every word new, or every word
 *   held, on every rewrite forever. Both halves are broken below and both
 *   halves are caught.
 *
 * WHY THE ASSERTIONS ARE ABOUT CLASS NAMES AND NOT ABOUT LOOKS.
 *
 * The canvas stub draws nothing (see canvas-stub.ts), and the carried/new
 * distinction is spent partly in CSS — a luminance step under reduced motion,
 * an animation otherwise. So nothing here may claim a word looked any way at
 * all. What it claims is the STATE the renderer committed to: which span got
 * `jar-word--held` and which did not. That is the decision the whole feature
 * is, and it is the only part a test in jsdom can honestly see.
 *
 * WHAT WAS REJECTED. Calling `posterWords` directly as a unit test was the
 * obvious cheap option and it is nearly worthless: it pins the half that was
 * never broken and cannot see `prevText` at all, which is the half where a
 * plausible typo silently disables the feature. Every case here goes through
 * the mounted page and the product's own rewrite verbs.
 */
import { act } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { installCanvasStub, setViewport } from "./helpers/canvas-stub";
import {
  apiMockFrom,
  dataMockFrom,
  mountWorld,
  VIEWER_ID,
  type MountedWorld,
} from "./helpers/render-home";

/* The same base the helper's `daysAgo` is measured from, so the board's
   entries and the memories under them share one calendar. */
const BASE = Date.UTC(2026, 7, 16);
const at = (daysAgo: number) => BASE - daysAgo * 86_400_000;

/**
 * THE SENTENCE THE BOARD LEADS WITH, chosen so a rewrite of it can be read.
 *
 * No punctuation, and "the" three times on purpose. Punctuation would glue
 * itself to a word and make "disagree." and "disagree," two different words
 * for reasons that have nothing to do with drift; the repeated "the" is what
 * makes the multiset rule visible at all, because under a set-based match
 * every copy of a repeated word is carried and the bug is invisible.
 */
const FIRST = "We ask the owner when the spec and the code disagree";

const SPEC = "sig-spec";
const CODE = "sig-code";

/**
 * The two hops the peek row is made of: the lead statement cites SIGNALS, and
 * each signal cites MEMORIES. `mem-2` is deliberately behind both signals —
 * the row is a set of memories, not a list of citations, and a row that
 * counted the same memory twice would be describing the chain rather than the
 * ground.
 */
const BEHIND: Record<string, string[]> = {
  [SPEC]: ["mem-0", "mem-1", "mem-2"],
  [CODE]: ["mem-2", "mem-3"],
};
/** four distinct memories: mem-0, mem-1, mem-2, mem-3 */
const CHAIN_SIZE = 4;

const OTHER = "profile-other";

/**
 * Nine memories, four of which the poster's statement was read from.
 *
 * Nine matters: the peek row's fallback, when a wall's provenance is unknown,
 * is "the newest five". So a chain of four is a number that cannot be reached
 * by the fallback (5) or by counting everything (9), and a test that saw the
 * fallback where it expected the chain fails instead of passing by luck.
 */
const FACTS = {
  inspirations: Array.from({ length: 9 }, (_, i) => ({
    id: `mem-${i}`,
    text: `something I kept, ${i}`,
    daysAgo: i + 2,
  })),
  /* One group, and it exists for one reason: see `atOwnWallWithGround` below.
     Its own contents are the existing field test's business, not this file's. */
  groups: [
    {
      id: "group-1",
      name: "The four of us",
      field: Array.from({ length: 4 }, (_, i) => ({
        id: `g-${i}`,
        ownerProfileId: i < 2 ? VIEWER_ID : OTHER,
        ownerName: i < 2 ? "You" : "Hana",
        daysAgo: i + 2,
      })),
    },
  ],
};

/**
 * The board: one artifact, two statements, and only the first is ever seen.
 *
 * That is not a shortcoming of the fixture — headquarters shows exactly ONE
 * sentence, the lead of the board, and `deriveAmbition` picks it. The second
 * entry is here to prove that: if a change ever made the poster a list, the
 * text assertions below would find a sentence they did not ask for.
 */
function board(body: string) {
  return {
    id: "tom-self",
    version: 3,
    reason: "regenerated" as const,
    createdMs: at(2),
    entries: [
      {
        id: "entry-lead",
        type: "hypothesis" as const,
        body,
        belief: null,
        prompt: null,
        locked: false,
        pinned: false,
        dismissed: false,
        sortOrder: 0,
        citedSignals: [
          { id: SPEC, statement: "the spec is read as the promise" },
          { id: CODE, statement: "the code is read as the truth" },
        ],
        createdMs: at(2),
      },
      {
        id: "entry-second",
        type: "question" as const,
        body: "A statement that never reaches the poster",
        belief: null,
        prompt: null,
        locked: false,
        pinned: false,
        dismissed: false,
        sortOrder: 1,
        citedSignals: [],
        createdMs: at(3),
      },
    ],
  };
}

/**
 * THE SEAM IS `lib/data`. The helper's own note says why at length and it is
 * not repeated here: mocking `lib/api` instead sends the page down the offline
 * path, and the suite then passes while describing the dev fixture.
 *
 * `loadSignals` and `loadSignal` are overridden on top of the helper's empty
 * sky because the peek row cannot exist without them — the chain from a
 * statement to a memory runs THROUGH a signal, and an empty sky would give an
 * empty row for an innocent reason and prove nothing.
 */
vi.mock("../src/lib/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/data")>();
  const signal = (id: string) => ({
    id,
    statement: `statement of ${id}`,
    /* ACTIVE RATHER THAN EMERGING — A PRECAUTION, AND NOT A LOAD-BEARING ONE.
       An emerging signal is counted by the forming line under the poster, and
       `setChrome`'s guard writes `prevText: prev.text` whenever ANY of the
       chrome fields it compares has moved. So a forming line that changed
       AFTER the poster already had its sentence would carry that sentence
       forward onto itself, and `posterWords` would light every word of it.
       That mechanism is real and worth knowing about.
       What is NOT true is the claim that used to stand here: that the first
       case below would fail if these were emerging. It does not. Measured —
       flip this one word to "emerging" and all six cases still pass — because
       nothing here ever makes the forming line change after the fact.
       `formingWords` counts signals whose `createdMs` is at or before the dial
       time, both of these are dated four days back, the dial never moves in
       this file, and every fetch settles inside one React commit, so the line
       reaches its value in the same commit that first gives the poster its
       sentence, when `prev.text` is still null.
       Left as `active` anyway: it costs nothing and it keeps the first case
       out of reach of that mechanism if this fixture ever gains a signal dated
       inside the run, or a case that winds the dial. */
    status: "active" as const,
    confidence: 60,
    evidenceCount: BEHIND[id].length,
    lastEvidenceMs: at(3),
    createdMs: at(4),
    locked: false,
    unsupported: false,
    sharedGroupIds: [],
  });
  return {
    ...actual,
    ...dataMockFrom(FACTS),
    loadSignals: async () => [SPEC, CODE].map(signal),
    loadSignal: async (id: string) => ({
      ...signal(id),
      evidence: BEHIND[id].map((inspirationId) => ({
        signalId: id,
        inspirationId,
        preview: `something I kept, ${inspirationId.slice(4)}`,
        quote: "I kept",
        reason: `read as ${id}`,
        createdMs: at(3),
      })),
    }),
    loadTopOfMind: async () => board(FIRST),
  };
});

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return {
    ...actual,
    ...apiMockFrom(FACTS),
    /* The write behind "keep these words". Its RESULT is discarded by the
       page — the new sentence is already in hand — so this only has to
       resolve. What matters is that it is mocked at all: unmocked it would
       reach the network, fail, and the page would answer by reloading the
       board, which would put the OLD sentence back and quietly turn every
       rewrite case below into a test of nothing. */
    updateTopOfMindEntry: async (entryId: string, input: { body: string }) => ({
      id: entryId,
      body: input.body,
    }),
  };
});

vi.mock("../src/lib/auth-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/auth-context")>();
  const session = {
    status: "authenticated",
    account: { id: "account-1", email: "you@example.test" },
    profile: { id: VIEWER_ID, name: "You", type: "human" },
    profiles: [],
    refresh: async () => undefined,
    signOut: async () => undefined,
  };
  /* the page reads the OPTIONAL hook — it renders for a signed-out visitor too */
  return { ...actual, useOptionalAuth: () => session, useAuth: () => session };
});

let layout: MountedWorld;

beforeAll(() => {
  installCanvasStub();
  setViewport(1280, 900);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(async () => {
  layout = await mountWorld(FACTS);
});

afterEach(() => {
  layout?.unmount();
});

/**
 * The poster of the wall you are STANDING ON.
 *
 * Every wall renders its own column, so `.jar-poster` matches three elements
 * here and the first of them belongs to an agent. `data-jar-chrome` is the
 * page's own mark for "this is the one you can interrogate", which is exactly
 * the one the drift readout is about, so the selector borrows it rather than
 * inventing a positional rule that a layout change would silently break.
 */
function posterHere(): HTMLElement {
  const el = layout.container.querySelector<HTMLElement>('h1.jar-poster[data-jar-chrome="1"]');
  if (!el) {
    const seen = [...layout.container.querySelectorAll("h1.jar-poster, p.jar-forming")].map((n) =>
      (n.textContent ?? "").trim(),
    );
    throw new Error(
      `no poster on the wall we are standing on — saw: ${JSON.stringify(seen)}. ` +
        "A `.jar-forming` in that list means the board never arrived, so the " +
        "loadTopOfMind mock is wrong rather than the poster.",
    );
  }
  return el;
}

/** The poster's words in order, each with whether it survived the last rewrite. */
function posterWordsHere(): Array<[string, "held" | "new"]> {
  return [...posterHere().querySelectorAll("span.jar-word")].map((el) => [
    el.textContent ?? "",
    el.classList.contains("jar-word--held") ? "held" : "new",
  ]);
}

/** just the sentence, with the trailing space each word carries trimmed off */
const posterText = () => (posterHere().textContent ?? "").trim();

async function press(selector: string, name: RegExp): Promise<void> {
  const el = [...layout.container.querySelectorAll(selector)].find((n) =>
    name.test((n.textContent ?? "").trim()),
  );
  if (!el) {
    const seen = [...layout.container.querySelectorAll(selector)].map((n) =>
      (n.textContent ?? "").trim(),
    );
    throw new Error(`no ${selector} matching ${name} — saw: ${JSON.stringify(seen)}`);
  }
  await act(async () => {
    (el as HTMLElement).click();
  });
}

/**
 * REWRITE THE STATEMENT, THE WAY A PERSON DOES.
 *
 * "Say it in my words" is the product's own rewrite verb and it goes through
 * the whole path: the entry is edited, the board's adopted sentence is
 * dropped, the chrome is recomputed, and the sentence being replaced is
 * carried forward as `prevText`. Driving `posterWords` directly would skip
 * every one of those steps, including the only one a typo has ever broken.
 *
 * The value has to be set through the prototype's own setter: React tracks the
 * last value it wrote on the node, and assigning `.value` plainly leaves that
 * tracker agreeing with the new text, so React reads the change as a no-op and
 * the textarea silently keeps the old words. That is precisely the "passes by
 * doing nothing" failure this suite exists to refuse, which is why the
 * assertion at the end is not optional decoration: it is the proof that the
 * rewrite actually landed before any case says anything about its words.
 */
async function rewriteTo(next: string): Promise<void> {
  const was = posterText();
  await press(".jar-board-act", /say it in my words/i);
  const box = layout.container.querySelector<HTMLTextAreaElement>("textarea.jar-reflect-box");
  if (!box) throw new Error("the edit box never opened — 'Say it in my words' did nothing");
  const nativeValue = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  if (!nativeValue) throw new Error("jsdom has no HTMLTextAreaElement value setter");
  await act(async () => {
    nativeValue.call(box, next);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await press(".jar-reflect button", /keep these words/i);
  await layout.step(10);

  expect(posterText(), "the rewrite never reached the poster").toBe(next);
  expect(posterText(), "the poster is still showing the sentence it started on").not.toBe(was);
}

describe("the poster's drift readout", () => {
  /**
   * THE FIRST SENTENCE IS NOT DRIFT.
   *
   * One version is not a history, and a poster that lit every word on its
   * first appearance would be claiming a past it does not have. This is the
   * case that catches the more tempting of the two `prevText` typos — writing
   * the sentence forward onto ITSELF (`prevText: next.text`) rather than
   * carrying the one it replaces — because that reads as correct everywhere
   * else on screen and simply lights everything, forever.
   */
  it("has nothing lit before there is anything to have survived", async () => {
    expect(posterText(), "the board's lead statement is what headquarters shows").toBe(FIRST);
    /* let the loop run well past the pour: chrome is recomputed on a dial tick
       and a case that only held for one frame would be worth nothing */
    await layout.step(60);
    expect(
      posterWordsHere().filter(([, state]) => state === "held"),
      "the poster says these words survived a rewrite that never happened — " +
        "check that setChrome carries the sentence being REPLACED forward, not the new one",
    ).toEqual([]);
  });

  /**
   * THE RULE ITSELF.
   *
   * One word replaced. Everything else survived, so everything else stays lit,
   * and the reader's eye is left with exactly one moving thing — which IS the
   * readout. Asserted as the whole ordered sentence rather than as counts: a
   * count would pass if the right NUMBER of words were lit in the wrong
   * places, and "which words held" is the entire content of the surface.
   */
  it("keeps the words that survived a rewrite lit, and arrives the one that is new", async () => {
    await rewriteTo("We ask the owner when the spec and the tests disagree");

    expect(posterWordsHere()).toEqual([
      ["We", "held"],
      ["ask", "held"],
      ["the", "held"],
      ["owner", "held"],
      ["when", "held"],
      ["the", "held"],
      ["spec", "held"],
      ["and", "held"],
      ["the", "held"],
      ["tests", "new"],
      ["disagree", "held"],
    ]);
  });

  /**
   * MOVING A WORD IS NOT CHANGING YOUR MIND.
   *
   * The same words in a different order is the same thought said differently,
   * and a poster that flickered through all of it would be reporting drift
   * that did not happen — which is worse than reporting none, because it makes
   * the one channel this surface has untrustworthy.
   *
   * This is the case that catches the implementation everybody writes first: a
   * positional comparison of the two sentences, `prev[i] === word`. Under it
   * this rewrite lights nothing from "spec" onward, and the reader is told
   * their thinking changed when it did not.
   */
  it("treats a reordering as no drift at all", async () => {
    await rewriteTo("We ask the owner when the code and the spec disagree");

    const words = posterWordsHere();
    expect(words.map(([w]) => w).join(" ")).toBe(
      "We ask the owner when the code and the spec disagree",
    );
    expect(
      words.filter(([, state]) => state === "new"),
      "the words are the same words — nothing about this sentence is new",
    ).toEqual([]);
  });

  /**
   * A WORD SAID TWICE HAS TO BE FOUND TWICE.
   *
   * The matching is a multiset and this is the only case that can tell. The
   * previous sentence said "the" three times; this one says it four. Three of
   * them survived and the fourth genuinely arrived — and the same for the
   * second "and". Under a set-based match ("was this word anywhere in the old
   * sentence?") all four are lit, the sentence visibly grew and the readout
   * says nothing changed.
   *
   * Positions matter here too: it is the FIRST three "the"s that are carried
   * and the LAST that arrives, because the words are read in order and the
   * pool is drawn down as it goes. Asserting the whole sentence pins that.
   */
  it("carries a repeated word only as many times as it was there before", async () => {
    await rewriteTo("We ask the owner when the spec and the code and the tests disagree");

    expect(posterWordsHere()).toEqual([
      ["We", "held"],
      ["ask", "held"],
      ["the", "held"],
      ["owner", "held"],
      ["when", "held"],
      ["the", "held"],
      ["spec", "held"],
      ["and", "held"],
      ["the", "held"],
      ["code", "held"],
      ["and", "new"],
      ["the", "new"],
      ["tests", "new"],
      ["disagree", "held"],
    ]);
  });
});

/**
 * WHAT THE POSTER IS STANDING ON.
 *
 * The peek row is the band of memories that rises under the sentence: not the
 * newest few, but the ones it was READ FROM. It shipped empty for every group
 * because the provenance map was written under a hand-built key and read back
 * through `spaceKey`, two spellings that never met, and sixty-four green tests
 * had nothing to say about it. The existing field test now covers the group
 * end of that; these two cover your own wall, which is the same map, the same
 * function, and the same class of mistake one key along.
 */
describe("what the poster is standing on", () => {
  /**
   * WHY THE TRIP OUT AND BACK IS NOT CEREMONY.
   *
   * The provenance map reaches the field through an effect that calls
   * `simApiRef.current?.setProvenance`, and measured here that effect runs
   * once at boot with `simApiRef.current` still null — every fetch the page
   * makes settles inside a single React commit under these mocks, and the
   * effect is declared above the one that builds the simulation. Nothing
   * re-triggers it on your own wall, so the count reads zero at boot however
   * long the loop is stepped. Arriving at a group changes `wokenGroups`, the
   * effect runs again, and the field is handed the whole map — your own wall's
   * entry under `self:` included.
   *
   * That boot-time gap is reported rather than pinned: whether it survives
   * real network latency is not something a mock can answer, and freezing it
   * in a test would be asserting a scheduling accident. What IS pinned is the
   * harder half and the one the bug lived in — after arriving somewhere else
   * and coming home, your own wall's claim still resolves under the key the
   * field asks for.
   */
  async function atOwnWallWithGround(): Promise<void> {
    await layout.travelTo(/four of us/i);
    await layout.travelTo(/waka/i);
    const a = layout.audit();
    expect(a.wallKind, "we came home to our own wall").toBe("self");
    expect(a.wallId, "and it is the self wall, whose key is `self:`").toBe("");
  }

  it("stands on the memories its statement was read from, not on the newest few", async () => {
    await atOwnWallWithGround();

    expect(
      layout.audit().provenanceCount,
      "your own poster is standing on nothing — check the key the provenance " +
        "map is written under against spaceKey() for the self wall",
    ).toBe(CHAIN_SIZE);
  });

  /**
   * AND THE ROW SAYS THE SAME THING THE FIELD DOES.
   *
   * Two hops: the statement cites signals, the signals cite memories, and the
   * row is the far end of that chain. Keyed by the wrong id at either hop the
   * chain resolves to nothing and the page says "written by hand" — which is a
   * sentence it is supposed to say only about a sentence somebody typed, and
   * which is exactly what every group poster said while the bug was live. So
   * the absence of that phrase is asserted too, not just the presence of rows.
   *
   * Four rows, and the count is load-bearing rather than decoration. `mem-2`
   * stands behind BOTH signals and must appear once — the row is a set of
   * memories, and de-duplicating by citation instead collapses it to one row
   * per signal, which is two. Two rows would still read as a working feature
   * on screen, which is why the number is asserted and not merely "some".
   */
  it("names those same memories in the row under it, rather than saying it was written by hand", async () => {
    /* the row is folded away until the sentence is asked where it came from —
       the poster IS the control, there is no button beside it */
    await press('h1.jar-poster[data-jar-chrome="1"]', /./);
    await layout.step(5);

    const lead = layout.container.querySelector(".jar-prov--poster .jar-prov-lead");
    expect(lead?.textContent, "the poster was asked and answered with nothing").toBe("built from");

    const rows = [...layout.container.querySelectorAll(".jar-prov--poster .jar-prov-row")].map(
      (n) => (n.textContent ?? "").trim(),
    );
    expect(rows).toHaveLength(CHAIN_SIZE);
    /* each row names a memory AND why it was read that way — the row is an
       explanation, and one without the reason is just a list of text */
    expect(rows.filter((r) => /read as sig-(spec|code)/.test(r))).toHaveLength(CHAIN_SIZE);
    expect(rows.some((r) => r.includes("something I kept, 3"))).toBe(true);
  });
});
