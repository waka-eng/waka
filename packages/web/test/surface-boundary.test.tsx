// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. No module is replaced — the
 * real `SurfaceBoundary` class renders, throws for real, catches for real,
 * and reads the real `sessionStorage`. There is no router, no auth context
 * and no server here because the boundary takes none of them.
 *
 * `window.location` IS swapped for an object carrying a spy `reload`, which
 * is an environment stub rather than a seam: jsdom refuses to navigate, and
 * whether `reload` was called is the entire thing under test. It is swapped
 * whole because jsdom makes `location.reload` non-configurable on its own. */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { SurfaceBoundary } from "../src/components/SurfaceBoundary";

/**
 * ═══ A STALE CHUNK RELOADS ONCE; A REAL BUG SHOWS THE SCREEN ═══
 *
 * On 2026-10-10 a dev server that had been up for fifty-four days was still
 * serving a dependency hash from before the imports changed. `react-dom.js`
 * 504'd, `Home.tsx` could not be dynamically imported, and the founder got
 * the error screen instead of their world — for a failure whose own fix,
 * reloading, this boundary already knew about and required a button press to
 * perform. Vite's native recovery is to force a reload; catching the
 * rejection replaced a self-healing refresh with a dead end.
 *
 * The header's standing rule is that this must not RETRY on its own, and it
 * still must not: re-mounting a failing chunk spins. Reloading the document
 * is a different act — it changes the inputs, which is the reasoning already
 * written on the retry button. These cases hold the three things that make
 * it safe.
 */
/* jsdom's `location.reload` is not configurable, so the whole object is
   swapped. Everything else on it is carried across, because the boundary
   reads nothing else and a half-built location would fail for the wrong
   reason. */
const trueLocation = window.location;
let reload: ReturnType<typeof vi.fn>;
let host: HTMLDivElement, root: Root;

function Boom({ message }: { message: string }): JSX.Element {
  throw new Error(message);
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear();
  reload = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { ...trueLocation, reload, assign: trueLocation.assign.bind(trueLocation) },
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  Object.defineProperty(window, "location", { configurable: true, writable: true, value: trueLocation });
  vi.restoreAllMocks();
});

const mount = async (node: JSX.Element) => act(async () => root.render(node));

it("reloads once when the screen's own code could not be fetched", async () => {
  /* THE FOUNDER'S FAILURE, VERBATIM: this is the message Vite produces when
     an optimised dependency 504s underneath a lazy page. */
  await mount(
    <SurfaceBoundary surface="the world">
      <Boom message="Failed to fetch dynamically imported module: http://localhost:5173/src/pages/Home.tsx" />
    </SurfaceBoundary>,
  );
  expect(reload, "a stale chunk still dead-ends instead of reloading").toHaveBeenCalledOnce();
});

it("shows the screen the second time, so it cannot spin", async () => {
  /* THE GUARD, WHICH IS THE WHOLE LICENCE FOR THE BEHAVIOUR ABOVE. The
     header forbids a boundary that retries itself because it spins; this is
     the assertion that it does not. A reload that did not fix the problem
     hands the person the screen and the button. */
  sessionStorage.setItem("waka:surface-reloaded", "1");
  await mount(
    <SurfaceBoundary surface="the world">
      <Boom message="Failed to fetch dynamically imported module: /src/pages/Home.tsx" />
    </SurfaceBoundary>,
  );
  expect(reload).not.toHaveBeenCalled();
  expect(host.textContent).toContain("didn’t load");
});

it("does not reload for a bug in the screen's own code", async () => {
  /* RELOADING WOULD REPRODUCE IT. A render error is not a stale file, and
     the person would watch the screen flicker and come back to it — which is
     worse than being told, because it looks like the product is failing to
     start rather than failing at something nameable. */
  await mount(
    <SurfaceBoundary surface="the world">
      <Boom message="Cannot read properties of undefined (reading 'length')" />
    </SurfaceBoundary>,
  );
  expect(reload).not.toHaveBeenCalled();
  expect(host.textContent).toContain("didn’t load");
});

it("clears the guard once a screen mounts, so the next stale chunk gets its own attempt", async () => {
  /* ONE RELOAD PER FAILURE, NOT ONE PER SESSION. Tying the reset to a
     successful mount rather than to a timer is what keeps those different. */
  sessionStorage.setItem("waka:surface-reloaded", "1");
  await mount(
    <SurfaceBoundary surface="the world">
      <p>the world</p>
    </SurfaceBoundary>,
  );
  expect(sessionStorage.getItem("waka:surface-reloaded")).toBeNull();
});
