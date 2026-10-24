// @vitest-environment jsdom

/**
 * THE INCIDENT, STAGED ON PURPOSE, SO THE GUARD AGAINST IT IS PROVEN.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6).
 *
 *   `lib/data` — the right seam, as every suite that mounts this page uses,
 *   but with `loadInspirations` REJECTING. That single rejection is the whole
 *   fixture: `pages/Home` catches it, calls `offlineHome()` and replaces the
 *   entire world with invented rows. Staging the failure at the loader rather
 *   than by leaving `lib/data` unmocked is deliberate — an unmocked loader
 *   would reach for the network, so the case would depend on nothing
 *   answering on localhost, and a dev server running on the wrong afternoon
 *   would turn this green for a reason unrelated to what it tests.
 *
 *   `lib/api` — emptied group reads, so nothing else is in flight and the one
 *   rejection above is unambiguously what caused what follows.
 *
 *   `lib/auth-context` — an unsigned local preview for the fixture alarm;
 *   the signed-in case verifies that failures never invent account data.
 *
 *   `helpers/canvas-stub` and `helpers/render-home` — canvas, clock, frame
 *   loop, viewport. `helpers/render-home` is also the SUBJECT here, which is
 *   unusual enough to say out loud: what is being tested is its refusal to
 *   hand back a world it did not produce.
 *
 * WHY THIS FILE EXISTS. G7 — "nothing green is blind" — asks that every gate
 * this repo trusts be proven to fail. `withFixtureAlarm` in
 * `helpers/render-home.tsx` is now such a gate: `measured.test.tsx` records
 * that four of its tests passed while the dev fixture was on screen, and that
 * guard is the only thing standing between that file and a repeat of the
 * incident G6 was written for. A guard nobody has watched fail is a guard
 * nobody has checked, and this project has already shipped one of those — the
 * vocabulary gate that read clean over half a file for a week.
 *
 * Proving it by hand does not survive the next edit to the helper, so the
 * proof lives here and runs with everything else.
 *
 * The second case is the one that took the longest to think of and matters
 * most: a guard that fired on EVERY mount would also be broken, and would
 * announce itself by turning the whole suite red — loudly, and therefore
 * harmlessly. The dangerous direction is a guard that has quietly stopped
 * watching, which looks exactly like a guard that never had anything to
 * report. So the mount that is meant to succeed is asserted too.
 */
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { installCanvasStub, setViewport } from "./helpers/canvas-stub";
import { dataMockFrom, mountWorld, VIEWER_ID, type MountedWorld } from "./helpers/render-home";

/** One person, one memory. Nothing here is looked at; only the mount is. */
const FACTS = {
  inspirations: [{ id: "own-0", text: "something I kept", daysAgo: 1 }],
  groups: [],
};

/**
 * Which world the next mount gets. Flipped per case rather than split across
 * two files, because the two mounts have to be identical in every other
 * respect or the comparison says nothing.
 */
let archiveFails = false;
let signedIn = false;
let rosterFails = false;
let roster: Array<Record<string, unknown>> = [];

vi.mock("../src/lib/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/data")>();
  const honest = dataMockFrom(FACTS);
  return {
    ...actual,
    ...honest,
    loadInspirations: async () => {
      if (archiveFails) {
        /* Not an ApiError: a 401 has its own branch that sends a real visitor
           to the login door, and this is standing in for a mocking mistake,
           which arrives as an ordinary throw from inside a translation. */
        throw new Error("staged: the archive could not be read");
      }
      return honest.loadInspirations();
    },
  };
});

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  const none = async () => [];
  return {
    ...actual,
    fetchGroups: none,
    fetchProfiles: async () => { if (rosterFails) throw new Error("offline"); return roster; },
    fetchTopOfMindVersions: none,
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
  return { ...actual, useOptionalAuth: () => signedIn ? session : null, useAuth: () => session };
});

let layout: MountedWorld | null = null;

beforeAll(() => {
  installCanvasStub();
  setViewport(1280, 900);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  layout?.unmount();
  layout = null;
  archiveFails = false;
  signedIn = false; rosterFails = false; roster = []; vi.restoreAllMocks();
});

describe("mounting the world when the fixture takes over", () => {
  it("refuses to hand back a world the dev fixture produced", async () => {
    archiveFails = true;

    /* The warning the fixture writes is expected here and would otherwise be
       printed as though something had gone wrong. Silenced, not asserted —
       `fixture-says-so.test.ts` owns the claim that it is written at all. */
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(mountWorld(FACTS)).rejects.toThrow(/THE DEV FIXTURE TOOK OVER/);

    warn.mockRestore();
  });

  /**
   * The message has to name the fix, not just the fact. Whoever meets this
   * failure is someone who believed their mocks were right, so "something is
   * wrong" costs them the afternoon and "mock lib/data, not lib/api" does not.
   */
  it("says which seam to move, because that is the whole repair", async () => {
    archiveFails = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(mountWorld(FACTS)).rejects.toThrow(/mock `lib\/data`, not `lib\/api`/);

    warn.mockRestore();
  });

  /**
   * THE HALF THAT PROVES THE GUARD IS STILL WATCHING RATHER THAN JAMMED OFF.
   *
   * Without this, a guard whose check had been edited into always-false would
   * pass the two cases above only by luck and would pass the whole rest of the
   * suite by definition — which is the shape of every blind gate this repo has
   * had. Here the same mount, on the same seams, with only the archive
   * answering, has to come back with the test's own memory in it.
   */
  it("hands back the real world when the loaders answer", async () => {
    archiveFails = false;

    layout = await mountWorld(FACTS);

    expect(layout.audit().present).toBe(FACTS.inspirations.length);
  });
});


it('shows an error instead of invented memories when a signed-in archive fails', async () => {
  signedIn = true;
  archiveFails = true;
  layout = await mountWorld(FACTS);
  expect(layout.container.querySelector('[role="alert"]')).not.toBeNull();
  expect(layout.container.textContent).not.toMatch(/Ouroboros maintainer|Course marketing/);
});


it('offers Retry on a failed initial agent load and loads real profiles when it succeeds',async()=>{
  signedIn=true; rosterFails=true;
  layout=await mountWorld(FACTS);
  expect(layout.container.textContent).toContain('Couldn’t load your agents.');
  rosterFails=false; roster=[{id:'noah',name:'Noah',type:'agent',createdAt:new Date().toISOString(),hasInspirations:false}];
  await act(async()=>layout!.container.querySelector<HTMLButtonElement>('.waka-profile-error button')!.click());
  await layout.step(5);
  expect(layout.container.querySelector('.waka-profile-error')).toBeNull();
  expect(layout.container.textContent).toContain('Noah');
});
it('keeps known agents visible when a background roster refresh fails',async()=>{
  signedIn=true; roster=[{id:'noah',name:'Noah',type:'agent',createdAt:new Date().toISOString(),hasInspirations:false}];
  layout=await mountWorld(FACTS);
  const visibility=vi.spyOn(document,'visibilityState','get');
  visibility.mockReturnValue('hidden');
  await act(async()=>document.dispatchEvent(new Event('visibilitychange')));
  await layout.step(2000); rosterFails=true;
  visibility.mockReturnValue('visible');
  await act(async()=>document.dispatchEvent(new Event('visibilitychange')));
  await layout.step(5);
  expect(layout.container.textContent).toContain('Noah');
  expect(layout.container.textContent).toContain('Couldn’t load your agents.');
});
