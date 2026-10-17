// @vitest-environment jsdom

/**
 * A MEMORY, OPENED AND ANSWERED — layer 1, through the only route there is.
 *
 * This file was `home-sky.test.tsx` and watched a place that no longer exists.
 * The sky — a viewport above headquarters holding every signal still forming,
 * its clouds, its satellites and its verbs — was removed on 2026-08-25, so its
 * nine describes went with it. Two survived, and they survived because they
 * were never really about the sky: they are about what you can do to a MEMORY
 * once it is open.
 *
 * THE ROUTE IS THE POINT. Both cases used to walk down from a statement: a
 * signal listed the memories it was read from, and pressing one flew the
 * camera into the field and opened that memory. The founder ruled that travel
 * out before the sky itself went. So these walk the only route a person has —
 * down into the field, and a tap on the orb — and `openMemory` presses across
 * the band the audit reports until the named one answers. No coordinate is
 * exported to make that easier: where a memory sits is the loop's business.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6).
 *
 * `lib/data` and `lib/api` — the three layers arrive as fixtures rather than
 * over HTTP, because every claim here is about what the layout DOES with a
 * memory, not about how it was fetched. Both are replaced through the shared
 * builders in `helpers/render-home`, so this suite and the field's describe
 * the same world rather than two worlds that happen to agree.
 * `deleteInspiration` is stubbed to SUCCEED, and that is load-bearing rather
 * than incidental: the real one reaches a server jsdom has not got, and a
 * rejected delete is a DIFFERENT state wearing a different sentence, which is
 * precisely the confusion the delete cases exist to refuse.
 *
 * `lib/auth-context` — a signed-in viewer, because the world renders nothing
 * at all without one and the alternative is driving a login form to reach a
 * claim about a reading panel.
 *
 * `helpers/canvas-stub` — jsdom has no 2D context, and the field is drawn.
 * Nothing here reads a pixel: the stub exists so the loop can run, and every
 * assertion goes through the audit or the DOM.
 *
 * `helpers/render-home` — the mount, the clock and the frame loop. Time
 * advances only when a case says so, which is what makes "let the travel
 * finish" an exact statement rather than a sleep long enough to usually work.
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
    /* `own-0` is public AND cited: the one memory where taking it private
       costs a room its ground, which is what the un-publishing ask is for */
    isPublic: i === 0,
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
 * viewer's own wall. Those extra columns are still built and still
 * fetched — the fixture describes the WHOLE world, not one wall — and
 * nothing below identifies anything by position.
 */
vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return {
    ...actual,
    ...apiMockFrom(FACTS),
    /* THE DELETE HAS TO SUCCEED FOR THE SILENT PATH TO BE OBSERVABLE. The real
       one reaches a server jsdom has not got, so it rejects — and a rejected
       delete is a DIFFERENT state wearing a different sentence, which is
       precisely the confusion the cases below exist to refuse. */
    deleteInspiration: async () => undefined,
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
    /* The write behind "Keep these words". Its RESULT is discarded by the page
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
    /* The writes behind "then let it go" and "Put it back". The page reads
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
    inspirationIds:s.cites,
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
    /* ONE MEMORY BY ITS ADDRESS. With the orbs gone (2026-10-15) the card
       opens from `/inspirations/:id`, which reads the memory itself rather
       than finding it on the ground, so the fixture answers that read too. */
    loadInspiration: async (id: string) => {
      const kept = FACTS.inspirations.find((x) => x.id === id);
      if (!kept) throw new Error(`no such memory ${id}`);
      const at = BASE - kept.daysAgo * DAY;
      return {
        id: kept.id, preview: kept.text, text: kept.text, isPublic: kept.isPublic, kind: "note", source: "app",
        category: null, capturedMs: at, updatedMs: at, attachments: [], reflectionCount: 0,
        conversationOrigin: null, reflections: [], enrichment: [],
      };
    },
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
 * OPEN A MEMORY BY ITS ADDRESS.
 *
 * These helpers used to press across the field until an orb answered. The
 * orbs are gone (founder, 2026-10-15: "these balls for inspirations being
 * saved should FULLY BE DELETED and removed"), so nothing on the ground
 * can be pressed. The card these cases are about now opens from a search
 * result or a link, both of which go through the memory's address.
 */
async function openFromArchive(match: (text: string) => boolean, what: string): Promise<HTMLElement> {
  /* By its address, which is what a search result and a shared link do:
     `/inspirations/:id` opens the memory's card over the world. */
  const memory = FACTS.inspirations.find((row) => match(row.text));
  if (!memory) throw new Error(`no memory in the fixture for ${what}`);
  layout.unmount();
  layout = await mountWorld(FACTS, { initialEntries: [`/inspirations/${memory.id}`] });
  /* The address is applied by a loop that waits on timers between its
     stages (the wall, the section, the read), so frames alone never finish
     it: real time passes between them, up to a bound. */
  for (let turn = 0; turn < 40; turn += 1) {
    await layout.step(10);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 90)); });
    const open = layout.container.querySelector<HTMLElement>(".jar-panel--in");
    if (open) {
      await layout.step(12);
      return open;
    }
  }
  throw new Error(`the address of ${what} opened no memory`);
}

/** Any memory will do. */
const tapAnOrb = (): Promise<HTMLElement> => openFromArchive(() => true, "any memory");

/** A NAMED memory: `own-0` through `own-4` are cited by the two signals
    overhead and `own-5` is cited by nothing, and that difference is the
    whole subject of the cases that use this. */
const openMemory = (text: string): Promise<HTMLElement> => openFromArchive((said) => said.startsWith(text), `"${text}"`);

/** The verbs under an open memory, pressed by name. */
async function pressPanelVerb(panel: HTMLElement, name: string): Promise<void> {
  const verb = [...panel.querySelectorAll<HTMLElement>(".jar-ask--after button")].find(
    (b) => (b.textContent ?? "").trim() === name,
  );
  if (!verb) {
    const seen = [...panel.querySelectorAll(".jar-ask--after button")].map((b) =>
      (b.textContent ?? "").trim(),
    );
    throw new Error(`no "${name}" under the memory — saw ${JSON.stringify(seen)}`);
  }
  await act(async () => verb.click());
  await layout.step(8);
}

const apart = (a: { dx: number; dy: number }, b: { dx: number; dy: number }) =>
  Math.hypot(a.dx - b.dx, a.dy - b.dy);

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
 * AND THERE IS NO EDIT VERB ANY MORE. The words themselves are the field: an
 * `edit` button used to open a SECOND box under the memory holding a copy of
 * the same text, so the panel showed the words twice and asked the reader to
 * find their place again (founder, 2026-08-25). Pressing the paragraph opens
 * a caret in it, which is what this case now does.
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

    /* THE WORDS ARE THE CONTROL. Pressing the paragraph is the whole gesture —
       if this ever needs a button again, that is the regression. */
    const words = panel.querySelector<HTMLElement>(".jar-panel-text");
    if (!words) throw new Error("the panel is not showing the memory at all");
    expect(
      words.className,
      "your own memory says it can be typed into, before you press it",
    ).toContain("jar-panel-text--yours");
    await act(async () => words.click());

    const box = panel.querySelector<HTMLTextAreaElement>("textarea.jar-panel-edit");
    if (!box) throw new Error("pressing the memory's own words opened no caret");
    expect(
      panel.querySelectorAll(".jar-panel-text").length,
      "the words are shown ONCE — the field replaces the paragraph, never joins it",
    ).toBe(1);
    const nativeValue = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    if (!nativeValue) throw new Error("jsdom has no HTMLTextAreaElement value setter");
    await act(async () => {
      nativeValue.call(box, MINE);
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });

    /* THE ROW DOES NOT MOVE OR GROW WHEN THE WORDS OPEN — it changes what it
       offers, in the same place and the same face, because what you are doing
       has changed. Founder, 2026-08-25: "when user edits sth, replace the
       center left right arrow icon with save button." So the middle cell,
       which holds the two ways on while you are reading, holds the one act
       while you are typing — the same pixels, a different offer. */
    const middle = panel.querySelector<HTMLElement>(".jar-panel-foot-c");
    if (!middle) throw new Error("the open words have no middle cell at all");
    expect(
      middle.querySelectorAll(".jar-caret").length,
      "the ways on are not offered while the words are open — that slot is the act now",
    ).toBe(0);
    const keep = [...middle.querySelectorAll<HTMLElement>("button")].find((b) =>
      /^save$/i.test((b.textContent ?? "").trim()),
    );
    if (!keep) throw new Error("the open words offer no way to keep what was typed");
    expect(
      [...panel.querySelectorAll(".jar-ask--after button")].map((b) =>
        (b.textContent ?? "").trim(),
      ),
      "and while the words are open the row is about the words, not about the memory",
    ).not.toContain("Delete");
    await act(async () => keep.click());
    await layout.step(10);

    expect(
      KEPT.calls,
      "the changed words never reached the archive — the memory branch of `keep` did not run",
    ).toEqual([{ id: "own-0", text: MINE }]);
    /* THE CARD STAYS OPEN — the reverse of what this asserted until
       2026-08-27. It used to demand the panel close on a kept edit, and the
       founder overruled that twice in one day: once as a request ("just keep
       it opened") and once as a bug report when a leftover deselect on the
       success path closed it anyway. You kept the words; you are still
       reading them. The card leaves when you send it away. */
    expect(
      layout.container.querySelector(".jar-panel--in"),
      "a kept memory keeps its card open — closing it was overruled",
    ).not.toBeNull();
    expect(
      layout.container.querySelector(".jar-panel-save")?.textContent,
      "and the foot says what just happened",
    ).toBe("Saved");
  });

  /* TWO EDITS IN A ROW, AND THE FIRST SURVIVES THE SECOND (review,
     2026-10-17). A kept edit cleared the detail cache but left the open card
     holding its pre-edit words — and those are what the next edit is seeded
     from, so the second edit began from the first one's BEFORE and its save
     wrote the old words back. */
  it("seeds a second edit from the first one's words, so both survive", { timeout: 30_000 }, async () => {
    const MORE = `${MINE} And the order things arrive in.`;
    await layout.toField();
    const panel = await tapAnOrb();
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    const editTo = async (text: string) => {
      await act(async () => panel.querySelector<HTMLElement>(".jar-panel-text")!.click());
      const box = panel.querySelector<HTMLTextAreaElement>("textarea.jar-panel-edit");
      if (!box) throw new Error("pressing the memory's words opened no caret");
      const seeded = box.value;
      await act(async () => { setValue.call(box, text); box.dispatchEvent(new Event("input", { bubbles: true })); });
      const keep = [...panel.querySelectorAll<HTMLElement>(".jar-panel-foot-c button")].find((b) => /^save$/i.test((b.textContent ?? "").trim()))!;
      await act(async () => keep.click());
      await layout.step(10);
      /* out of the `saved` beat, back to the reading face */
      await act(async () => { box.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
      await layout.step(4);
      return seeded;
    };
    await editTo(MINE);
    const seededSecond = await editTo(MORE);
    expect(seededSecond, "the second edit opens on the words the first one kept").toBe(MINE);
    expect(KEPT.calls.map((call) => call.text)).toEqual([MINE, MORE]);
    expect(panel.querySelector(".jar-panel-text")?.textContent).toContain("the order things arrive in");
  });
});


/**
 * WHAT DELETING A MEMORY COSTS, ASKED ONLY WHEN IT COSTS SOMETHING.
 *
 * Every delete used to open the same warning, including for a memory nothing
 * had ever been read from — a sentence about consequences where there were
 * none, which is friction wearing a safety costume and teaches a person to
 * dismiss the warning that matters (founder, 2026-08-25: "delete it without
 * warning if inspiration is not powering a signal. if it does, then show a new
 * modal to explain the situation").
 *
 * The fixture makes the distinction real rather than mocked: the two signals
 * overhead cite `own-0` through `own-4`, and `own-5` is cited by nothing. So
 * the same verb, pressed on two memories that differ in exactly one fact,
 * must do two different things.
 */
describe("deleting a memory", () => {
  it("goes without a word when no signal was ever read from it", { timeout: 30_000 }, async () => {
    await layout.toField();
    const panel = await openMemory("something I kept, 5");
    await pressPanelVerb(panel, "Delete");
    await layout.step(20);

    expect(
      layout.container.querySelector(".jar-panel-askrow"),
      "nothing stands on this memory, so there is nothing to warn about",
    ).toBeNull();
    /* long enough for the request to settle and the panel to finish leaving —
       it fades rather than vanishing, like everything else here */
    await act(async () => {
      await Promise.resolve();
    });
    await layout.step(40);
    expect(
      layout.container.querySelector(".jar-panel--in"),
      "and the memory is simply gone",
    ).toBeNull();
    expect(
      (layout.container.textContent ?? "").includes("didn’t go through"),
      "and nothing claimed it failed",
    ).toBe(false);
  });

  it("says what is lost when a signal stands on it, and only then", { timeout: 30_000 }, async () => {
    await layout.toField();
    const panel = await openMemory("something I kept, 0");
    await pressPanelVerb(panel, "Delete");
    await layout.step(20);

    const ask = layout.container.querySelector(".jar-panel-askrow");
    expect(ask, "a signal was read from this one — that is worth a sentence").not.toBeNull();
    /* ON the card, never OVER it (founder, 2026-08-27: "dont do hover card
       on a hover card") — the question stands in the card's own foot, so
       nothing covers the words being decided about */
    expect(
      layout.container.querySelector(".jar-panel")?.contains(ask!),
      "the ask is the card's own state, not a second surface",
    ).toBe(true);
    /* the sentence has to say what actually happens: the signal SURVIVES and
       loses its ground. A warning that implied the signal went with it would
       be false, and false in the direction that stops people deleting. */
    const said = (ask?.textContent ?? "").toLowerCase();
    expect(said).toContain("does not unlearn");
    expect(said).toContain("loses this ground");

    /* the lit answer is keeping it: this is a door that would rather not be
       walked through */
    const keep = [...(ask?.querySelectorAll<HTMLElement>("button") ?? [])].find(
      (b) => (b.textContent ?? "").trim() === "Keep it",
    );
    expect(keep?.className, "keeping is the lit half of the pair").toContain("jar-where-on");
    await act(async () => keep!.click());
    await layout.step(10);
    expect(
      layout.container.querySelector(".jar-panel-askrow"),
      "and saying keep it puts the question away",
    ).toBeNull();
  });

  /* ═══ `says the same thing when a public memory is taken private` ═══════
     GONE WITH THE CONTROL IT PRESSED (founder, 2026-10-12: remove the
     memory's private/public toggle, with rooms).

     It was the mirror of the delete ask, and the founder had asked for it by
     name (2026-08-27: "similar warning should occur when changing what was
     public to private as well"). The argument was exact: un-publishing
     deletes nothing, but for a pattern that was read from this memory WHILE
     IT STOOD IN A ROOM, the ground goes just the same — so the fact deserved
     the same sentence in the same place, in the card's own state rather than
     in a sheet over it, with "keep it public" as the lit half.

     WHAT STILL COVERS THE RULE IT WAS REALLY ABOUT: the case above this one.
     Deleting a memory a pattern stands on still asks, still asks IN THE
     CARD, and still says what the pattern loses. The ask is not gone — the
     second way of reaching it is. */
});

/**
 * READING ON, WITHOUT PUTTING THE CARD DOWN.
 *
 * Reading a second memory used to mean closing the first, finding another orb
 * in a field that had just re-lit, and tapping it — three gestures and a
 * search to do the most ordinary thing there is (founder, 2026-08-25: "add
 * option to move between inspirations from the card itself").
 *
 * The fixture's six memories are `own-0` through `own-5` at `daysAgo: i + 1`,
 * so `own-5` is the OLDEST and `own-0` the newest — the index counts backwards
 * from today, which is worth saying out loud because reading it the other way
 * is how the first version of this case "failed" against a working product.
 * The order is therefore known and so are the ends: the oldest has nothing
 * before it, the newest nothing after, and each end loses that half of the row
 * rather than wrapping. Wrapping would make "the oldest" impossible to feel.
 */
describe("stepping between memories", () => {
  it("walks the ground's own order, and stops at both ends", { timeout: 30_000 }, async () => {
    await layout.toField();
    const panel = await openMemory("something I kept, 5");

    const said = () =>
      (
        layout.container.querySelector(".jar-panel--in .jar-panel-text")?.textContent ?? ""
      ).trim();
    const step = async (label: RegExp) => {
      const el = [
        ...layout.container.querySelectorAll<HTMLElement>(".jar-panel-foot-c button"),
      ].find((b) => label.test(b.getAttribute("aria-label") ?? ""));
      if (!el) return false;
      await act(async () => el.click());
      await layout.step(30);
      return true;
    };

    expect(said(), "opened on the oldest").toBe("something I kept, 5");
    expect(
      await step(/before this one/),
      "the oldest memory offers no way further back — the end of an archive is real",
    ).toBe(false);

    expect(await step(/after this one/), "and it does offer the one after").toBe(true);
    expect(said(), "which is the next one the ground was given").toBe("something I kept, 4");

    expect(
      layout.container.querySelectorAll(".jar-panel--in").length,
      "the card never closed — that is the whole point of stepping from it",
    ).toBe(1);

    await step(/before this one/);
    expect(said(), "and back again lands where it started").toBe("something I kept, 5");

    /* walk to the far end and check the other stop */
    for (let i = 0; i < 5; i += 1) await step(/after this one/);
    expect(said(), "five steps forward from the oldest reaches the newest").toBe(
      "something I kept, 0",
    );
    expect(
      await step(/after this one/),
      "and the newest offers no way further on",
    ).toBe(false);
  });

  it("closes an open edit rather than carrying it to another memory", { timeout: 30_000 }, async () => {
    await layout.toField();
    const panel = await openMemory("something I kept, 2");

    const words = panel.querySelector<HTMLElement>(".jar-panel-text");
    if (!words) throw new Error("the memory is not on screen");
    await act(async () => words.click());
    expect(
      layout.container.querySelector("textarea.jar-panel-edit"),
      "the words are open",
    ).not.toBeNull();

    /* OPENED OUT OF THE FIELD, WHICH IS NOW THE ONLY WAY. This pressed the
       `after this one` caret until 2026-08-25, when the founder ruled that the
       middle of the footer becomes `save` while you type — so the carets are
       not there to press during an edit, and the field is what remains.
       `stepToMemory` was the one route that abandoned the words, so removing
       the carets from the edit left the remaining route carrying a caret onto
       a card it did not belong to: one memory's words over another's date and
       verbs, still writing to the one you had left. */
    await openMemory("something I kept, 1");
    await layout.step(30);

    /* THE RULE THIS PROTECTS IS CORRECTNESS, NOT TIDINESS. A caret left open
       over the memory you have just left is a caret typing into the wrong
       one. */
    expect(
      layout.container.querySelector("textarea.jar-panel-edit"),
      "the caret did not travel to the memory opened next",
    ).toBeNull();
    /* AND THE COST IS THE FOOTER, WHICH IS WHY THE CARET ALONE IS NOT THE
       TEST. Both the field and the editing footer are gated on the open
       edit's id matching the card, so the words could never appear over the
       wrong memory. The READING footer is gated on there being no open edit at
       all — so an edit merely LEFT BEHIND on a card you can no longer see
       renders the next card with neither footer: no reflect, no ways on, no
       delete. Asserting the caret is gone passes with that bug live. */
    const foot = layout.container.querySelector(".jar-panel--in .jar-panel-foot");
    expect(
      foot,
      "the memory opened next has its footer — an edit left behind on the last " +
        "card must not strip this one of everything it offers",
    ).not.toBeNull();
    /* `Delete`, WHERE THIS ASSERTED `Reflect` (2026-10-10). The marker had to
       change because the verb did: the footer's left cell offered `Reflect` on
       a save with no answers, which opened the writing flow the founder
       folded — it now offers `Read reflection` only when there is an answer to
       read, and this memory has none, so that cell is empty by design.
       `Delete` is the better marker anyway and was the one to reach for first:
       it exists ONLY on the reading footer (the editing footer offers Add a
       picture / Save / Leave it), so it still distinguishes the two footers,
       and unlike `Reflect` it does not depend on what the memory happens to
       carry. The property under test is unchanged — an edit left behind on a
       card you can no longer see must not strip the next card of everything
       it offers. */
    expect(
      [...(foot?.querySelectorAll("button") ?? [])].map((b) => (b.textContent ?? "").trim()),
      "and it is the reading footer, not the one that belongs to an open edit",
    ).toContain("Delete");
    expect(
      (
        layout.container.querySelector(".jar-panel--in .jar-panel-text")?.textContent ?? ""
      ).trim(),
      "and the memory opened is the one on screen",
    ).toBe("something I kept, 1");
  });
});
