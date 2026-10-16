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
  /**
   * The viewer's own memories.
   *
   * `isPublic` MARKED THE ONES A ROOM COULD READ, and it is kept because
   * `lib/data`'s `Inspiration.isPublic` is kept: rooms were removed on
   * CORRECTION (2026-10-15): it is kept, but NOT because anything reads it.
   * `Inspiration.isPublic` is write-only in `src` — see the corrected
   * tombstone in `pages/Home`, whose claim that the panel read it was false.
   * 2026-10-12 (founder: "방 없애") but `inspirations.visibility` was
   * deliberately NOT touched, and the founder has an open question about what
   * that axis means with nothing to be public TO. A fixture that stopped
   * being able to express the flag would quietly decide that question.
   */
  inspirations: Array<{ id: string; text: string; daysAgo: number; isPublic?: boolean }>;
}

/* `groups` IS GONE FROM THE FACTS, and with it `DECIDED` — the lead entry of
   a room's board, which every room suite matched against. A world fact is
   something this product can have; rooms are not one. */

export const VIEWER_ID = "profile-viewer";

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

/**
 * WHAT STILL GOES THROUGH `lib/api` AND HAS TO BE MOCKED HERE.
 *
 * ── THIS FUNCTION WAS ALMOST ENTIRELY ROOMS (2026-10-12) ─────────────────
 *
 * Founder: "방 없애" — remove rooms. What stood here: `fetchGroups`,
 * `fetchGroupField`, `fetchGroupMembers`, `fetchGroupTopOfMind`,
 * `fetchGroupWall` and `fetchGroupProposals`. Two of them carried fixture
 * reasoning worth keeping on the record, because both were learned from a
 * suite that passed while proving nothing:
 *
 *   THE BOARD AND THE WALL WERE NEEDED TOGETHER. The loop built a room's
 *   provenance by matching `evidence.citedBy` against the lead entry's body,
 *   so a board with no entries and a wall with no signals gave zero and
 *   proved nothing — an innocent-looking empty that read as a pass.
 *
 *   THE WALL WAS ROOM-GROWN (2026-08-24): one statement standing on every
 *   member as its contributors, which was also the smallest wall that
 *   satisfied the serve gate's two-voices rule.
 *
 * Three verbs remain and all three answer with nothing, which is what the
 * world needs them to do: a mounted world asks for them on boot and a
 * fixture that left them undefined would fail on a missing function rather
 * than on anything a test is about.
 */
export function apiMockFrom(_facts: WorldFacts) {
  const none = async () => [];
  return {
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
  /* `standIn(name)` IS GONE. It clicked one of the "whose ground" rows —
     `.jar-grounds-row` — and stepped sixty frames while the ground re-solved.
     The band of names was a room's, deleted on 2026-10-12; the audit fields
     it was asserted against (`ground`, `company`) were deleted on 2026-10-15
     with the loop's group branches, and this is the third leg of the same
     tripod. A test helper that drives a selector nothing renders is worse
     than no helper: it compiles, it is discoverable, and the first person to
     reach for it gets a timeout instead of an answer. */
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
       * This chased three of them: a wall-names strip along the bottom, then
       * the caret beside the name in the top-left, then a "Rooms and agents"
       * row in the menu. Each was the route a person actually had at the
       * time, and each was removed by a ruling. Rooms themselves went on
       * 2026-10-12 (founder: "방 없애"), so the axis is agents, then you, and
       * the only lateral travel left is between those two.
       *
       * A suite about what a WALL holds should not break because the way in
       * moved. So it goes through `wakaSim`, the same dev seam the ground
       * uses, and finds its wall by asking where it landed: columns are
       * signed with the owner at zero, so walking outward from there and
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

      /* THE NAME LOOKUP WENT WITH ROOMS. It resolved a wall id to the
         fixture's own room name so that a regexp written against what a
         person READS still selected the right wall. The walls left are yours
         — matched on kind — and your agent's, whose id the caller has. */
      const wanted = (id: string, kind: string) =>
        name.test("Me") ? kind === "self" : name.test(id);

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
       * THE ROOMS ARE GONE AND THIS STAYS. Asking `navigationState().moving`
       * removes the assumption entirely, which is why it survived the thing
       * it was written for: a helper that knows which columns exist is a
       * helper that breaks the next time the axis changes, and the axis has
       * now changed three times.
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
          `If the wall is missing, the agent roster mock is wrong.`,
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
         exactly that window, and the command is dropped silently. (The case
         that taught this was crossing to a ROOM and then asking for its
         ground; the same window opens on any crossing.) So ask until it
         takes, rather than guessing at a wait long enough to cover it: a
         fixed delay is either flaky or slow, and usually both. */
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
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** The bar's rows. */
function dockRows(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>(".waka-dock .waka-dock-item")];
}
/* BY ACCESSIBLE NAME, which is what a person navigating by voice or by
   screen reader would say out loud. */
const accessibleName = (node: HTMLElement) =>
  (node.textContent?.trim() || node.getAttribute("aria-label")?.trim()) ?? "";

/**
 * THE WHOLE BAR, IN THE ORDER A PERSON MEETS IT: every press by accessible
 * name, a chat's field as `field`, and each drawn rule between groups as
 * `│`. On Now and the two lists this is the two words; on a page you are
 * making something on it is the list's door │ the making │ Close (founder,
 * 2026-10-15).
 */
export function barShape(container: HTMLElement): string[] {
  const bar = container.querySelector("nav.waka-dock");
  if (!bar) throw new Error("the bar is not on screen");
  return [...bar.querySelectorAll<HTMLElement>("button, textarea, span.waka-dock-sep")].map((node) =>
    node.matches("span.waka-dock-sep") ? "│" : node.matches("textarea") ? "field" : accessibleName(node));
}

/** Press the bar row named exactly `label`, or say what the bar offers. */
export async function pressDockRow(container: HTMLElement, label: string): Promise<void> {
  const rows = dockRows(container);
  const row = rows.find((node) => accessibleName(node) === label);
  if (!row) {
    throw new Error(`no dock row named ${label}. The dock offers: ${rows.map(accessibleName).join(", ")}`);
  }
  await act(async () => row.click());
}

/**
 * Press the bar row named `label` once it is in the bar. A new note and a new
 * chat each open through an effect and a history write, so the row that
 * becomes theirs ("All inspirations", "All chats", "Close") can land a flush
 * after the press that opened the page.
 */
async function pressDockRowWhenItAppears(container: HTMLElement, label: string, what: string): Promise<void> {
  for (let turn = 0; turn < 40; turn += 1) {
    const row = dockRows(container).find((node) => accessibleName(node) === label);
    if (row) {
      await act(async () => row.click());
      return;
    }
    await act(async () => { await Promise.resolve(); });
  }
  throw new Error(`${what} (the bar's ${label}) never appeared. The dock offers: ${dockRows(container).map(accessibleName).join(", ")}`);
}

/** The bar's Close, on a page you are making something on, or null. */
function dockClose(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(".waka-dock button.waka-dock-item--close");
}

/**
 * THE CHAT'S FIELD, IN THE BAR. Inside Home a chat lends its textarea, mic
 * and send to the bar's middle group (`#waka-chat-composer`, founder
 * 2026-10-15), and the slot is found after paint — so this waits a few
 * flushes for the portal to land before saying it is not there.
 */
export async function dockChatField(container: HTMLElement): Promise<HTMLTextAreaElement> {
  for (let turn = 0; turn < 40; turn += 1) {
    const field = container.querySelector<HTMLTextAreaElement>(".waka-dock #waka-chat-composer textarea");
    if (field) return field;
    await act(async () => { await Promise.resolve(); });
  }
  throw new Error("the chat's field never arrived in the bar (#waka-chat-composer)");
}

/**
 * Press `selector` once it is on screen. A new note and a new chat each open
 * through an effect and a history write, so the door on them can land a
 * flush after the press that opened the page.
 */
async function pressWhenItAppears(container: HTMLElement, selector: string, what: string): Promise<void> {
  for (let turn = 0; turn < 40; turn += 1) {
    const node = container.querySelector<HTMLElement>(selector);
    if (node) {
      await act(async () => node.click());
      return;
    }
    await act(async () => { await Promise.resolve(); });
  }
  throw new Error(`${what} (${selector}) never appeared`);
}

/** A key pressed where a person's would land: on the open page, else the body. */
async function pressKey(container: HTMLElement, key: string): Promise<void> {
  const target = container.querySelector<HTMLElement>(".waka-over[data-jar-surface]") ?? document.body;
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

/**
 * REACH A DESTINATION THE WAY A PERSON NOW DOES.
 *
 * What the suites using this test — that the verb works, that the section is
 * recorded for Back, that Capture survives a reload — is unchanged. Only the
 * route to the control moves, so this helper carries that one difference and
 * the assertions stay where they were.
 *
 * THE ROUTES SINCE 2026-10-15. Founder: "at the bottom bar just keep
 * inspiration and chat and clicking on it leads to new inspiration and new
 * chat, and user can go to inspiration list and chat list ONLY from that new
 * page" — and "principle is sth user can only get by dragging". So:
 *   - "Inspirations" / "Your inspirations" → the bar's Inspiration (a new
 *     note), then "All inspirations" — the first word of that note's bar
 *     since "never put something on any corners" (2026-10-15);
 *   - "Chats" → the bar's Chat (a new chat), then "All chats" in its bar;
 *   - "Principles" → ArrowRight on Now, the keyboard twin of pulling the
 *     creature right;
 *   - "Now" → Close when a page you are making something on is up (a note
 *     or a chat), else the lit bar row pressed again (the archive, the chats
 *     list), else Escape (Principles). Already home, nothing is pressed.
 * Any other label presses the bar row of exactly that name.
 */
export async function chooseFromMenu(container: HTMLElement, label: string): Promise<void> {
  if (label === "Inspirations" || label === "Your inspirations") {
    await pressDockRow(container, "Inspiration");
    await pressDockRowWhenItAppears(container, "All inspirations", "a new note's All inspirations");
    return;
  }
  if (label === "Chats") {
    await pressChatCorner(container);
    return;
  }
  if (label === "Principles") {
    await pressKey(container, "ArrowRight");
    return;
  }
  if (label === "Now") {
    if (!container.querySelector(".waka-over[data-jar-surface]") && !dockClose(container)
      && !container.querySelector('.waka-dock .waka-dock-item[aria-current="page"]')) return;
    await closeOverlay(container);
    return;
  }
  await pressDockRow(container, label);
}

/**
 * THE CHATS LIST. The name is kept so every suite reaching for the
 * conversations door reads the same; the door is two presses now.
 *
 * Founder, 2026-10-15: the bar's Chat opens a NEW chat, and the list of chats
 * is reached from a chat's bar, whose first word is "All chats" — not from a
 * header above it, since nothing sits in a corner any more.
 */
export async function pressChatCorner(container: HTMLElement): Promise<void> {
  await pressDockRow(container, "Chat");
  await pressDockRowWhenItAppears(container, "All chats", "a new chat's All chats");
}

/**
 * Leaving a destination the way a person does, which stopped being an X.
 *
 * Founder, 2026-10-11: "There's no reason for there to be an X button when
 * we're just moving across the pages." The point of Law 2 is unchanged and so
 * is this helper's: the way out it presses is one a person can SEE.
 *
 * SINCE 2026-10-15 THAT IS CLOSE, OR THE LIT ROW. On a page you are making
 * something on — a note, a chat — the bar ends in Close, which goes home (a
 * note kept as a draft). On the two lists the row that says where you are
 * (`aria-current="page"`) is the way home when pressed again. Principles has
 * no row — it is walked to — so there the way out is Escape; its ← and its
 * pull left are `home-navigation.test.tsx`'s to test.
 */
export async function closeOverlay(container: HTMLElement): Promise<void> {
  if (!container.querySelector(".waka-dock")) throw new Error("no visible way out: the dock is not on screen");
  const close = dockClose(container);
  if (close) {
    await act(async () => close.click());
    return;
  }
  const lit = container.querySelector<HTMLButtonElement>('.waka-dock .waka-dock-item[aria-current="page"]');
  if (lit) {
    await act(async () => lit.click());
    return;
  }
  await pressKey(container, "Escape");
}

/**
 * STEP INTO REVIEW, the way a person now reaches a claim card or a pick.
 *
 * Founder, 2026-10-15: "the entry point into the card swipe left and right
 * should be the agent should say 'there are x things to review!' and the CTA
 * becomes 'Dive into review'". The cards no longer lie on home waiting; the
 * creature's bubble counts them and this press is the way in. Pass the
 * world's `step` to run the frame that hands the first card focus.
 */
export async function diveIntoReview(container: HTMLElement, step?: (frames?: number) => Promise<void>): Promise<void> {
  await pressWhenItAppears(container, ".jar-char-bubble--review button.jar-char-bubble-act", "the review invitation's Dive into review");
  if (step) await step(2);
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
