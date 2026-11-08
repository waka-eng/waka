// @vitest-environment jsdom
/**
 * ONE WALK, TWO WALKERS: the crossing between Now and Principles walks in
 * place; onboarding's other person travels. Both read `character/walk.ts`.
 *
 * WHAT THIS MOCKS, AND WHY: nothing. The beats are pure arithmetic, and
 * jsdom has no 2D canvas, so the walker's own guard places it at the end of
 * its walk without drawing — which is the state asserted.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { OWNER_BEING } from "../src/character/body";
import { WALK_MS, WALK_STEPS_MS, WALK_TURN_MS, walkBeat } from "../src/character/walk";
import { WalkingCompanion } from "../src/components/WalkingCompanion";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const HERE = dirname(fileURLToPath(import.meta.url));

describe("walkBeat", () => {
  it("faces you, turns to the way it goes, steps across, and faces you again", () => {
    const start = walkBeat(0, -1, 100);
    expect(Math.abs(start.yaw)).toBe(0);
    expect(start.travel).toBe(0);
    expect(start.bob).toBe(0);
    const across = walkBeat(WALK_TURN_MS + WALK_STEPS_MS / 2, -1, 100);
    expect(across.yaw).toBeCloseTo(-Math.PI / 2);
    expect(across.travel).toBeCloseTo(0.5);
    expect(walkBeat(WALK_TURN_MS + WALK_STEPS_MS / 6, 1, 100).bob).toBeGreaterThan(0);
    const done = walkBeat(WALK_MS, -1, 100);
    expect(done.yaw).toBeCloseTo(0);
    expect(done.travel).toBe(1);
    expect(done.bob).toBe(0);
  });

  it("is the crossing's walk, not a copy of it", () => {
    const crossing = readFileSync(resolve(HERE, "../src/components/CrossingCompanion.tsx"), "utf8");
    expect(crossing).toMatch(/walkBeat\(/);
    expect(crossing).toMatch(/placeStep\(/);
    expect(crossing).not.toMatch(/size \* 0\.07|0\.07 \* walking|size \* 0\.45|\* 0\.05 : 0/);
  });
});

describe("WalkingCompanion", () => {
  it("stands where the walk ends when it cannot walk, and takes no press", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<WalkingCompanion size={88} being={OWNER_BEING} distance={150} />));
    const walker = host.querySelector<HTMLElement>(".waka-walking")!;
    expect(walker.style.transform).toBe("translateX(0px)");
    expect(walker.getAttribute("aria-hidden")).toBe("true");
    expect(host.querySelector("button")).toBeNull();
    act(() => root.unmount());
    host.remove();
  });
});
