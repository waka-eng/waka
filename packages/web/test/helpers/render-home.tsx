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
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

import type { FieldAudit } from "../../src/pages/Home";

export interface WorldFacts {
  /** the viewer's own memories */
  inspirations: Array<{ id: string; text: string; daysAgo: number }>;
  /** groups the viewer belongs to, and whose memories stand in each */
  groups: Array<{
    id: string;
    name: string;
    field: Array<{ id: string; ownerProfileId: string; ownerName: string; daysAgo: number }>;
  }>;
}

export const VIEWER_ID = "profile-viewer";

const BASE = Date.UTC(2026, 7, 16);
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
 */
export function dataMockFrom(facts: WorldFacts) {
  return {
    loadInspirations: async () =>
      facts.inspirations.map((c) => ({
        id: c.id,
        preview: c.text,
        isPublic: false,
        kind: "note" as const,
        source: "app" as const,
        capturedMs: at(c.daysAgo),
        updatedMs: at(c.daysAgo),
        attachments: [],
        reflectionCount: 0,
      })),
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
      return (g?.field ?? []).map((f) => ({
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
    fetchGroupTopOfMind: async () => null,
    fetchGroupWall: none,
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

export async function mountWorld(facts: WorldFacts): Promise<MountedWorld> {
  const { default: HomePage } = await import("../../src/pages/Home");
  const { AuthProvider } = await import("../../src/lib/auth-context");

  const step = installClock();

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(AuthProvider, null, createElement(HomePage) as ReactElement),
      ),
    );
  });
  /* let the fetches settle and the loop build the field */
  await act(async () => {
    await Promise.resolve();
  });
  await step(30);

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
    async travelTo(name) {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const here = container.querySelector(".jar-here")?.textContent ?? "";
        if (name.test(here.trim())) break;
        await clickByText(".jar-axis a, .jar-axis button", name);
        await step(90); /* travel eases over ~670ms */
      }
      await step(30);
      /*
       * ARRIVAL IS ASSERTED, NEVER ASSUMED.
       *
       * `goToWall` clamps its target to the walls that actually exist, so if
       * the group never reached the axis the click is a silent no-op and the
       * camera stays where it was. A test that then checked the ground would
       * be checking the wall it started on and passing — which is exactly the
       * kind of green that let the original bug through. Better to be loud.
       */
      const here = (container.querySelector(".jar-here")?.textContent ?? "").trim();
      if (!name.test(here)) {
        const axis = [...container.querySelectorAll(".jar-axis a, .jar-axis button")].map((n) =>
          (n.textContent ?? "").trim(),
        );
        throw new Error(
          `travelTo(${name}) did not arrive — still standing on "${here}". ` +
            `The axis offers: ${JSON.stringify(axis)}. ` +
            `If the wall is missing from that list, the group fetch mock is wrong.`,
        );
      }
    },
    async toField() {
      const canvas = container.querySelector("canvas");
      if (!canvas) throw new Error("no canvas — the world never mounted");
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
      await clickByText(".jar-ground-row", name);
      await step(60);
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}
