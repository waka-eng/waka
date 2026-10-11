/**
 * MOUNTING THE WORLD, WITH A DATABASE MADE OF FACTS THE TEST CHOSE.
 *
 * The page is one component that owns a canvas, a frame loop and about thirty
 * fetches. To assert anything about the ground it draws, all three have to be
 * real: the loop has to actually run, the fetches have to actually resolve,
 * and the viewport has to actually have a size.
 *
 * What this does NOT do is mock the simulation. The engine under test is the
 * shipped one — the same `useEffect`, the same layout, the same activation
 * rules. Only the world outside it (network, canvas, clock, viewport) is
 * replaced, because those are the parts a test cannot have.
 *
 * The audit is reached through `window.wakaField`, which the page publishes
 * whenever `showsDebug()` is true — that is `import.meta.env.DEV`, which
 * Vitest sets. So the test reads exactly the instrument a developer reads, and
 * an instrument that lies to one lies to the other.
 *
 * WHAT THIS HELPER REPLACES, so the suites that import it can say so (G6):
 * the canvas is `canvas-stub.ts`'s, the clock and `requestAnimationFrame` are
 * `installClock`'s, `Math.random` is `installRandom`'s, and the viewport is
 * whatever `setViewport` was told. Nothing else. In particular the simulation
 * is NOT replaced — the shipped `useEffect`, layout and activation rules run
 * here — and the three layers are not replaced from in here either: each suite
 * mocks `lib/data` itself, which is the seam G6 is about.
 *
 * `mountWorld` also refuses to hand back a world the dev fixture produced; see
 * `withFixtureAlarm` below for why that is a hard failure and not a warning.
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

import type { FieldAudit } from "../../src/pages/Home";

export interface WorldFacts {
  /** the viewer's own memories; `isPublic` marks the ones a room can read */
  inspirations: Array<{ id: string; text: string; daysAgo: number; isPublic?: boolean }>;
  /** groups the viewer belongs to, and whose memories stand in each */
  groups: Array<{
    id: string;
    name: string;
    field: Array<{ id: string; ownerProfileId: string; ownerName: string; daysAgo: number }>;
  }>;
}

export const VIEWER_ID = "profile-viewer";

/** what the group decided together — the lead entry of its board */
export const DECIDED = "We ask the owner when the spec and the code disagree.";

/**
 * MIDDAY, NOT MIDNIGHT. Every fixture moment is a whole number of days off
 * this, so the days themselves are unchanged — what changes is that a moment
 * now sits INSIDE its day rather than exactly on its edge.
 *
 * A fixture dated from midnight cannot tell the start of a day from the end
 * of one: `capturedMs <= startOfThatDay` and `capturedMs <= endOfThatDay` are
 * both true, so a dial that wound to the wrong edge of a day showed the
 * identical set and every count agreed with it. Found by sabotage, not by a
 * failure — `home-dial.test.tsx` was asked to catch exactly that bug and did
 * not. Midday also keeps every moment on the same calendar day in every
 * timezone this suite is likely to run in.
 */
const BASE = Date.UTC(2026, 7, 16, 12);
const at = (daysAgo: number) => BASE - daysAgo * 86_400_000;
const iso = (daysAgo: number) => new Date(at(daysAgo)).toISOString();

/**
 * THE SEAM IS `lib/data`, NOT `lib/api`.
 *
 * The page never calls the HTTP client directly for the three layers — it goes
 * through `loadInspirations` / `loadSignals` / `loadTopOfMind`, which paginate
 * and translate on the way. Mocking one layer lower means every one of those
 * translations runs against invented rows, and the first shape mismatch throws
 * inside the loader, which the page CATCHES and answers by replacing the whole
 * world with the dev fixture. The test then passes while describing a fixture.
 *
 * That is not hypothetical — it is what happened on the first attempt here, and
 * the only reason it was caught is that the fixture's wall is named "Course
 * marketing" and the audit reported memories belonging to nobody.
 *
 * Reading a name off the screen is not a net, though — it needs someone to be
 * looking. `withFixtureAlarm` below is the net, and it is what makes this
 * paragraph a rule rather than a hope.
 */
export function dataMockFrom(facts: WorldFacts) {
  return {
    /* A FIELD, NOT A LIST. `loadInspirations` answers with what arrived AND
       how much the archive holds, because past the walk's ceiling those are
       different numbers and the door has to be able to say so. A fixture is
       the whole of itself, so here they are equal and `short` is false. */
    loadInspirations: async () => {
      const inspirations = facts.inspirations.map((c) => ({
        id: c.id,
        preview: c.text,
        isPublic: c.isPublic ?? false,
        kind: "note" as const,
        source: "app" as const,
        capturedMs: at(c.daysAgo),
        updatedMs: at(c.daysAgo),
        attachments: [],
        reflectionCount: 0,
      }));
      return { inspirations, total: inspirations.length, short: false };
    },
    loadSignals: async () => [],
    loadTopOfMind: async () => null,
  };
}

/** The group reads still go through `lib/api`, so those are mocked there. */
export function apiMockFrom(facts: WorldFacts) {
  const none = async () => [];
  return {
    fetchGroups: async () =>
      facts.groups.map((g) => ({
        id: g.id,
        name: g.name,
        role: "owner",
        joinCode: null,
        createdAt: iso(60),
      })),
    fetchGroupField: async (groupId: string) => {
      const g = facts.groups.find((x) => x.id === groupId);
      const field = (g?.field ?? []).map((f) => ({
        id: f.id,
        text: `memory ${f.id}`,
        kind: "note",
        source: "app",
        createdAt: iso(f.daysAgo),
        updatedAt: iso(f.daysAgo),
        ownerProfileId: f.ownerProfileId,
        ownerName: f.ownerName,
        ownerType: "human",
      }));
      /* like the personal field above: what came, and what there is. A room in
         a fixture holds exactly what it hands over. */
      return { field, total: field.length };
    },
    fetchGroupMembers: async (groupId: string) => {
      const g = facts.groups.find((x) => x.id === groupId);
      const seen = new Map<string, string>();
      for (const f of g?.field ?? []) seen.set(f.ownerProfileId, f.ownerName);
      return [...seen].map(([profileId, name]) => ({
        id: `m-${profileId}`,
        profileId,
        name,
        type: "human",
        role: profileId === VIEWER_ID ? "owner" : "member",
        joinedAt: iso(30),
      }));
    },
    /**
     * A group that has decided something, and the shared signals that fed it.
     *
     * Both are needed together or provenance stays empty for an innocent
     * reason: the loop builds it by matching `evidence.citedBy` against the
     * lead entry's body, so a board with no entries and a wall with no
     * signals would give zero and prove nothing.
     */
    fetchGroupTopOfMind: async (groupId: string) => {
      const g = facts.groups.find((x) => x.id === groupId);
      if (!g || g.field.length === 0) return null;
      return {
        id: `tom-${groupId}`,
        groupId,
        entries: [
          {
            id: `entry-${groupId}`,
            body: DECIDED,
            pinnedAt: iso(1),
            createdAt: iso(1),
            contributors: [...new Set(g.field.map((f) => f.ownerProfileId))].map((profileId) => ({
              profileId,
              name: g.field.find((f) => f.ownerProfileId === profileId)?.ownerName ?? "",
            })),
          },
        ],
        createdAt: iso(1),
        updatedAt: iso(1),
      };
    },
    fetchGroupWall: async (groupId: string) => {
      const g = facts.groups.find((x) => x.id === groupId);
      /* the wall is ROOM-GROWN now (2026-08-24): one statement standing on
         every member as its contributors, which is also the smallest wall
         that satisfies the serve gate's two-voices rule */
      const contributors = [
        ...new Map(
          (g?.field ?? []).map((f) => [f.ownerProfileId, f.ownerName]),
        ).entries(),
      ].map(([profileId, name]) => ({ profileId, name }));
      return (g?.field ?? []).map((f, i) => ({
        signalId: `sig-${f.id}`,
        statement: `a statement the room grew near ${f.ownerName}`,
        confidenceAsWritten: 50,
        locked: false,
        contributors,
        sharedAt: iso(f.daysAgo + i),
        reactions: [],
      }));
    },
    fetchGroupProposals: none,
    fetchProfiles: none,
    fetchTopOfMindVersions: none,
  };
}

export interface MountedWorld {
  root: Root;
  container: HTMLDivElement;
  audit(): FieldAudit;
  /** advance the frame loop by roughly `frames` animation frames */
  step(frames?: number): Promise<void>;
  /** Re-render the same provider/router tree to exercise identity changes. */
  rerender(): Promise<void>;
  /** click a wall in the axis along the bottom and let the travel finish */
  travelTo(name: RegExp): Promise<void>;
  /**
   * Walk the camera down into the field.
   *
   * The ground and the control that switches it only exist while you are
   * standing in the field — at headquarters the audit is measuring a band the
   * camera is nowhere near. Every assertion about the ground has to come from
   * down here or it is describing the wrong place.
   */
  toField(): Promise<void>;
  /** click one of the "whose ground" rows */
  standIn(name: RegExp): Promise<void>;
  unmount(): void;
}

/**
 * The clock and the frame loop, driven by the test rather than by the host.
 *
 * The engine eases everything over wall-clock time, so a test that waited on
 * real timers would be slow and flaky in equal measure. Time advances only
 * when `step()` says so, which also makes "let the travel finish" an exact
 * statement rather than a sleep long enough to usually work.
 */
/**
 * A WORLD THAT IS THE SAME WORLD TWICE.
 *
 * Ball construction draws its drift amplitude and phase from `Math.random`, so
 * every run breathes differently and an orb near the band's edge is inside it
 * on one run and a pixel outside on the next. That produced a test which
 * passed alone and failed in the suite — the worst possible net, because a
 * failure nobody trusts gets re-run rather than read.
 *
 * Seeded here rather than in the product: the randomness is wanted in a real
 * world, where it is what stops forty orbs pulsing in unison. It is only the
 * test that needs the same world every time.
 */
function installRandom(seed = 0x2f6e2b1) {
  let state = seed >>> 0;
  Math.random = () => {
    /* xorshift32 — small, fast, and identical on every machine */
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1_000_000) / 1_000_000;
  };
}

function installClock() {
  let now = 0;
  const frames = new Map<number, FrameRequestCallback>();
  let next = 1;

  performance.now = () => now;
  Date.now = () => 1_786_924_800_000 + now;

  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    const id = next++;
    frames.set(id, cb);
    return id;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => {
    frames.delete(id);
  }) as typeof cancelAnimationFrame;

  return async function step(count = 1) {
    for (let i = 0; i < count; i += 1) {
      now += 16.7;
      const due = [...frames.entries()];
      frames.clear();
      await act(async () => {
        for (const [, cb] of due) cb(now);
      });
    }
  };
}

/**
 * The sentence `offlineHome()` says on its way past.
 *
 * Duplicated from `lib/fixture/offline-home.ts` rather than imported, because
 * importing it would mean this helper loading the fixture module in every run
 * that does not want it. If the wording ever changes, `fixture-says-so.test.ts`
 * asserts the same phrase and goes red, which is the pointer back to here.
 */
const FIXTURE_ALARM = "THE DEV FIXTURE IS ON SCREEN";

/**
 * THE ALARM, WIRED TO SOMETHING THAT CAN ACTUALLY STOP THE RUN.
 *
 * The fixture already announces itself — that is what `fixture-says-so.test.ts`
 * proves. But a `console.warn` is only a warning, and vitest prints stderr for
 * FAILING tests only: in a green run the announcement is written and never
 * shown. So the alarm was audible in exactly the situation where nobody was
 * listening, and silent in the one where it mattered.
 *
 * Measured, not assumed. With `lib/data` deliberately unmocked,
 * `measured.test.tsx` mounted the fixture — 24 invented memories instead of the
 * 3 its own facts declare, the fixture's "Course marketing" wall on screen —
 * and all four of its tests still passed, because what they assert is that the
 * loop wrote into twelve elements, which is true of any world at all. That is
 * the original incident reproduced exactly, in a file whose seam is correct.
 *
 * Watching the warning is deliberately how this is detected, rather than
 * reading some flag off the page. It uses the product's own alarm, so the two
 * cannot drift apart: a fixture that stopped warning would fail
 * `fixture-says-so.test.ts` before it ever got the chance to fool this.
 */
async function withFixtureAlarm<T>(work: () => Promise<T>): Promise<T> {
  const realWarn = console.warn;
  let announced = "";
  console.warn = (...args: unknown[]) => {
    const first = String(args[0] ?? "");
    if (!announced && first.includes(FIXTURE_ALARM)) announced = first;
    realWarn(...args);
  };
  try {
    const value = await work();
    if (announced) {
      throw new Error(
        "THE DEV FIXTURE TOOK OVER THIS MOUNT — every assertion after this " +
          "point would describe invented data.\n" +
          "The page replaces the whole world with `offlineHome()` when a " +
          "loader throws, so this almost always means the suite mocked the " +
          "wrong seam: mock `lib/data`, not `lib/api`, for the three layers. " +
          "See gate G6 in docs/goals/a-codebase-you-can-navigate.md.\n" +
          "The page said: " +
          announced,
      );
    }
    return value;
  } finally {
    console.warn = realWarn;
  }
}

export async function mountWorld(facts: WorldFacts, options: { initialEntries?: string[]; routerTools?: ReactElement } = {}): Promise<MountedWorld> {
  const { default: HomePage } = await import("../../src/pages/Home");
  const { AuthProvider } = await import("../../src/lib/auth-context");

  installRandom();
  const step = installClock();

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  try {
    await withFixtureAlarm(async () => {
      await act(async () => {
        root.render(
          createElement(
            MemoryRouter,
            { initialEntries: options.initialEntries },
            createElement(AuthProvider, null, createElement(HomePage) as ReactElement),
            options.routerTools,
          ),
        );
      });
      /* let the fetches settle and the loop build the field */
      await act(async () => {
        await Promise.resolve();
      });
      await step(30);
    });
  } catch (err) {
    /*
     * A MOUNT THAT FAILED STILL HAS TO CLEAN UP AFTER ITSELF.
     *
     * `mountWorld` never returns here, so the caller has no handle to unmount
     * with and its `afterEach` cannot help. Left alone, a page that is still
     * mounted keeps its frame loop and its listeners, and the NEXT test in the
     * file inherits them — so one honest failure becomes a cascade of
     * unrelated ones and the real message scrolls away. The original error is
     * rethrown untouched; this only tidies.
     */
    act(() => root.unmount());
    container.remove();
    throw err;
  }

  const audit = () => {
    const hook = (window as unknown as { wakaField?: () => FieldAudit | null }).wakaField;
    if (!hook) {
      throw new Error(
        "window.wakaField is absent — the simulation never started. " +
          "Usually the canvas stub was not installed, or the page is still loading.",
      );
    }
    const value = hook();
    if (!value) throw new Error("the audit returned null — the loop is not running");
    return value;
  };

  const clickByText = async (selector: string, name: RegExp) => {
    const el = [...container.querySelectorAll(selector)].find((n) =>
      name.test((n.textContent ?? "").trim()),
    );
    if (!el) {
      const seen = [...container.querySelectorAll(selector)].map((n) => n.textContent?.trim());
      throw new Error(`no ${selector} matching ${name} — saw: ${JSON.stringify(seen)}`);
    }
    await act(async () => {
      (el as HTMLElement).click();
    });
  };

  return {
    root,
    container,
    audit,
    step,
    async rerender() {
      await act(async () => {
        root.render(createElement(MemoryRouter, { initialEntries: options.initialEntries },
          createElement(AuthProvider, null, createElement(HomePage) as ReactElement), options.routerTools));
      });
      await step(30);
    },
    async travelTo(name) {
      /*
       * TRAVEL BY COMMAND, BECAUSE THE DOORS KEEP MOVING.
       *
       * This has now chased three of them: a wall-names strip along the
       * bottom, then the caret beside the name in the top-left, then a
       * "Rooms and agents" row in the menu. Each was the route a person
       * actually had at the time, and each was removed by a ruling — rooms
       * and agents are set aside entirely for now, so at the moment there is
       * no door at all.
       *
       * A suite about what a ROOM holds should not keep breaking because the
       * way in moved. So it goes through `wakaSim`, the same dev seam the
       * ground uses, and finds its wall by asking where it landed: columns
       * are signed with the owner at zero, so walking outward from there and
       * checking `audit().wallId` arrives without knowing the layout.
       */
      const sim = (window as unknown as {
        wakaSim?: () => {
          goToWall(col: number): void;
          navigationState(): { moving: boolean };
        } | null;
      }).wakaSim;
      if (!sim) throw new Error("window.wakaSim is absent — the simulation never started");
      const api = sim();
      if (!api) throw new Error("the simulation is not running");

      const wanted = (id: string, kind: string) =>
        name.test("Me") ? kind === "self" : name.test(id) || name.test(nameOfWall(id));

      /* The fixture's own names, so a regexp written against what a person
         reads still selects the right wall. */
      const nameOfWall = (id: string): string =>
        (facts.groups ?? []).find((group) => group.id === id)?.name ?? "";

      /**
       * WAIT FOR THE CROSSING, DO NOT GUESS AT ITS LENGTH.
       *
       * A crossing already in flight refuses the next one, by design. This
       * used to answer that with a fixed `step(70)` per attempt, and that
       * worked for one reason nobody had written down: rooms were at column
       * +1, so the first non-zero try arrived immediately and no crossing
       * ever had to be waited out.
       *
       * The moment the axis changed — agents to the right, rooms to the left,
       * because the founder asked three times for the creature to move RIGHT
       * — the first try landed on the agent and the walk had to cross back
       * through zero to reach a room. That is a longer flight than 70ms of
       * fake time, so the next `goToWall` was refused, the loop kept asking
       * from the wrong place, and twenty-four room suites reported the
       * PRODUCT as broken when what was wrong was this helper's assumption
       * about which side rooms live on.
       *
       * Asking `navigationState().moving` removes the assumption entirely.
       * The seam already exists and the world's own URL canonicaliser already
       * polls it for exactly this reason.
       */
      const settle = async () => {
        for (let turn = 0; turn < 40; turn += 1) {
          if (!api.navigationState().moving) return;
          await step(40);
        }
      };
      await settle();
      for (const col of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await act(async () => api.goToWall(col));
          await settle();
          await step(40);
          const where = audit();
          if (wanted(where.wallId, where.wallKind)) return;
        }
      }

      const here = audit();
      throw new Error(
        `travelTo(${name}) did not arrive — standing on ${here.wallKind} "${here.wallId}". ` +
          `If the wall is missing, the group fetch mock is wrong.`,
      );
    },
    async toField() {
      /* THE WHEEL NO LONGER TRAVELS. Dragging and scrolling the world
         vertically were removed — the archive and the principles are pages,
         so there is nowhere above or below to go by gesture. The PLACE is
         still there and the camera still visits it (a deep link to one
         memory, the dial, a principle's evidence), so this drives the same
         command those paths use instead of a gesture a person no longer has. */
      const sim = (window as unknown as { wakaSim?: () => { toGround(): void } | null }).wakaSim;
      if (!sim) throw new Error("window.wakaSim is absent — the simulation never started");
      const api = sim();
      if (!api) throw new Error("the simulation is not running");
      /* `toGround` REFUSES WHILE A WALL TRIP IS IN FLIGHT, by design — two
         travels at once is how a camera ends up between places. A test that
         crosses to a room and then asks for its ground is asking inside
         exactly that window, and the command is dropped silently. So ask
         until it takes, rather than guessing at a wait long enough to cover
         it: a fixed delay is either flaky or slow, and usually both. */
      for (let attempt = 0; attempt < 14; attempt += 1) {
        await act(async () => api.toGround());
        await step(30);
        /* ARRIVAL IS `camY` REACHING `fieldRest`, which the audit publishes
           for exactly this reason: "where the camera was standing when this
           was counted" beside "where it has to stand for the count to mean
           anything". Stopping the moment it lands matters — every extra
           iteration is thirty more frames of a live simulation, and the
           camera is not the only thing moving in them. */
        const where = audit();
        if (Math.abs(where.camY - where.fieldRest) < 1) break;
      }
    },
    async standIn(name) {
      await clickByText(".jar-grounds-row", name);
      await step(60);
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/**
 * REACH A DESTINATION THE WAY A PERSON NOW DOES.
 *
 * The home page used to wear its destinations: a bottom nav with Home,
 * Inspirations, Principles and Find, and two activity cards for Review and
 * Talk. The founder moved all six behind the hamburger, so a suite that still
 * queries `.jar-personal-navigation` is asserting against a shape the product
 * no longer has.
 *
 * What those suites were actually testing — that the verb works, that the
 * section is recorded for Back, that Capture survives a reload — is unchanged
 * and still worth testing. Only the route to the control moved, so this helper
 * carries that one difference and the assertions stay where they were.
 */
export async function chooseFromMenu(container: HTMLElement, label: string): Promise<void> {
  /* THE PLACES MOVED TO THE BOTTOM. Founder: "have a bottom navbar." The
     four rungs across the top are gone and the dock holds what is left — and
     what is left is PLACES, which is why two of the four did not survive the
     move: claims are answered on the home screen and saves are moving there.
     What every suite using this helper tests is unchanged; only where the
     control lives is. */
  const rows = [...container.querySelectorAll<HTMLButtonElement>(".waka-dock .waka-dock-item")];
  const row = rows.find((node) => node.textContent?.trim().startsWith(label));
  if (!row) {
    throw new Error(
      `no dock row named ${label}. The dock offers: ${rows.map((n) => n.textContent?.trim()).join(", ")}`,
    );
  }
  await act(async () => row.click());
}

/**
 * THE LEFT CORNER — chat history, one press.
 *
 * Founder: "top left button should be chat history since moving between
 * inspirations, top of mind, principles is done with the middle center
 * dropdown." So the corner is a single act again, not a menu: pressing it
 * holds the conversations list up over the world. The three views went back
 * to `chooseFromMenu`, where they started.
 */
export async function pressChatCorner(container: HTMLElement): Promise<void> {
  /* CHAT MOVED OUT OF THE CORNER AND INTO THE DOCK. Founder: "switch between
     me and my agent should go in top left now that we have new entry point
     for chat" — the corner holds the form switch now, and conversations are a
     dock row like the other places. The name stays so every suite that
     reaches for the conversations door keeps reading the same; only where
     that door is has changed. */
  const row = [...container.querySelectorAll<HTMLButtonElement>(".waka-dock .waka-dock-item")]
    .find((node) => node.textContent?.trim() === "Conversations");
  if (!row) {
    const had = [...container.querySelectorAll<HTMLButtonElement>(".waka-dock .waka-dock-item")]
      .map((node) => node.textContent?.trim())
      .join(" | ");
    throw new Error(`no conversations row in the dock. The dock offers: ${had}`);
  }
  await act(async () => row.click());
}

/** Dismissing an overlay the way a person does: the visible close. Escape and
    the scrim also work, and the point of Law 2 is that the SEEN one exists. */
export async function closeOverlay(container: HTMLElement): Promise<void> {
  const close = container.querySelector<HTMLButtonElement>(".waka-over .waka-over-close");
  if (!close) throw new Error("no visible way out of this overlay");
  await act(async () => close.click());
}

/** The capture entry is a field now, not a button that opens one. */
export function keepBox(container: HTMLElement): HTMLTextAreaElement {
  const box = container.querySelector<HTMLTextAreaElement>("textarea.jar-keep-box");
  if (!box) throw new Error("the keep box is not on this screen");
  return box;
}

/** Open the menu and leave it open, for assertions about a row's own state. */
export async function openMenu(container: HTMLElement): Promise<void> {
  const opener = container.querySelector<HTMLButtonElement>(".waka-corners button[aria-controls]");
  if (!opener) throw new Error("the menu button is not on this screen");
  if (!container.querySelector(".waka-menu")) await act(async () => opener.click());
}

/**
 * Open the archive's own page.
 *
 * Facts about the archive live on the archive now — its size, its search —
 * rather than on whichever control happens to point at it. Three of those
 * controls have been removed in turn, so a suite about what the archive SAYS
 * should go to it rather than chase the door.
 */
export async function goToInspirations(container: HTMLElement): Promise<void> {
  await chooseFromMenu(container, "Your inspirations");
}
