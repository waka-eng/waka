// @vitest-environment jsdom
/**
 * THE SHARE CARD'S GRAIN IS BUILT ONCE.
 *
 * The top of mind carries the home screen's paper grain. It used to be laid
 * by reading and writing every pixel of the 1080 card on every redraw — a
 * beat after each keystroke. It is now one small seeded tile, made the first
 * time and composited after that.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing at a module seam. `getContext`
 * on the canvas prototype is stubbed,
 * because jsdom has no 2D canvas; the stand-in only records the pixels the
 * tile is given. The tile builder itself is real.
 */
import { expect, it, vi } from "vitest";

it("builds one seeded grain tile, within the grain's span, and reuses it", async () => {
  const put = vi.fn();
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ({
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: put,
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext);
  try {
    const { grainTileCanvas } = await import("../src/lib/principle-artifact");
    const first = grainTileCanvas();
    expect(first).not.toBeNull();
    expect(grainTileCanvas(), "the same tile, not a new one").toBe(first);
    expect(put).toHaveBeenCalledOnce();
    const data = (put.mock.calls[0]![0] as { data: Uint8ClampedArray }).data;
    const values = new Set<number>();
    for (let i = 0; i < data.length; i += 4) {
      /* grey (the same on every channel), opaque, and n + 7 for n in ±7 */
      expect(data[i + 1]).toBe(data[i]);
      expect(data[i + 2]).toBe(data[i]);
      expect(data[i + 3]).toBe(255);
      values.add(data[i]!);
    }
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThanOrEqual(14);
    expect(values.size, "noise, not a flat fill").toBeGreaterThan(10);
  } finally {
    getContext.mockRestore();
  }
});
