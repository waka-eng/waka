// @vitest-environment jsdom
/**
 * TRY AGAIN ON "YOUR HOME DIDN'T LOAD" ASKS FOR EVERYTHING THE FAILURE TOOK.
 *
 * The failed-load screen's Try again re-read the field only; the sky (the
 * patterns) and the agent roster stayed whatever the failed first load left,
 * usually empty. One press now asks for all three.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/data` (via `dataMockFrom`) with
 * `loadInspirations` failing as a dead connection first and `loadSignals` a
 * spy — the seam Home reads its world through. `lib/api` (via `apiMockFrom`)
 * with `fetchProfiles` a spy, the roster's seam. `lib/fixture/offline-home`
 * answers null, as it does in every build but dev, so the failure screen is
 * what renders rather than the dev fixture. `lib/auth-context` states the
 * owner. `helpers/canvas-stub` replaces drawing and time; `helpers/render-home`
 * supplies the two mock factories (not `mountWorld`, which refuses a page
 * that is not the real world, and this one is the failure screen).
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, expect, it, vi } from "vitest";
import { installCanvasStub, setViewport } from "./helpers/canvas-stub";
import { apiMockFrom, dataMockFrom } from "./helpers/render-home";
import { ApiError } from "../src/lib/api/http";

const facts = vi.hoisted(() => ({ inspirations: [{ id: "own-0", text: "something I kept", daysAgo: 1 }], groups: [] }));
const state = vi.hoisted(() => ({ archiveDown: true }));
vi.mock("../src/lib/fixture/offline-home", async (original) => ({ ...await original<typeof import("../src/lib/fixture/offline-home")>(), offlineHome: () => null }));
vi.mock("../src/lib/data", async (original) => {
  const honest = dataMockFrom(facts);
  return { ...await original<typeof import("../src/lib/data")>(), ...honest,
    loadInspirations: async (...args: unknown[]) => {
      if (state.archiveDown) throw new ApiError({ status: 0, message: "unreachable" });
      return (honest.loadInspirations as (...a: unknown[]) => unknown)(...args);
    },
    loadSignals: vi.fn(async () => []) };
});
vi.mock("../src/lib/api", async (original) => ({ ...await original<typeof import("../src/lib/api")>(), ...apiMockFrom(facts), fetchProfiles: vi.fn(async () => []) }));
vi.mock("../src/lib/auth-context", async (original) => ({ ...await original<typeof import("../src/lib/auth-context")>(),
  useOptionalAuth: () => ({ status: "authenticated", isAuthenticated: false, account: { id: "owner", email: "owner@example.test" }, profile: { id: "profile-viewer", name: "Owner", type: "human" }, profiles: [] }) }));
import { loadSignals } from "../src/lib/data";
import { fetchProfiles } from "../src/lib/api";

beforeAll(() => { installCanvasStub(); setViewport(1280, 900); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

it("re-reads the field, the sky and the agent roster on one Try again", async () => {
  const { default: HomePage } = await import("../src/pages/Home");
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await act(async () => root.render(createElement(MemoryRouter, null, createElement(HomePage))));
    for (let i = 0; i < 5; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(host.textContent).toContain("Your home didn’t load.");
    const sky = vi.mocked(loadSignals).mock.calls.length;
    const roster = vi.mocked(fetchProfiles).mock.calls.length;
    state.archiveDown = false;
    const retry = [...host.querySelectorAll("button")].find((button) => button.textContent === "Try again")!;
    await act(async () => retry.click());
    expect(vi.mocked(loadSignals).mock.calls.length, "Try again left the sky as the failure left it").toBeGreaterThan(sky);
    expect(vi.mocked(fetchProfiles).mock.calls.length, "Try again left the agent roster as the failure left it").toBeGreaterThan(roster);
  } finally {
    act(() => root.unmount()); host.remove(); error.mockRestore();
  }
});
