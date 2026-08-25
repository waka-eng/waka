// @vitest-environment jsdom

/**
 * LAYER TWO, OBSERVED FOR THE FIRST TIME.
 *
 * `home-field.test.tsx` beside this file watches the ground under a wall. The
 * sky over it had never been watched at all: no candidate reached the harness,
 * so `sky-engine.ts` — thirteen functions over a thousand lines, freshly
 * lifted out of Home.tsx — was standing on nothing but a diff that showed its
 * text had not changed. Five of its functions had never been executed by any
 * test, and every one of them is reached only by a pointer gesture:
 * `persistSky`, `focusOn`, `releaseHolds` and `sayWho` are called from the
 * input handlers themselves, and `springs` runs in the frame loop but only
 * while something is selected, which nothing but a tap ever starts. This file
 * makes those gestures.
 *
 * HOW THE SKY IS OBSERVED, GIVEN THAT IT IS DRAWN ON A CANVAS THAT DRAWS
 * NOTHING.
 *
 * Two channels, and neither of them is a pixel.
 *
 *   1. EACH CANDIDATE'S SENTENCE IS REAL DOM, and the loop writes the cloud's
 *      own numbers onto it every frame in `syncDom`: the transform carries
 *      where the loop put it and how far the subject has grown, the opacity
 *      carries dispersal, condensation, the cluster whisper and the focus
 *      sink. So `.jar-neb`'s inline style is a live readout of the Neb behind
 *      it, published by the product for its own reasons rather than for this.
 *      (Of those four factors only condensation and the focus sink are ever
 *      driven below; nothing here disperses a cloud or builds a cluster.)
 *
 *   2. THE HIT TESTS ANSWER — FOR ONE CANDIDATE'S EVIDENCE, AND ONLY WHERE IT
 *      HAS A NAME. A satellite exists nowhere else, it is painted and gone,
 *      but `satAt` will say whether one is under a given point and `sayWho`
 *      writes its owner's given name into `.jar-satsay`. Sweeping the pointer
 *      and collecting where the whisper lights is therefore a measurement of
 *      where the SUBJECT'S NAMED evidence is in orbit, and of nothing wider
 *      than that. Both narrowings are load-bearing and neither is obvious:
 *
 *        `satAt` reads `sky.focusNeb` and returns null when there is none, so
 *        it can never answer for a candidate that is not the subject — nor for
 *        a satellite still under half emerged.
 *
 *        `sayWho` writes only `s.who`, which `makeSat` fills from an evidence
 *        row's `authorName`. A room's evidence carries one; the viewer's own
 *        signals cite their own saves and carry none. Measured: sweeping the
 *        whole region around NAMING while it IS the subject and its three
 *        satellites are fully out returns nothing at all. So every claim below
 *        that rests on a sweep is a claim about the proposal's affirmers, and
 *        a personal candidate's orbit is not observed by this file at all.
 *
 * Both are STATE, not appearance. Nothing here asserts a colour, a brightness
 * or a pixel, because the stub draws none and a test that claimed otherwise
 * would be describing its own stub. What is asserted is what exists, where the
 * layout put it, and what is active — the same rule the field's file obeys.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6).
 *
 *   `lib/data` — the seam, and the whole subject arrives through it. A
 *   candidate overhead is a signal from `loadSignals`, and the satellites
 *   around it are the evidence from `loadSignal`; the page asks no HTTP client
 *   for either. Mocking `lib/api` instead would throw inside a loader and the
 *   page would answer by replacing the world with the dev fixture, which has a
 *   sky of its own — so the sweep below would find satellites, `sayWho` would
 *   whisper names, and every case would pass while measuring an orbit around
 *   sentences that were typed into `lib/fixture/`.
 *
 *   `lib/api` — for the group reads, which have no loader above them, plus
 *   `fetchGroupProposals` and `affirmGroupProposal`, this file's own subject
 *   for the proposal cases. `fetchGroupWall` serves one LOCKED
 *   statement; the reason is at the mock.
 *
 *   `lib/auth-context` — the session stated as a fact, because the page also
 *   renders for a signed-out visitor and that is a different sky.
 *
 *   `helpers/canvas-stub` and `helpers/render-home` — canvas, clock, frame
 *   loop, viewport and `Math.random`. The seeded random matters here more than
 *   anywhere: a satellite's phase comes off a hash and its drift off
 *   `Math.random`, so without the seed the sweep would find it in a different
 *   place on every run. `home-field.test.tsx` gives the long version of all
 *   four seams.
 *
 * WHY THE SWEEP RATHER THAN ARITHMETIC. The obvious alternative was to solve
 * each satellite's screen position in the test — the ellipse comes off the
 * measured sentence box, the phase off a hash — and hover exactly there. That
 * was rejected: it would reimplement `measureNeb` and `placeSats` in the test,
 * so the test would agree with a broken engine as readily as with a working
 * one. Sweeping asks the product where its own satellites are.
 */
import { act } from "react";
import { RECEIPTS } from "../src/lib/receipts";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { installCanvasStub, setViewport } from "./helpers/canvas-stub";
import {
  apiMockFrom,
  dataMockFrom,
  mountWorld,
  VIEWER_ID,
  type MountedWorld,
} from "./helpers/render-home";

/* Hoisted with the mock factory that fills it, because `vi.mock` is lifted
   above every other statement in the file and a plain `const` here would not
   exist yet when the factory runs. */
const KEPT = vi.hoisted(() => ({ calls: [] as { id: string; text: string }[] }));

const GROUP_ID = "group-1";
const PROPOSAL_ID = "proposal-1";
const DAY = 86_400_000;
const BASE = Date.UTC(2026, 7, 16);
const iso = (daysAgo: number) => new Date(BASE - daysAgo * DAY).toISOString();

/**
 * WHO STANDS BEHIND THE PROPOSAL, AND WHY THERE ARE TWO OF THEM.
 *
 * Not saves. A room's proposal cites its AFFIRMERS and never their memories
 * (`textPreview` is empty on every one of these rows), which is the canon's
 * privacy line: a room may name who agreed and must not name what they kept.
 *
 * A group's pending proposal is the one candidate whose evidence carries
 * NAMES — the members who have affirmed it — and a name is the only thing a
 * satellite ever says out loud (`sayWho` prints nothing for a satellite with
 * no author, which is every satellite of your own signals). So the proposal is
 * the only candidate whose orbit can be counted from outside the canvas, and
 * two affirmers is the smallest number that can tell "the evidence is in
 * orbit" apart from "one thing is somewhere".
 */
const AFFIRMERS = [
  { profileId: "profile-hana", name: "Hana Ko" },
  { profileId: "profile-jun", name: "Jun Park" },
];

const FACTS = {
  inspirations: Array.from({ length: 6 }, (_, i) => ({
    id: `own-${i}`,
    text: `something I kept, ${i}`,
    daysAgo: i + 1,
  })),
  groups: [
    {
      id: GROUP_ID,
      name: "The four of us",
      field: [
        { id: "g-mine-0", ownerProfileId: VIEWER_ID, ownerName: "You", daysAgo: 2 },
        { id: "g-theirs-0", ownerProfileId: "profile-hana", ownerName: "Hana Ko", daysAgo: 4 },
      ],
    },
  ],
};

/**
 * Two of the viewer's own signals, still forming — the sky's ordinary
 * inhabitants. Their evidence cites memories that genuinely exist in
 * `FACTS.inspirations`, because the page resolves a personal candidate's
 * evidence against the field in hand and SKIPS an id with nothing behind it.
 * Citing invented ids would produce nebulae with no satellites and a test that
 * measured its own fixture's carelessness.
 */
const SIGNALS = [
  {
    id: "signal-naming",
    statement: "You keep coming back to how things are named.",
    cites: ["own-0", "own-1", "own-2"],
  },
  {
    id: "signal-proof",
    statement: "You would rather check a claim than repeat it.",
    cites: ["own-3", "own-4"],
  },
];

const OPEN_PROPOSAL = {
  id: PROPOSAL_ID,
  kind: "edit_entry" as const,
  status: "open" as const,
  entryId: "entry-1",
  body: "We ask the owner when the spec and the code disagree.",
  rationale: null,
  proposedByProfileId: AFFIRMERS[0].profileId,
  proposedByName: AFFIRMERS[0].name,
  stances: AFFIRMERS.map((a, i) => ({
    profileId: a.profileId,
    name: a.name,
    value: "affirmed" as const,
    createdAt: iso(i + 1),
  })),
  viewerStance: null,
  resolvedAt: null,
  createdAt: iso(3),
};

/**
 * THE SEAM IS `lib/data` FOR THE THREE LAYERS AND `lib/api` FOR A GROUP'S
 * READS — the same division `render-home.tsx` explains at length, and the same
 * one that let a whole suite describe the dev fixture once. `loadSignals` and
 * `loadSignal` are overridden in the `lib/data` mock BELOW rather than in the
 * shared helper, because they are this file's subject: the field's tests want
 * an empty sky, and a helper that quietly filled it would change what they are
 * measuring.
 *
 * `fetchGroupWall` is emptied on purpose. A group's shared statements become
 * candidates at the GROUP's column, and every case below stands on the
 * viewer's own wall, so those clouds would be candidates no assertion here
 * reaches for by name.
 *
 * WHAT THAT DOES NOT BUY, SAID PLAINLY, BECAUSE IT LOOKS LIKE IT BUYS MORE.
 * Emptying it does not leave a sky holding only the three sentences named
 * below. `clouds()` returns SEVEN `.jar-neb`s here: those three, and four more
 * standing over the agent walls to the left — which are the dev fixture
 * (`lib/fixture/agent-walls.ts`, gated on `import.meta.env.DEV`, and Vitest
 * sets DEV). Every loop below that walks `clouds()` walks those four as well.
 * That is a real weakness of this file, and it cuts both ways: the whole-sky
 * assertions (one subject, one sink) are stronger for it, while any claim
 * about "the sky" here is partly a claim about invented agents. The three the
 * cases name are the product's own — a mocked proposal and two mocked signals
 * through `lib/data` — and nothing below identifies a cloud by position.
 */
vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return {
    ...actual,
    ...apiMockFrom(FACTS),
    /* One shared statement, LOCKED — the owner's own words on the room's
       wall. The star must render exactly where other people read the
       sentence (no-quiet-corners Phase 8), and the case below pins it. The
       cloud stands at the GROUP's column, far from every viewport this
       file's other cases work in, so the whole-sky loops absorb it the way
       they absorb the four dev-fixture agents. */
    fetchGroupWall: async (groupId: string) =>
      groupId === GROUP_ID
        ? [
            {
              signalId: "wall-sig-starred",
              statement: "The room holds my own words, starred.",
              confidenceAsWritten: 70,
              locked: true,
              /* room-grown shape (2026-08-24): the statement is the room's,
                 standing on two voices — the star still renders exactly
                 where other people read the sentence */
              contributors: [
                { profileId: VIEWER_ID, name: "You" },
                { profileId: "profile-hana", name: "Hana Ko" },
              ],
              sharedAt: new Date(BASE - DAY).toISOString(),
              reactions: [],
            },
          ]
        : [],
    /**
     * The write behind "keep the change", and the only one of the three whose
     * result is not visible on screen: a kept memory closes its own panel, and
     * the orb it belongs to carries its words on a canvas that draws nothing
     * here. So this one is recorded rather than read back — what the archive
     * was asked to store is the only honest observation available.
     */
    updateInspiration: async (inspirationId: string, input: { text: string }) => {
      KEPT.calls.push({ id: inspirationId, text: input.text });
      return { id: inspirationId, text: input.text };
    },
    /* The write behind "keep these words". Its RESULT is discarded by the page
       — the new sentence is already in hand — so this only has to resolve.
       What matters is that it is mocked at all: unmocked it would reach the
       network, fail, and the page would put the machine's sentence back, which
       would turn the rewrite case below into a test of nothing. */
    updateSignal: async (signalId: string, input: { statement: string }) => ({
      id: signalId,
      statement: input.statement,
    }),
    /* The write behind every verdict. Unmocked it would reach a network that
       is not there, and the page — honestly — would take the answer back off
       the row when the request died, which would strand the let-go case
       below: "then let it go" is only offered while the not-true stands. */
    createFeedback: async () => ({ id: "feedback-1" }),
    /* The writes behind "then let it go" and "put it back". The page reads
       only `status` from the restore's result; the dismissal's result is not
       read at all — what matters is that neither reaches a network that is
       not there. The real law they enact is pinned server-side by
       signal-suppression.db.test.ts. */
    dismissSignal: async (signalId: string) => ({ id: signalId, status: "retired" }),
    restoreSignal: async (signalId: string) => ({ id: signalId, status: "emerging" }),
    fetchGroupProposals: async (groupId: string) => (groupId === GROUP_ID ? [OPEN_PROPOSAL] : []),
    affirmGroupProposal: async () => ({
      proposal: { ...OPEN_PROPOSAL, status: "accepted" as const },
      accepted: true,
    }),
  };
});

vi.mock("../src/lib/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/data")>();
  const row = (s: (typeof SIGNALS)[number]) => ({
    id: s.id,
    statement: s.statement,
    /* `emerging` is the whole reason these appear overhead: an `active` signal
       is what headquarters already stands on and a `retired` one has sunk. */
    status: "emerging" as const,
    confidence: 60,
    evidenceCount: s.cites.length,
    lastEvidenceMs: BASE - DAY,
    createdMs: BASE - 10 * DAY,
    locked: false,
    unsupported: false,
    sharedGroupIds: [],
  });
  return {
    ...actual,
    ...dataMockFrom(FACTS),
    loadSignals: async () => SIGNALS.map(row),
    loadSignal: async (id: string) => {
      const s = SIGNALS.find((x) => x.id === id);
      if (!s) throw new Error(`no such signal ${id}`);
      return {
        ...row(s),
        evidence: s.cites.map((cite, i) => ({
          signalId: s.id,
          inspirationId: cite,
          preview: `something I kept, ${cite.slice(4)}`,
          quote: `the words that carried it, ${i}`,
          reason: null,
          createdMs: BASE - (i + 1) * DAY,
        })),
      };
    },
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
  return { ...actual, useOptionalAuth: () => session, useAuth: () => session };
});

let layout: MountedWorld;

beforeAll(() => {
  installCanvasStub();
  setViewport(1280, 900);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(async () => {
  /* a spot kept from an earlier case would come back as a PINNED cloud, which
     silently disables the layout the first case is about */
  window.localStorage.clear();
  KEPT.calls.length = 0;
  layout = await mountWorld(FACTS);
  /* the sky arrives a hop behind the field: loadSignals, then one loadSignal
     per signal for its evidence, then the memo, then syncSky */
  await layout.step(40);
});

afterEach(() => {
  layout?.unmount();
});

/* ------------------------------------------------------------------ reading
   the sky out of the DOM the loop writes to */

/** The three sentences standing in the viewer's own sky, by their opening words. */
const PROPOSAL = "We ask the owner";
const NAMING = "You keep coming back";
const PROOF = "You would rather check";

function clouds(): HTMLElement[] {
  return [...layout.container.querySelectorAll<HTMLElement>(".jar-sky .jar-neb")];
}

function cloud(startsWith: string): HTMLElement {
  const found = clouds().find((n) =>
    (n.querySelector(".jar-neb-text")?.textContent ?? "").startsWith(startsWith),
  );
  if (!found) {
    const seen = clouds().map((n) => (n.querySelector(".jar-neb-text")?.textContent ?? "").slice(0, 24));
    throw new Error(`no candidate whose sentence starts "${startsWith}" — saw ${JSON.stringify(seen)}`);
  }
  return found;
}

/** Where the loop last put this cloud, in screen pixels. */
function spotOf(el: HTMLElement): { x: number; y: number } {
  const m = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(el.style.transform);
  if (!m) {
    throw new Error(
      `the loop has never placed this cloud — transform is "${el.style.transform}". ` +
        "Either syncSky never ran or the sky has no Neb under this candidate's id.",
    );
  }
  return { x: Number(m[1]), y: Number(m[2]) };
}

/**
 * How far the subject has grown. `syncDom` writes `scale(1 + FOCUS_POP * focus)`
 * — one number carrying the whole focus ease — so "is this one the subject" is
 * readable without owning FOCUS_POP's value here.
 */
function growthOf(el: HTMLElement): number {
  const m = /scale\(([\d.]+)\)/.exec(el.style.transform);
  if (!m) throw new Error(`no scale in "${el.style.transform}"`);
  return Number(m[1]);
}

const opacityOf = (el: HTMLElement) => Number(el.style.opacity);

/* ------------------------------------------------------------------ pointer

   `onDown` is registered on the layout root in the CAPTURE phase and
   `onMove`/`onUp` on the window, so a press has to be dispatched on a real
   descendant of the root and the lift on the window. Pressing the sentence is
   the product's own gesture: "the words visually ARE the cloud". */

const pointer = { pointerId: 1, pointerType: "mouse", bubbles: true } as const;

async function pressOn(el: HTMLElement, x: number, y: number) {
  await act(async () => {
    el.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, cancelable: true, clientX: x, clientY: y }));
  });
}

function moveTo(x: number, y: number) {
  window.dispatchEvent(new PointerEvent("pointermove", { ...pointer, clientX: x, clientY: y }));
}

async function liftAt(x: number, y: number) {
  await act(async () => {
    window.dispatchEvent(new PointerEvent("pointerup", { ...pointer, clientX: x, clientY: y }));
  });
}

/** The bare layout, for a press that is meant to land on a satellite rather
    than on a sentence — the canvas is the only child of the root that is not
    itself chrome. */
function canvas(): HTMLElement {
  const el = layout.container.querySelector("canvas");
  if (!el) throw new Error("no canvas — the layout never mounted");
  return el as HTMLElement;
}

/**
 * Climb into the sky, the way the layout offers it: the one quiet line under
 * the ambition that says something is forming. Every satellite measurement
 * needs the camera up here — a candidate's screen position is its place minus
 * the camera, and from headquarters the whole sky sits at a negative y.
 */
async function climbToSky() {
  const up = layout.container.querySelector<HTMLElement>(".jar-overhead");
  if (!up) throw new Error("no forming line — nothing is overhead to climb to");
  await act(async () => up.click());
  await layout.step(80);
}

/** A press that never moved is a tap: it makes the candidate the subject. */
async function tapSentence(startsWith: string): Promise<HTMLElement> {
  const el = cloud(startsWith);
  const at = spotOf(el);
  await pressOn(el, at.x, at.y);
  await liftAt(at.x, at.y);
  /* the focus ease is 300ms and the emergence 420ms plus stagger */
  await layout.step(45);
  return el;
}

/** Open a read pattern's grounds — the tap the one-line rule put them behind. */
async function whereFrom(startsWith: string): Promise<void> {
  const el = cloud(startsWith);
  const verb = [...el.querySelectorAll<HTMLElement>(".jar-neb-ask button")].find(
    (b) => (b.textContent ?? "").trim() === "where from",
  );
  if (!verb) throw new Error(`no 'where from' under ${startsWith}`);
  await act(async () => verb.click());
}

/**
 * Press across the field until a memory's panel opens, and hand it back.
 *
 * The band comes from the audit rather than from a guess, so this follows the
 * field wherever the fit put it; the step is smaller than the smallest orb the
 * audit reports, so a hit is not luck.
 */
async function tapAnOrb(): Promise<HTMLElement> {
  const a = layout.audit();
  if (a.drawn.active === 0) throw new Error("the field is empty — nothing to tap");
  const step = Math.max(6, Math.floor(a.drawn.rMin));
  for (let y = Math.floor(a.highest); y <= Math.ceil(a.lowest); y += step) {
    for (let x = 20; x <= 1400; x += step) {
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

/** Shut the room of grounds — the one way out, by design. */
async function closeGrounds(): Promise<void> {
  const room = layout.container.querySelector<HTMLElement>(".jar-prov-room");
  if (!room) throw new Error("no room of grounds is open");
  const close = [...room.querySelectorAll<HTMLElement>("button")].find(
    (b) => (b.textContent ?? "").trim() === "enough",
  );
  if (!close) throw new Error("the room of grounds has no way out");
  await act(async () => close.click());
  await layout.step(5);
}

async function tapEmptySky() {
  await pressOn(canvas(), 30, 30);
  await liftAt(30, 30);
  await layout.step(30);
}

/**
 * WHERE THIS CANDIDATE'S EVIDENCE ACTUALLY IS, asked of the product.
 *
 * Sweeps the pointer over the whole region a satellite could occupy — the
 * orbit can never be wider than `SKY_PAD_X`/`SKY_PAD_Y` of the viewport, which
 * is what `orbFitX`/`orbFitY` cut it to — and collects every point where the
 * whisper lit, keyed by the name it said. The result is each satellite's
 * centre of mass RELATIVE TO ITS CLOUD, which is the frame that matters: the
 * cloud itself drifts, so an absolute position would move even for a satellite
 * being held perfectly still.
 *
 * The step is ten pixels against a satellite whose hit radius is its drawn
 * radius plus four, so a satellite cannot slip between two samples. Averaging
 * the hits rather than taking the first one removes the sampling grid from the
 * answer, which is what makes "it moved" and "it held still" separable at all.
 */
function orbitAround(el: HTMLElement): Map<string, { dx: number; dy: number }> {
  const at = spotOf(el);
  const say = layout.container.querySelector<HTMLElement>(".jar-satsay");
  if (!say) throw new Error("the whisper element is missing — sayWho has nowhere to write");
  const sums = new Map<string, { x: number; y: number; n: number }>();
  for (let dx = -560; dx <= 560; dx += 10) {
    for (let dy = -360; dy <= 360; dy += 10) {
      moveTo(at.x + dx, at.y + dy);
      if (!say.classList.contains("jar-satsay--on")) continue;
      const who = say.textContent ?? "";
      const got = sums.get(who) ?? { x: 0, y: 0, n: 0 };
      got.x += dx;
      got.y += dy;
      got.n += 1;
      sums.set(who, got);
    }
  }
  const out = new Map<string, { dx: number; dy: number }>();
  for (const [who, s] of sums) out.set(who, { dx: s.x / s.n, dy: s.y / s.n });
  return out;
}

const apart = (a: { dx: number; dy: number }, b: { dx: number; dy: number }) =>
  Math.hypot(a.dx - b.dx, a.dy - b.dy);

/* ------------------------------------------------------------------- cases */

describe("what a forming signal becomes overhead", () => {
  /**
   * The first thing that was never checked: that a signal reaches the sky at
   * all. Three candidates stand over the viewer's own wall — two of their own
   * signals still forming, and the group's pending proposal — and each one has
   * a body the loop has placed somewhere in its own column.
   *
   * `spotOf` throws rather than returning a default when the transform is
   * missing, because "no cloud was ever placed" and "a cloud was placed at the
   * origin" are different failures and only one of them is this file's.
   */
  it("gives every candidate a body the loop has placed", async () => {
    await climbToSky();
    const sentences = clouds().map((n) => (n.querySelector(".jar-neb-text")?.textContent ?? ""));
    for (const opening of [PROPOSAL, NAMING, PROOF])
      expect(sentences.some((s) => s.startsWith(opening)), `"${opening}" never reached the sky`).toBe(true);

    /* THE ELEMENTS AND THEIR PLACES, ZIPPED. `clouds()` is not these three: it
       is every candidate in every column, the dev fixture's agent walls
       included, in whatever order React rendered them. This loop used to read
       `clouds()[i]` while walking the named three, so the opacity it checked
       belonged to whichever cloud happened to sit at that index. It agreed
       today by coincidence — the first three in document order are these
       three — and a coincidence is not a test. */
    const named = [PROPOSAL, NAMING, PROOF].map((s) => cloud(s));
    const spots = named.map(spotOf);
    for (const [i, el] of named.entries()) {
      expect(
        Number.isFinite(spots[i].x) && Number.isFinite(spots[i].y),
        `candidate ${i} has no place`,
      ).toBe(true);
      expect(opacityOf(el), "a placed cloud is on screen").toBeGreaterThan(0);
    }
    /* NO TWO OF THESE THREE SENTENCES ARE PRINTED IN ONE PLACE — and measured,
       that is the whole of it.
       This was written as a check on `layoutSky`'s relaxation pass, the one
       that pushes two candidates apart until neither sits on the other's
       words. It is not one. Disabling that pass outright (its loop run zero
       times) leaves all three distances below at 275, 248 and 492 pixels
       instead of 305, 282 and 545 — no candidate crosses the threshold,
       because the ring these are parked on already spreads them and nothing
       here ever produces the overlapping HOMES relaxation exists for.
       And the keep-out it would relax is not the one the product computes.
       `keepR` is the greater of a cloud's light and its SENTENCE's half
       diagonal, and jsdom lays out no text: `offsetWidth` reads 0 and falls
       back to the width the loop had just written, `offsetHeight` reads 0 with
       no fallback at all. So the half diagonal here is half of a width the
       layout chose, against a height of nothing — a number, but not a
       measurement of any words. Same gap as the orbit-clears-the-words maths
       recorded further down, and from the same cause.
       So sixty pixels is a guard against two sentences landing on one spot,
       not a measurement of the rule that keeps them off each other. All three
       pairs and not two of them: an overlap between the first and the last is
       exactly what a two-of-three comparison lets through. */
    for (const [i, j] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ] as const)
      expect(
        apart({ dx: spots[i].x, dy: spots[i].y }, { dx: spots[j].x, dy: spots[j].y }),
        `candidates ${i} and ${j} are printed in the same place`,
      ).toBeGreaterThan(60);
  });

  /**
   * AND IT HAS SATELLITES — one per piece of evidence, in orbit, each saying
   * whose memory it stands for.
   *
   * The control comes first and it is not decoration: before the tap the same
   * sweep over the same region finds nothing, so what comes out afterwards
   * came out because of the tap. Without it this case would pass without the
   * tap having done anything, which is the way a test passes by doing nothing.
   *
   * WHAT THE CONTROL DOES NOT SAY, and it is less than it reads as. It is not
   * "at rest the sky is sentences and faint bodies and nothing else". The
   * sweep is blind twice over (see the header): `satAt` answers for the
   * SUBJECT alone, and the whisper speaks only for evidence carrying a name.
   * So an empty sweep before the tap rules out THIS PROPOSAL'S AFFIRMERS being
   * permanently out, and says nothing whatever about the two personal
   * candidates' satellites — which are nameless, and would be invisible to
   * this sweep whether they were retracted or strewn across the whole sky.
   * Progressive disclosure at large is not pinned by this file.
   *
   * AND THE ORBIT-CLEARS-THE-WORDS MATHS IS NOT COVERED HERE AT ALL, WHICH IS
   * WORTH SAYING BECAUSE THE LAST ASSERTION LOOKS LIKE IT COVERS IT.
   * `measureNeb` solves the ellipse from the sentence's own rendered box, and
   * jsdom lays nothing out. The two halves fail differently, and that is the
   * trap: `offsetWidth` is 0 but falls back to the width the loop had just
   * written (`el.offsetWidth || w`, 320px here), so `rx` comes out about 219
   * and is a real number. `offsetHeight` is 0 with NO fallback, so `ry` is
   * solved for a sentence of zero height and comes out around 50 — flatter
   * than any ring the product could ever draw, and the corner-enclosure step
   * that exists to stop a satellite crossing the last word of a wrapped line
   * runs against a box with no lines in it. Nothing below can tell a working
   * clearance from a broken one; a browser would be needed.
   * The standoff assertion is also a MAX over the two satellites, so it is one
   * satellite's horizontal reach: measured, Hana sits 219 pixels out and Jun
   * 58. It says the evidence is on an ellipse rather than stacked at the
   * centre, and that is all it says.
   */
  it("puts the subject's evidence in orbit around it, one satellite each", async () => {
    await climbToSky();
    const before = orbitAround(cloud(PROPOSAL));
    expect(
      [...before.keys()],
      "before the tap, nothing in the sky answers the pointer as a satellite",
    ).toEqual([]);

    const el = await tapSentence(PROPOSAL);
    const orbit = orbitAround(el);
    expect(
      [...orbit.keys()].sort(),
      "one satellite per affirmation, each naming the member who affirmed it",
    ).toEqual(["Hana", "Jun"]);

    const [hana, jun] = [orbit.get("Hana")!, orbit.get("Jun")!];
    /* THEY ORBIT, THEY DO NOT SIT ON IT. Both standing at the cloud's own
       centre would satisfy every count above and is precisely the bug the
       ellipse solve exists to prevent — evidence printed over the words. */
    expect(apart(hana, jun), "the two satellites are at different places on the ellipse").toBeGreaterThan(80);
    expect(
      Math.max(Math.hypot(hana.dx, hana.dy), Math.hypot(jun.dx, jun.dy)),
      "the orbit stands off the sentence rather than collapsing onto it",
    ).toBeGreaterThan(80);
  });
});

describe("the focus rule: one subject at a time", () => {
  /**
   * THE RULE EXISTS BECAUSE A SKYFUL OF ORBITING EVIDENCE WAS UNREADABLE.
   * Tapping a candidate makes it the subject and sinks every other one on the
   * field's own focus law — one lit thing, one uniform sink, no second tier of
   * highlight. Tapping a different one moves the whole arrangement rather than
   * adding to it.
   *
   * Measured through the loop's own numbers: the subject's growth, which
   * `syncDom` writes as the transform's scale, and everyone else's opacity.
   */
  it("makes exactly one cloud the subject, and sinks the rest", async () => {
    await climbToSky();
    for (const el of clouds())
      expect(growthOf(el), "nothing is the subject before anything is tapped").toBeCloseTo(1, 2);

    await tapSentence(NAMING);
    const subjects = clouds().filter((el) => growthOf(el) > 1.001);
    expect(subjects.length, "exactly one candidate is the subject").toBe(1);
    expect(subjects[0]).toBe(cloud(NAMING));
    const sunk = clouds()
      .filter((el) => el !== subjects[0])
      .map(opacityOf);
    for (const op of sunk) expect(op, "every other candidate has sunk").toBeLessThan(0.5);
    /* AND SUNK TO ONE DEPTH, which the threshold above cannot say and which is
       the actual rule: one lit thing, one sink, no second tier of highlight.
       Two candidates dimmed by different amounts would both pass `< 0.5` while
       breaking exactly the law the focus rule exists to keep, so the depths
       are compared to each other rather than to a bound. They are one number
       and not a near one — every non-subject reads the same `dimN` through the
       same ease from the same start — so this is asserted tightly. */
    for (const op of sunk) expect(op, "one sink, not a second tier").toBeCloseTo(sunk[0], 5);

    await tapSentence(PROOF);
    const after = clouds().filter((el) => growthOf(el) > 1.001);
    expect(after.length, "the subject MOVED — it was not joined by a second one").toBe(1);
    expect(after[0]).toBe(cloud(PROOF));
    expect(growthOf(cloud(NAMING)), "the one you left has come back down").toBeCloseTo(1, 2);
  });

  /**
   * AND THE EVIDENCE IN WORDS FOLLOWS THE SUBJECT TOO. Under the subject's
   * sentence sit the memories it was read from; that section belongs to the
   * one being read and to nothing else, for the same reason its satellites do.
   */
  it("opens one room of grounds, holding the subject's and nobody else's", async () => {
    await climbToSky();
    expect(layout.container.querySelectorAll(".jar-prov-room").length).toBe(0);

    /* ONE LINE AT A TIME (founder ruling, 2026-08-24). Reading a pattern no
       longer prints its grounds, its verbs and its receipt all at once; the
       grounds are one tap away on the line that is already there, which is
       what `where from` is.

       AND THE GROUNDS ARE A ROOM NOW, NOT A LIST UNDER THE SENTENCE (founder,
       2026-08-25). The rows used to fly the camera down into the field, which
       cost you the place you were reading from; they open over the world
       instead, and nothing behind them moves. The claim this case makes is
       unchanged and is the one that matters: whatever is on screen, it is on
       screen for exactly ONE pattern. */
    await tapSentence(NAMING);
    await whereFrom(NAMING);
    const one = [...layout.container.querySelectorAll(".jar-prov-room")];
    expect(one.length, "exactly one room of grounds is open").toBe(1);
    expect(
      (one[0].querySelector(".jar-prov-room-lead")?.textContent ?? "").startsWith(NAMING),
      "and it leads with the subject's own sentence",
    ).toBe(true);
    expect(one[0].querySelectorAll(".jar-prov-row").length, "the memories it was read from").toBe(3);

    /* it stays until it is dismissed — that is what "nothing moves behind it"
       buys, and the close is the only way out */
    await closeGrounds();
    expect(layout.container.querySelectorAll(".jar-prov-room").length).toBe(0);

    await tapSentence(PROOF);
    await whereFrom(PROOF);
    const two = [...layout.container.querySelectorAll(".jar-prov-room")];
    expect(two.length, "still exactly one — the sky does not accumulate evidence").toBe(1);
    expect(
      (two[0].querySelector(".jar-prov-room-lead")?.textContent ?? "").startsWith(PROOF),
    ).toBe(true);
    expect(two[0].querySelectorAll(".jar-prov-row").length).toBe(2);
    await closeGrounds();
  });

  /**
   * Tapping the bare sky gives the subject back, and its evidence stops
   * answering the pointer.
   *
   * THE RETRACTION ITSELF IS NOT WHAT THIS SEES, and the earlier wording here
   * claimed it was. `satAt` opens with `const n = sky.focusNeb; if (!n) return
   * null` — so the moment the subject is let go, nothing answers as a
   * satellite whatever the satellites are doing. An empty sweep afterwards is
   * therefore a second reading of "there is no subject", not an independent
   * reading of "the orbit went back into the sentence". The `em` ease that
   * performs the retraction is a number inside the loop, drawn only on a
   * canvas that draws nothing here, and this file cannot see it.
   *
   * The two assertions are still worth having together: one says the cloud
   * came back down to rest, the other says nothing is left holding a satellite
   * selection open behind it. Neither says the orbit retracted.
   */
  it("lets the subject go when the sky itself is tapped, and its evidence stops answering", async () => {
    await climbToSky();
    const el = await tapSentence(PROPOSAL);
    expect([...orbitAround(el).keys()].length, "the evidence came out first").toBe(2);

    await tapEmptySky();
    expect(
      [...orbitAround(el).keys()],
      "with no subject, nothing in the sky answers the pointer as a satellite",
    ).toEqual([]);
    expect(growthOf(el), "and the cloud is back at rest").toBeCloseTo(1, 2);
  });
});

describe("a cloud keeps where you put it", () => {
  /**
   * Dragging a candidate pins it and writes the spot down, so it comes back
   * there next session. Two things are checked and both had a bug behind them:
   *
   *   - the spot written is where the POINTER ended, not where a lagged lerp
   *     had got to. That lag was forty pixels at a normal drag speed, on the
   *     gesture that performs this product's central act of meaning-making.
   *   - only the cloud that was actually placed is written down. `persistSky`
   *     skips anything unpinned on purpose: a sky that wrote every candidate's
   *     drifting position would restore an arrangement nobody made.
   *
   * The stored coordinates are relative to the wall, not to the layout — a new
   * agent arriving shifts every column — so the expectation converts back
   * through the camera the same way the engine does.
   */
  it("writes down the spot of the cloud you moved, and of no other", async () => {
    await climbToSky();
    const el = cloud(NAMING);
    const from = spotOf(el);
    const to = { x: from.x + 90, y: from.y - 60 };

    await pressOn(el, from.x, from.y);
    for (let i = 1; i <= 6; i += 1) {
      await act(async () => moveTo(from.x + (90 * i) / 6, from.y - (60 * i) / 6));
      /* a frame between moves: the drag is applied in the loop, and a gesture
         that never let a frame run would leave the cloud where it started */
      await layout.step(1);
    }
    /* THE DRAG HAS TO HAVE MOVED IT before anything about where it was kept
       can mean anything. Read before the lift: the moment the gesture ends the
       cloud is unpinned back into the ambient drift, which is a few pixels of
       honest motion that has nothing to do with what was written down. */
    expect(spotOf(el).x, "the cloud never went with the pointer").toBeCloseTo(to.x, 0);
    expect(spotOf(el).y).toBeCloseTo(to.y, 0);

    const camY = layout.audit().camY;
    await liftAt(to.x, to.y);

    const kept = JSON.parse(window.localStorage.getItem("waka.sky.layout.v1") ?? "null") as Record<
      string,
      { x: number; y: number }
    > | null;
    expect(kept, "nothing was written down at all — persistSky never ran").not.toBeNull();
    expect(Object.keys(kept ?? {}), "only the cloud that was placed is kept").toEqual([
      SIGNALS[0].id,
    ]);
    /* the camera is the only thing between a screen position and a stored one:
       this is column zero, so the wall offset is nothing and the camera is all
       of it. Two pixels of slack covers the rounding at both ends. */
    expect(Math.abs(kept![SIGNALS[0].id].x - to.x), "kept where the pointer was").toBeLessThan(2);
    expect(Math.abs(kept![SIGNALS[0].id].y - (to.y + camY))).toBeLessThan(2);
  });
});

describe("reading a memory that is in orbit", () => {
  /**
   * A SATELLITE'S SELECTION IS NOT THE FIELD'S TO CLOSE.
   *
   * `springs` runs every frame while something is selected and closes a
   * reading whose orb has scrubbed out from under it. A satellite breaks that
   * assumption: the memory it stands for may live in a field this session has
   * never poured — another member's save, standing in a proposal's orbit — and
   * its ball is therefore inactive by construction. Without the one line at
   * the top of `springs` that steps aside for a satellite, the panel would be
   * torn down on the very next frame after it opened, and the reader would see
   * a flash.
   *
   * Sixty frames is a second of the loop running with the selection live, so
   * "it survived" is a real statement about every frame in between rather than
   * about the moment of the tap.
   */
  it("does not close a reading whose memory the field has never poured", async () => {
    await climbToSky();
    const el = await tapSentence(PROPOSAL);
    const orbit = orbitAround(el);
    const at = spotOf(el);
    const hana = orbit.get("Hana");
    expect(hana, "no satellite to read — the orbit never emerged").toBeTruthy();

    await pressOn(canvas(), at.x + hana!.dx, at.y + hana!.dy);
    await liftAt(at.x + hana!.dx, at.y + hana!.dy);
    /* Read before a single frame runs, because `springs` runs INSIDE a frame:
       this asserts the tap landed, and the check after the frames asserts the
       reading survived them. Rolled into one, a teardown on the very first
       frame would report itself as "the tap missed".

       `--in` rather than the panel element itself: a closing panel lingers in
       the DOM for 200ms of REAL time so it can fade, and this clock is not
       real — so "the element is still there" would be true either way, which
       is the shape of a case that passes by doing nothing. */
    expect(
      layout.container.querySelector(".jar-panel--in"),
      "tapping a satellite opens the memory it stands for",
    ).not.toBeNull();

    await layout.step(60);
    expect(
      layout.container.querySelector(".jar-panel--in"),
      "the reading was torn down by the field's own spring check",
    ).not.toBeNull();
  });

  /**
   * AND IT HOLDS STILL WHILE IT IS READ, THEN TURNS AGAIN.
   *
   * A held satellite parks under its panel exactly as a focused orb does, and
   * `releaseHolds` is what lets it go — the one line in it that no other
   * caller reaches, since every other hold belongs to a ball in the field.
   * Measured as the satellite's angle relative to its own cloud, because the
   * cloud drifts underneath it and an absolute position would move either way.
   *
   * The three legs are needed together. Free-then-held alone would pass on an
   * orbit that had simply stopped; held-then-free alone would pass on one that
   * had never held. What is asserted is that the hold begins and ENDS.
   */
  it("holds the satellite still while it is read, and lets it turn again after", async () => {
    await climbToSky();
    const el = await tapSentence(PROPOSAL);
    const start = orbitAround(el).get("Hana");
    expect(start, "no satellite to hold").toBeTruthy();

    await layout.step(120);
    const drifted = orbitAround(el).get("Hana")!;
    expect(apart(start!, drifted), "a free satellite goes on turning").toBeGreaterThan(30);

    const on = spotOf(el);
    await pressOn(canvas(), on.x + drifted.dx, on.y + drifted.dy);
    await liftAt(on.x + drifted.dx, on.y + drifted.dy);
    await layout.step(10);
    const held0 = orbitAround(el).get("Hana")!;
    await layout.step(120);
    const held1 = orbitAround(el).get("Hana")!;
    expect(apart(held0, held1), "the one being read holds still under its panel").toBeLessThan(12);

    /* tapping it again is the release: the same hit test, the same satellite */
    const off = spotOf(el);
    await pressOn(canvas(), off.x + held1.dx, off.y + held1.dy);
    await liftAt(off.x + held1.dx, off.y + held1.dy);
    await layout.step(10);
    expect(layout.container.querySelector(".jar-panel--in"), "the reading closed").toBeNull();
    const free0 = orbitAround(el).get("Hana")!;
    await layout.step(120);
    const free1 = orbitAround(el).get("Hana")!;
    expect(
      apart(free0, free1),
      "letting go carries it on from where it stopped — a satellite left held never turns again",
    ).toBeGreaterThan(30);
  });
});

/* -------------------------------------------------------------- adoption's
   two clocks, which are not the same clock */

/**
 * How long the contraction takes. This is the sky's own `CONDENSE_MS`, stated
 * again here rather than imported, because what the cases below actually need
 * is a number of HARNESS FRAMES, and importing the constant would still leave
 * that conversion to be written by hand. Restating it is safe in the one way
 * that matters: if the real constant moves, the frame counts derived from this
 * one land on the wrong side of the contraction's own gates and the cases fail
 * loudly, rather than passing while measuring the wrong moment.
 */
const CONDENSE_MS = 700;

/** the harness advances the world 16.7ms per frame, so a duration is frames */
const framesFor = (ms: number) => Math.ceil(ms / 16.7);

/**
 * WAITING OUT ADOPTION'S HANDOVER, ON THE ONLY REAL CLOCK IN THIS FILE.
 *
 * Every ease in this world runs on the loop's clock, which `step` drives, and
 * that is why these tests are fast and exact. Adoption's last act is not one of
 * them: when the contraction has finished, a plain `window.setTimeout` hands
 * over — the candidate leaves the sky, the poster takes its words, the camera
 * glides down. That timer is wall-clock, so `step` cannot reach it, and faking
 * it would mean the suite no longer measured the ordering that ships. Seven
 * hundred milliseconds of real time, once per adoption, buys that.
 *
 * The frames afterwards are the sky settling into what it became: `syncSky`
 * drops the departed candidate and releases the subject, and the dim it was
 * holding everyone else at eases back out over the following frames.
 */
async function handover() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, CONDENSE_MS + 80));
  });
  await layout.step(60);
}

/** Is this candidate still standing overhead, and still lit? */
function litInSky(startsWith: string): boolean {
  const el = clouds().find((n) =>
    (n.querySelector(".jar-neb-text")?.textContent ?? "").startsWith(startsWith),
  );
  return el !== undefined && opacityOf(el) > 0.5;
}

/* ---------------------------------------------------------------- the cases */

describe("condensing", () => {
  /**
   * ADOPTION CONTRACTS THE CLOUD TO A CORE.
   *
   * `condense` is the sky's verb for it and `adopt` is its one caller. It is
   * driven here through the page's own dev instrument, which isolates the
   * engine's half: what the contraction does to a cloud, with nothing of the
   * page's own state changing underneath it. The two cases after this one
   * drive the same thing through the button, which is where the ordering
   * between the two lives and where it was once wrong.
   *
   * What is asserted is the contraction itself: past `condense` 0.5 the
   * sentence is no longer on screen (`syncDom` gates its opacity there,
   * because an invisible sentence must stop taking the pointer — its one child
   * is the least reversible control in the layout), and the cloud stops
   * answering a press. The other candidates are checked in the same breath, or
   * "everything vanished" would read as a pass.
   */
  it("contracts a condensed candidate past its core and out of reach", async () => {
    await climbToSky();
    const el = cloud(NAMING);
    expect(opacityOf(el), "it is on screen to begin with").toBeGreaterThan(0.5);

    const sim = (window as unknown as { wakaSim?: () => { condense: (id: string) => void } | null })
      .wakaSim;
    if (!sim) throw new Error("window.wakaSim is absent — the loop never published its verbs");
    await act(async () => sim()!.condense(SIGNALS[0].id));
    await layout.step(60); /* CONDENSE_MS is 700 */

    expect(opacityOf(el), "the cloud contracted to a core and left the screen").toBe(0);
    expect(el.style.pointerEvents, "and stopped taking the pointer with it").toBe("none");
    for (const other of [cloud(PROOF), cloud(PROPOSAL)])
      expect(opacityOf(other), "the rest of the sky is untouched").toBeGreaterThan(0.5);

    /* and a press on its words no longer makes it the subject: a condensing
       candidate is on its way out and answers nothing */
    await pressOn(el, spotOf(el).x, spotOf(el).y);
    await liftAt(spotOf(el).x, spotOf(el).y);
    await layout.step(30);
    expect(growthOf(el), "a candidate on its way out cannot be picked up").toBeCloseTo(1, 2);
  });

  /**
   * PRESSING ADOPT HAS TO SHOW THE CONTRACTION TO THE PERSON WHO PRESSED IT.
   *
   * The button is the only way anyone reaches adoption, and it was the half
   * that was broken. `adopt` called `condense(c.id)` and `setProposal(null)` in
   * the same commit, so the candidate left the list — and `syncSky` dropped its
   * cloud, and React unmounted its sentence — before a single frame of the
   * seven-hundred-millisecond contraction had run. Nothing contracted. The
   * cloud stopped existing, and the timer beside it then waited out an
   * animation nobody had been shown.
   *
   * That is a bug and not a blemish, under this codebase's own law that MOTION
   * EXPLAINS: the contraction is the sentence "this became yours", and a
   * proposal that pops out of existence says nothing at all, leaving the person
   * to work out from an empty sky whether the least reversible act in the
   * layout had actually happened.
   *
   * Three readings, in the order a person gets them:
   *
   *   1. ONE FRAME IN, the sentence is still overhead and still lit. This is
   *      the reading that was red — by here the element was already gone.
   *   2. MOST OF THE WAY THROUGH, it is still the page's own element and no
   *      longer on screen. `syncDom` gates the sentence's opacity at `condense`
   *      0.5, so an element that has passed through that gate is one the
   *      contraction genuinely ran on. A deleted candidate cannot produce this
   *      reading, and neither can a candidate that was never condensed.
   *   3. ONLY AFTER THE FULL 700ms does it leave.
   *
   * The rest of the sky is read at (2) as well, or "everything vanished" and
   * "the sky went dark" would both pass.
   */
  it("keeps the adopted candidate contracting overhead until the contraction ends", async () => {
    await climbToSky();
    expect(litInSky(PROPOSAL), "the proposal is overhead to begin with").toBe(true);

    const button = cloud(PROPOSAL).querySelector<HTMLElement>(".jar-neb-act");
    expect(button?.textContent, "the one action a proposal offers").toContain("Adopt");
    await act(async () => button!.click());

    await layout.step(1);
    expect(
      litInSky(PROPOSAL),
      "the adopted candidate left before one frame of its contraction had run",
    ).toBe(true);

    /* 85% of the way in: past the 0.5 gate with room to spare on both sides,
       so neither the easing curve's exact shape nor a frame's rounding decides
       the answer */
    await layout.step(framesFor(0.85 * CONDENSE_MS) - 1);
    const going = cloud(PROPOSAL);
    expect(opacityOf(going), "the contraction ran on the very cloud the button sits on").toBe(0);
    expect(
      going.style.pointerEvents,
      "and took the least reversible control in the layout out of reach with it",
    ).toBe("none");
    for (const other of [NAMING, PROOF])
      expect(litInSky(other), "and only that one — the rest of the sky is untouched").toBe(true);

    await handover();
    expect(
      clouds().some((n) => (n.querySelector(".jar-neb-text")?.textContent ?? "").startsWith(PROPOSAL)),
      "the contraction finished and the candidate is still overhead",
    ).toBe(false);
  });

  /**
   * AND WHAT IT LEAVES BEHIND IS A SKY THAT CAME BACK UP.
   *
   * The proposal is the only adoptable candidate, and affirming it carries it
   * out of the sky. The interesting half is what happens to the REST of the
   * sky: the proposal was the subject, so every other candidate was sunk at
   * the focus law's one tier — and a subject that has left still holds them
   * all down unless `syncSky` notices. That line ("a candidate that has left
   * the sky cannot be the subject of it") is what this checks, because a sky
   * permanently dimmed behind a candidate that no longer exists is a state
   * with no way out of it.
   *
   * The dimming now has to survive the whole contraction before it lifts, which
   * is right: the others stay sunk for as long as there is a subject standing
   * over them, and the subject is standing there until it has finished leaving.
   */
  it("carries an adopted proposal out of the sky and lifts what it was dimming", async () => {
    await climbToSky();
    await tapSentence(PROPOSAL);
    expect(opacityOf(cloud(NAMING)), "the sky is sunk behind the subject").toBeLessThan(0.5);

    const button = cloud(PROPOSAL).querySelector<HTMLElement>(".jar-neb-act");
    expect(button?.textContent, "the one action a proposal offers").toContain("Adopt");
    await act(async () => button!.click());
    await handover();

    expect(
      clouds().some((n) => (n.querySelector(".jar-neb-text")?.textContent ?? "").startsWith(PROPOSAL)),
      "the adopted proposal is no longer a candidate overhead",
    ).toBe(false);

    /* AND THE ANSWER IS READ FROM THE SKY, BECAUSE THAT IS WHERE IT MATTERS.
       Adoption's handover glides the camera back down to headquarters — the
       poster has the words now, and there is nothing left overhead to look
       at. From down there the sky's statements lean toward the top edge and
       their words go to nothing, deliberately: light crosses the seam, prose
       does not, and a sentence sliced by the viewport under the chrome is
       overflow rather than an invitation.

       So this used to read `opacity` at headquarters and got what the CAMERA
       was saying rather than what the DIM was. The state it guards — a sky
       stuck sunk behind a candidate that no longer exists, with no way out of
       it — is a state you would only ever meet by going back up. So it goes
       back up. */
    await climbToSky();
    for (const opening of [NAMING, PROOF])
      expect(
        opacityOf(cloud(opening)),
        "the sky came back up when the subject left — otherwise it is dimmed behind nothing",
      ).toBeGreaterThan(0.9);
  });
});

/**
 * SAYING IT BETTER — the act that turns the machine's reading into your line.
 *
 * Editing is one gesture on three layers and it had exactly one test, on the
 * poster's entry. That was measured rather than assumed: throwing from inside
 * the `memory` and the `signal` branches of `keep()` left the whole suite
 * green, so two thirds of the act was standing on nothing but the fact that
 * nobody had touched it lately.
 *
 * This closes the signal third, and it is the branch worth closing first
 * because the sky is where a person argues with what was said about them. It
 * drives the whole path — focus the cloud, open the words, type, keep — so it
 * fails if any one of them stops working, including the two silent freezes
 * `space/editing.ts` is shaped against: a `keep` that reads the draft it was
 * built with sends the machine's sentence back unchanged, and a `retype` that
 * writes onto that draft loses every keystroke. Both of those end here as a
 * sky still showing the old words.
 *
 * The value goes in through the prototype's own setter for the reason
 * `home-poster.test.tsx` gives at length: React tracks the last value it wrote
 * on the node, so a plain `.value =` leaves the tracker agreeing with the new
 * text and the change is read as a no-op.
 */
describe("changing a signal's words", () => {
  const MINE = "Naming is the argument I keep having.";

  it("puts the person's own sentence overhead, in place of the machine's", async () => {
    await climbToSky();
    const el = await tapSentence(NAMING);

    const acts = [...el.querySelectorAll<HTMLElement>(".jar-neb-ask button")];
    const better = acts.find((b) => /say it better/i.test(b.textContent ?? ""));
    if (!better) {
      throw new Error(
        `no "say it better" under the subject — saw ${JSON.stringify(
          acts.map((b) => (b.textContent ?? "").trim()),
        )}. It is offered only on your own wall, only on the candidate being ` +
          "read, and only before you have answered it.",
      );
    }
    await act(async () => better.click());

    const box = el.querySelector<HTMLTextAreaElement>("textarea.jar-reflect-box");
    if (!box) throw new Error("the edit box never opened — 'say it better' did nothing");
    expect(box.value, "the words open for changing are the ones on screen").toBe(
      SIGNALS[0].statement,
    );

    const nativeValue = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    if (!nativeValue) throw new Error("jsdom has no HTMLTextAreaElement value setter");
    await act(async () => {
      nativeValue.call(box, MINE);
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const keep = [...el.querySelectorAll<HTMLElement>(".jar-reflect button")].find((b) =>
      /keep these words/i.test(b.textContent ?? ""),
    );
    if (!keep) throw new Error("the edit box has no way to keep what was typed");
    await act(async () => keep.click());
    await layout.step(10);

    expect(
      clouds().map((n) => (n.querySelector(".jar-neb-text")?.textContent ?? "").trim()),
      "the rewrite never reached the sky — it is still showing the machine's sentence",
    ).toContain(MINE);
    expect(
      clouds().some((n) =>
        (n.querySelector(".jar-neb-text")?.textContent ?? "").startsWith(NAMING),
      ),
      "the sentence that was replaced is still overhead beside the one that replaced it",
    ).toBe(false);
  });
});

/**
 * CHANGING THE MEMORY UNDERNEATH IT — the third of the act, and the last one
 * no test reached.
 *
 * THE ROUTE CHANGED, AND THE ROUTE IS THE POINT. This used to walk down from
 * the sky: a signal's grounds listed the memories it was read from, and
 * pressing one flew the camera into the field and opened that memory. The
 * founder ruled that travel out ("never move from sky to ground") — reading
 * where a claim came from must not cost you the place you were reading it —
 * so there is no longer a way from a statement to its memory's panel, and
 * this case walks the only route a person has: down into the field, and a tap
 * on the orb itself.
 *
 * The panel's verbs are one flat row now — reflect, edit, delete — so this
 * walks straight to `edit`. They used to sit behind a quiet `more`, and this
 * case is the reason that indirection was worth removing: the shortest route
 * to changing the words under a signal ran through a word nobody expected to
 * have to press.
 */
describe("changing a memory's words", () => {
  const MINE = "What I actually meant was the naming.";

  it("keeps the person's own text on the memory the sky was read from", async () => {
    await layout.toField();
    /* A REAL TAP ON A REAL ORB. There is no coordinate in the audit and there
       should not be one — the field is drawn, and where a memory sits is the
       loop's business. So this does what a person does: presses points across
       the band the audit says the field was solved into, and stops at the
       first one that opens something. A scan that found nothing is a failure
       with a sentence, never a silent skip. */
    const panel = await tapAnOrb();

    /* `change the words` was renamed to `edit` when the picture moved inside
       it; this test is about what editing DOES, so it follows the label. */
    const change = [...panel.querySelectorAll<HTMLElement>(".jar-neb-ask button")].find(
      (b) => (b.textContent ?? "").trim().toLowerCase() === "edit",
    );
    if (!change) throw new Error("the panel offers no way to edit the memory");
    await act(async () => change.click());

    const box = panel.querySelector<HTMLTextAreaElement>("textarea.jar-reflect-box");
    if (!box) throw new Error("the edit box never opened — 'change the words' did nothing");
    const nativeValue = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    if (!nativeValue) throw new Error("jsdom has no HTMLTextAreaElement value setter");
    await act(async () => {
      nativeValue.call(box, MINE);
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const keep = [...panel.querySelectorAll<HTMLElement>(".jar-reflect button")].find((b) =>
      /keep the change/i.test(b.textContent ?? ""),
    );
    if (!keep) throw new Error("the edit box has no way to keep what was typed");
    await act(async () => keep.click());
    await layout.step(10);

    expect(
      KEPT.calls,
      "the changed words never reached the archive — the memory branch of `keep` did not run",
    ).toEqual([{ id: "own-0", text: MINE }]);
    expect(
      layout.container.querySelector(".jar-panel--in"),
      "a kept memory closes its panel: the words on screen are no longer the words behind them",
    ).toBeNull();
  });
});

describe("a verdict leaves a receipt", () => {
  /**
   * goal: the-legible-loop, Phase 2. An answer must say what it taught the
   * loop, at the place the answer happened, in the registry's exact words —
   * and the registry (`lib/receipts.ts`) pins each claim to the API test
   * that enforces it, so this case closes the loop from click to law.
   */
  it("prints the not-true receipt under the answered statement", async () => {
    await climbToSky();
    const el = await tapSentence(NAMING);

    const acts = [...el.querySelectorAll<HTMLElement>(".jar-neb-ask button")];
    const no = acts.find((b) => (b.textContent ?? "").trim() === "not true");
    if (!no) throw new Error("no 'not true' under the subject");
    await act(async () => no.click());

    const receipt = el.querySelector(".jar-receipt");
    expect(
      receipt?.textContent,
      "the answer left no receipt — the gesture taught silently",
    ).toBe(RECEIPTS.verdictNo.text);
    /* the law binds the chrome, not the person's own words — a memory may
       carry digits, the receipt may not */
    expect(/\d/.test(receipt?.textContent ?? ""), "a numeral rode in with the receipt").toBe(
      false,
    );
  });

  /**
   * goal: the-legible-loop, Phase 3. Letting a pattern go must say the
   * ground-level law it just enacted — the registry's words, whose claim
   * `signal-suppression.db.test.ts` enforces on the real pipeline — and must
   * carry its own undo in the same breath, because reversible is part of
   * the law being stated. Nothing here asserts disappearance: nothing
   * disappears.
   */
  it("prints the refused-ground receipt with its undo when a pattern is let go", async () => {
    await climbToSky();
    const el = await tapSentence(NAMING);

    const no = [...el.querySelectorAll<HTMLElement>(".jar-neb-ask button")].find(
      (b) => (b.textContent ?? "").trim() === "not true",
    );
    if (!no) throw new Error("no 'not true' under the subject");
    await act(async () => no.click());

    const letGo = [...el.querySelectorAll<HTMLElement>(".jar-neb-ask button")].find(
      (b) => (b.textContent ?? "").trim() === "then let it go",
    );
    if (!letGo) throw new Error("saying not-true did not offer the letting-go");
    await act(async () => letGo.click());

    const receipts = [...el.querySelectorAll<HTMLElement>(".jar-receipt")].map(
      (r) => r.textContent ?? "",
    );
    expect(
      receipts,
      "letting go left no ground receipt — the law enacted silently",
    ).toContain(RECEIPTS.groundRefuses.text);

    const undo = [...el.querySelectorAll<HTMLElement>(".jar-neb-ask button")].find(
      (b) => (b.textContent ?? "").trim() === "put it back",
    );
    expect(undo, "the receipt arrived without its undo").toBeTruthy();
  });
});

describe("the star travels with the sentence", () => {
  /**
   * goal: no-quiet-corners, Phase 8. A locked statement is the owner's own
   * words, and the lock used to be invisible exactly where other people
   * read the sentence — the room's wall. The wall payload now carries
   * `locked`, the wall candidate carries it into the sky, and the star
   * renders on the cloud at the room's column.
   */
  it("renders the star on a locked statement over the room's wall", async () => {
    const el = cloud("The room holds my own words");
    expect(
      el.querySelector(".jar-star"),
      "the owner's star must render where the room reads the sentence",
    ).not.toBeNull();
  });
});

describe("reading a pattern lights its memories where they live", () => {
  /**
   * Founder, 2026-08-24: "don't like this orbiting thing." Reading one of
   * your own patterns used to set its memories spinning around the sentence
   * — a SECOND place for something that already has one, while the field
   * below held the first. The world's whole argument is that a memory has a
   * location and keeps it.
   *
   * So a pattern of your own now speaks to the ground instead, in the very
   * sentence a search speaks: this one, and everything else sinks. What
   * still orbits is evidence with no home down there — the people standing
   * behind a room's statement, whom a room may never trade for their
   * memories. The four orbit cases above are all about those, which is why
   * they are untouched by this.
   *
   * `NAMING` cites three of the six memories in these facts, so the split is
   * the assertion: three lit, three sunk, and nobody had to count them.
   */
  it("lights exactly what it was read from, and sinks the rest", async () => {
    await climbToSky();
    const before = layout.audit().drawn;
    expect(before.glowing, "nothing is picked out before a pattern is read").toBe(0);
    expect(before.dimmed, "and nothing has sunk").toBe(0);

    await tapSentence(NAMING);
    /* the chain is one request deep — the light follows it when it lands */
    await layout.step(30);

    const lit = layout.audit().drawn;
    expect(lit.glowing, "the memories this pattern was read from").toBe(3);
    expect(lit.dimmed, "and the ones it was not").toBe(3);

    await tapEmptySky();
    await layout.step(30);
    const after = layout.audit().drawn;
    expect(after.glowing, "letting the pattern go gives the field back").toBe(0);
    expect(after.dimmed).toBe(0);
  });
});
