/**
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing at the module boundary. The
 * canvas context and palette are recording stand-ins passed to the real field
 * painter, proving which orbs get the label without requiring GPU pixels.
 */
import { describe, expect, it, vi } from "vitest";
import type { Palette } from "../src/canvas/palette";
import { paintField } from "../src/space/inspiration/field-paint";
import type { Ball } from "../src/space/inspiration/orb";

function renderMarker(reflections: number, col?: number, own?: boolean) {
  const arc = vi.fn();
  const canvas = { drawImage: vi.fn(), beginPath: vi.fn(), arc, fill: vi.fn(), save: vi.fn(), restore: vi.fn(),
    imageSmoothingEnabled: true, globalAlpha: 1, globalCompositeOperation: "source-over" };
  const sprite = {} as HTMLCanvasElement;
  const tiers = Array.from({ length: 8 }, () => sprite);
  const palette = { blooms: [tiers], orbs: [tiers], ramp: { fade: [185, 196, 209] } } as unknown as Palette;
  const ball = { id: "saved", x: 200, y: 200, r: 28, active: true, alive: 0.8,
    alivePow: 0.7, breathRate: 0, breathPhase: 0, gone: 0, dim: 0, glow: 0,
    press: 0, sizeIdx: 0, origin: "human", hue: -1, reflections, col, own } as Ball;
  paintField({ ctx: canvas as unknown as CanvasRenderingContext2D, pal: palette,
    list: [ball], order: [0], cam: { x: 0, y: 0 },
    view: { reduced: true, w: 400, h: 400, dpr: 1, layout: { fieldTop: 0 } },
    t: 0, depthSpan: 400, selId: null, still: false, mech: 0,
    grid: (value) => value, panelOpen: () => false });
  return arc;
}

describe("saved-reflection marker", () => {
  it("labels a reflected inspiration and not an unanswered one", () => {
    expect(renderMarker(2)).toHaveBeenCalledTimes(2);
    expect(renderMarker(0)).not.toHaveBeenCalled();
  });

  it("keeps private reflection markers on the personal ground, not room orbs", () => {
    expect(renderMarker(2, 1, false)).not.toHaveBeenCalled();
    expect(renderMarker(2, 1, true)).not.toHaveBeenCalled();
  });
});
