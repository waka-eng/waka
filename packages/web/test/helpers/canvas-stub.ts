/**
 * A 2D CONTEXT THAT ANSWERS, SO THE SIMULATION WILL RUN.
 *
 * jsdom has no canvas implementation, so `canvas.getContext("2d")` returns
 * null — and the world's frame loop opens with
 *
 *     const ctx = canvas.getContext("2d");
 *     if (!ctx) return undefined;
 *
 * which means under test the entire simulation silently declines to start.
 * Every assertion about it would then pass by describing nothing. That is the
 * failure mode this whole verification effort exists to end, so the stub comes
 * first.
 *
 * WHY A PROXY RATHER THAN A LIST OF METHODS.
 *
 * The drawing code calls a wide and growing surface of the 2D API, and a
 * hand-written stub fails by omission: someone adds `ctx.ellipse`, the stub
 * does not have it, and the test dies with a confusing TypeError in the middle
 * of a frame. A proxy answers everything by default and cannot fall behind.
 * Only the handful of calls whose RETURN VALUE the engine actually reads are
 * given real behaviour below.
 *
 * WHAT THIS DELIBERATELY CANNOT DO.
 *
 * It draws nothing. No pixel produced here means anything, so no test built on
 * it may assert about appearance — brightness, colour, position on screen. It
 * exists to let the engine's STATE be exercised: which memories are present on
 * a wall, which are active, where the layout put them. That is the class of
 * bug it is meant to catch, and it is honest about being no wider than that.
 */

interface StubStats {
  /** every method name the code under test actually called, for diagnosis */
  readonly calls: Map<string, number>;
}

const GRADIENT = {
  addColorStop: () => undefined,
};

const PATTERN = {
  setTransform: () => undefined,
};

function makeContext(canvas: HTMLCanvasElement, stats: StubStats): unknown {
  /* Properties the engine writes and sometimes reads back (fillStyle,
     globalAlpha, font, …). A plain bag preserves round-trips. */
  const props: Record<string, unknown> = {
    canvas,
    fillStyle: "#000",
    strokeStyle: "#000",
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    filter: "none",
    shadowBlur: 0,
    shadowColor: "transparent",
    imageSmoothingEnabled: true,
  };

  const returns: Record<string, (...args: never[]) => unknown> = {
    createRadialGradient: () => GRADIENT,
    createLinearGradient: () => GRADIENT,
    createConicGradient: () => GRADIENT,
    createPattern: () => PATTERN,
    /* Sized from the request so callers that index into `data` stay in
       bounds. Zeroed: nothing was drawn, and pretending otherwise would
       invite an appearance assertion this stub cannot honour. */
    getImageData: (...args: never[]) => {
      const w = Math.max(1, Math.round(Number(args[2]) || 1));
      const h = Math.max(1, Math.round(Number(args[3]) || 1));
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    },
    createImageData: (...args: never[]) => {
      const w = Math.max(1, Math.round(Number(args[0]) || 1));
      const h = Math.max(1, Math.round(Number(args[1]) || 1));
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    },
    measureText: (...args: never[]) => ({
      /* a plausible advance, so text-fitting maths does not divide by zero */
      width: String(args[0] ?? "").length * 6,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
    }),
    isPointInPath: () => false,
    isPointInStroke: () => false,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    getLineDash: () => [],
  };

  return new Proxy(props, {
    get(target, key: string) {
      if (key in target) return target[key];
      const special = returns[key];
      if (special) {
        return (...args: never[]) => {
          stats.calls.set(key, (stats.calls.get(key) ?? 0) + 1);
          return special(...args);
        };
      }
      /* everything else: a no-op that records it happened */
      return (...__args: unknown[]) => {
        stats.calls.set(key, (stats.calls.get(key) ?? 0) + 1);
        return undefined;
      };
    },
    set(target, key: string, value) {
      target[key] = value;
      return true;
    },
  });
}

/**
 * Install the stub for the whole process. Idempotent: calling it twice leaves
 * one stub in place rather than wrapping a wrapper.
 */
export function installCanvasStub(): StubStats {
  const stats: StubStats = { calls: new Map() };
  const proto = globalThis.HTMLCanvasElement?.prototype;
  if (!proto) throw new Error("installCanvasStub needs a DOM — set @vitest-environment jsdom");

  const marker = "__wakaStubbed";
  if ((proto as unknown as Record<string, unknown>)[marker]) return stats;
  (proto as unknown as Record<string, unknown>)[marker] = true;

  const contexts = new WeakMap<HTMLCanvasElement, unknown>();
  proto.getContext = function getContext(this: HTMLCanvasElement, kind: string) {
    if (kind !== "2d") return null;
    let ctx = contexts.get(this);
    if (!ctx) {
      ctx = makeContext(this, stats);
      contexts.set(this, ctx);
    }
    return ctx as CanvasRenderingContext2D;
  } as HTMLCanvasElement["getContext"];

  /* Read back by the grain tile, which turns generated noise into a data URI.
     jsdom throws "not implemented" without this. */
  proto.toDataURL = () => "data:image/png;base64,";

  return stats;
}

/**
 * jsdom reports every element as zero-sized, and the world sizes itself from
 * `root.getBoundingClientRect()` — so without this the field lays out into a
 * one-pixel band and every count is a lie. Sets a viewport for the whole
 * document; call before mounting.
 */
export function setViewport(width: number, height: number): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1 });

  /*
   * The parts of a browser jsdom leaves out that the world actually asks for.
   *
   * `matchMedia` is not decoration here: the loop reads
   * `(prefers-reduced-motion: reduce)` on its first line and branches the whole
   * arrival behaviour on it. Answering `matches: false` means the tests
   * exercise the MOVING path — the pour, the travel ease — which is the one
   * where the activation bug lived. A stub that said `true` would take the
   * `settleInstantly` shortcut and quietly test the easier half.
   */
  if (typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
  }

  if (typeof globalThis.ResizeObserver !== "function") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }

  if (typeof Element.prototype.setPointerCapture !== "function") {
    Element.prototype.setPointerCapture = () => undefined;
    Element.prototype.releasePointerCapture = () => undefined;
    Element.prototype.hasPointerCapture = () => false;
  }
  if (typeof Element.prototype.scrollIntoView !== "function") {
    Element.prototype.scrollIntoView = () => undefined;
  }

  Element.prototype.getBoundingClientRect = function rect(this: Element) {
    /* The root is the viewport. Everything else reports the same box, which is
       enough for the chrome measurements the engine takes (it only ever reads
       widths and heights, never positions, from these). */
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    } as DOMRect;
  };
}
