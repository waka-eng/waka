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
       * THE ROUTE A PERSON ACTUALLY HAS.
       *
       * This used to click the wall-names strip along the bottom of the
       * screen. That strip is gone (founder, 2026-08-24: "remove") — every
       * wall now hangs off the caret beside the name in the top-left corner,
       * and a helper that still reaches for the old strip finds an empty list
       * and fails twelve tests with a message about the group mock, which is
       * not what is wrong.
       *
       * So travel the way the person travels: open the list, press the row.
       * The list closes on the press, hence re-opening it each attempt.
       */
      const openWallList = async () => {
        /* AT HOME THE NAME PILL IS NOT THERE. It said "ME" beside the menu
           button, which is your own name read back to you on the one screen
           where you have not gone anywhere (founder ruling), so it now appears
           only when where-you-are is a real question — in a room, on an
           agent's wall, or down in the field. The caret's job moved to the
           "Rooms and agents" row in the menu, and choosing it brings the pill
           back with its list already open. Travel the way a person does. */
        const caret = container.querySelector<HTMLElement>(".jar-here-more");
        if (caret) {
          if (caret.getAttribute("aria-expanded") !== "true") {
            await act(async () => {
              caret.click();
            });
          }
          return;
        }
        if (!container.querySelector(".jar-here-list")) {
          await chooseFromMenu(container, "Rooms and agents");
        }
      };

      for (let attempt = 0; attempt < 8; attempt += 1) {
        const pill = container.querySelector(".jar-here");
        /* NO PILL MEANS HOME. It is hidden on your own wall, so "where am I"
           has no label to read there — its absence IS the answer, and a helper
           that only knows how to read the label would loop until it gave up. */
        const here = (pill?.textContent ?? "").trim();
        /* NO NAME MEANS HOME — whether the pill is absent or momentarily
           blank mid-travel. It is hidden on your own wall, so "where am I" has
           no label to read there and its absence IS the answer. */
        if (!here && name.test("Me")) break;
        if (name.test(here)) break;
        await openWallList();
        await clickByText(".jar-here-row", name);
        await step(90); /* travel eases over ~670ms */
      }
      await step(30);
      /*
       * ARRIVAL IS ASSERTED, NEVER ASSUMED.
       *
       * `goToWall` clamps its target to the walls that actually exist, so if
       * the group never reached the list the click is a silent no-op and the
       * camera stays where it was. A test that then checked the ground would
       * be checking the wall it started on and passing — which is exactly the
       * kind of green that let the original bug through. Better to be loud.
       */
      const here = (container.querySelector(".jar-here")?.textContent ?? "").trim();
      /* No name means home — the pill is hidden on your own wall, so arriving
         there is announced by its absence rather than by a label. */
      if (!(!here && name.test("Me")) && !name.test(here)) {
        await openWallList();
        const offered = [...container.querySelectorAll(".jar-here-row")].map((n) =>
          (n.textContent ?? "").trim(),
        );
        throw new Error(
          `travelTo(${name}) did not arrive — still standing on "${here}". ` +
            `The wall list offers: ${JSON.stringify(offered)}. ` +
            `If the wall is missing from that list, the group fetch mock is wrong.`,
        );
      }
    },
    async toField() {
      const canvas = container.querySelector("canvas");
      if (!canvas) throw new Error("no canvas — the layout never mounted");
      for (let i = 0; i < 12; i += 1) {
        await act(async () => {
          canvas.dispatchEvent(
            new WheelEvent("wheel", { deltaY: 240, bubbles: true, cancelable: true }),
          );
        });
        await step(4);
      }
      await step(60); /* the camera snaps to a rest point, then the pour lands */
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
  const opener = container.querySelector<HTMLButtonElement>(".waka-corners button[aria-controls]");
  if (!opener) throw new Error("the menu button is not on this screen");
  await act(async () => opener.click());
  /* A row may carry an sr-only note after its label — the archive's size rides
     the Inspirations row — so match the label, not the whole string. */
  const row = [...container.querySelectorAll<HTMLButtonElement>(".waka-menu .waka-menu-item")].find(
    (node) => node.textContent?.trim().startsWith(label),
  );
  if (!row) {
    const had = [...container.querySelectorAll(".waka-menu .waka-menu-item")]
      .map((node) => node.textContent?.trim())
      .join(", ");
    throw new Error(`no menu row named ${label}. The menu offers: ${had}`);
  }
  await act(async () => row.click());
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
