// @vitest-environment jsdom
/**
 * A PRESSED CREATURE LIGHTS UP, OFF THE CANVAS AS ON IT.
 *
 * WHAT THIS MOCKS, AND WHY: nothing of ours. `window.matchMedia` and
 * `requestAnimationFrame` (with `cancelAnimationFrame`, and `performance.now`)
 * are browser APIs, set per case so the reduced-motion
 * and eased paths can each be stated. jsdom has no 2D canvas, so the drawing
 * itself is skipped by the component's own guard; what is asserted is the
 * light it writes (`--waka-companion-reach` / `--waka-companion-spread`),
 * computed from the world's flare constants in `character/raster.ts`.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Companion } from "../src/components/Companion";
import { FLARE_REACH, FLARE_SECONDS, FLARE_SPREAD } from "../src/character/raster";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(node: JSX.Element): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

function reducedMotion(on: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: on && query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} }),
  });
}

const light = (page: HTMLElement) => {
  const aura = page.querySelector<HTMLElement>(".waka-companion")!;
  return {
    reach: Number(aura.style.getPropertyValue("--waka-companion-reach")),
    spread: Number(aura.style.getPropertyValue("--waka-companion-spread")),
  };
};

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null; host = null;
  vi.useRealTimers();
});

describe("Companion, pressed", () => {
  it("is a named button whose press lights the aura by the world's own flare, then lets it go", () => {
    reducedMotion(true);
    vi.useFakeTimers();
    const page = mount(<Companion size={88} />);
    const button = page.querySelector("button")!;
    expect(button.getAttribute("aria-label")).toBe("Light up WAKA");
    expect(button.getAttribute("type")).toBe("button");
    expect(light(page)).toEqual({ reach: 1, spread: 1 });

    act(() => { button.click(); });
    expect(light(page)).toEqual({ reach: 1 + FLARE_REACH, spread: 1 + FLARE_SPREAD });

    act(() => { vi.advanceTimersByTime(FLARE_SECONDS * 1000 - 1); });
    expect(light(page).reach).toBe(1 + FLARE_REACH);
    act(() => { vi.advanceTimersByTime(1); });
    expect(light(page)).toEqual({ reach: 1, spread: 1 });
  });

  it("eases the light down when motion is allowed", () => {
    reducedMotion(false);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const now = vi.spyOn(performance, "now").mockReturnValue(1000);
    const page = mount(<Companion size={88} />);
    act(() => { page.querySelector("button")!.click(); });
    act(() => { frames.shift()!(1000 + (FLARE_SECONDS * 1000) / 2); });
    expect(light(page).reach).toBeCloseTo(1 + FLARE_REACH / 2);
    act(() => { frames.shift()!(1000 + FLARE_SECONDS * 1000); });
    expect(light(page).reach).toBe(1);
    now.mockRestore();
    vi.unstubAllGlobals();
  });

  it("takes no press inside something that is already pressed", () => {
    const page = mount(<button type="button"><Companion size={24} pressable={false} label="Agent" /></button>);
    expect(page.querySelectorAll("button")).toHaveLength(1);
    expect(page.querySelector("canvas")!.getAttribute("aria-label")).toBe("Agent");
  });

  it("reads the flare from the anatomy the world's loop reads, never a copy", () => {
    const loop = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../src/canvas/simulation.ts"), "utf8");
    for (const name of ["FLARE_REACH", "FLARE_SPREAD", "FLARE_SECONDS"]) expect(loop).toContain(name);
    expect(loop).not.toMatch(/companion\.flare \* 0\.5|companion\.flare \* 0\.25|dt \/ 0\.7\b/);
  });
});
