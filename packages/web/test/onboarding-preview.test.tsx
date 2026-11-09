// @vitest-environment jsdom
/**
 * THE DEV-ONLY ONBOARDING PREVIEW (`/onboarding?preview=1`): on a dev server
 * an onboarded account can walk every step, and nothing is saved or stamped;
 * in a production build the parameter does nothing.
 *
 * WHAT THIS MOCKS, AND WHY: `lib/api` — the HTTP client, the layer directly
 * under the page and the auth provider (the real module is spread back in so
 * `ApiError` stays the product's own class), and `lib/api/conversations`, the
 * same client's conversation module, which Talk about this writes through.
 * And `DEV` (`import.meta.env.DEV`), stubbed per case with `vi.stubEnv`, which
 * is how a production build is stood in for: there it is false at build time.
 * `lib/first-read`'s
 * `requestFirstRead`, because the read's own ordering is asserted in
 * `onboarding-progress.test.ts` and here only its OUTCOME matters: a read,
 * or none in time. Left real: `AuthProvider`, `RequireAuth`, the router, the
 * page and every control, which a test presses (Law 8).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RequireAuth } from "../src/components/RequireAuth";
import {
  createInspiration,
  fetchCurrentViewer,
  fetchInspirationPage,
  fetchInspirationSnapshot,
  updateAuthProfile,
  type ApiViewer,
} from "../src/lib/api";
import { requestFirstRead } from "../src/lib/first-read";
import { AuthProvider } from "../src/lib/auth-context";
import OnboardingPage from "../src/pages/Onboarding";
import { onboardingPreviewRequested } from "../src/lib/onboarding-preview";

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return {
    ...actual,
    fetchCurrentViewer: vi.fn(),
    updateAuthProfile: vi.fn(),
    fetchInspirationSnapshot: vi.fn(),
    fetchInspirationPage: vi.fn(),
    createInspiration: vi.fn(),
  };
});
vi.mock("../src/lib/api/conversations", () => ({ createConversation: vi.fn(async () => ({})) }));
vi.mock("../src/lib/first-read", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/lib/first-read")>(),
  requestFirstRead: vi.fn(),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function viewer(input: { name?: string; done?: string | null } = {}): ApiViewer {
  return {
    account: { id: "acc-1", email: "mina@example.test", onboardingCompletedAt: input.done ?? null, isAdmin: false },
    profile: {
      id: "prof-1", accountId: "acc-1", type: "human", name: input.name ?? "Mina", avatarUrl: null,
      preferredLocale: "en-US", publicHandle: null, publicProfileEnabled: false, publicTopOfMindEnabled: false,
    },
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let saved = 0;

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); });
}

async function render(path = "/onboarding"): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <Routes>
            <Route path="/onboarding" element={<RequireAuth><OnboardingPage /></RequireAuth>} />
            <Route path="/" element={<RequireAuth><main>HOME</main></RequireAuth>} />
            <Route path="/chat/:id" element={<RequireAuth><main>CHAT</main></RequireAuth>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
  });
  await flush();
  return container;
}

function press(label: string): void {
  const button = [...container!.querySelectorAll("button")].find((node) =>
    node.textContent?.trim() === label || node.getAttribute("aria-label") === label);
  if (!button) throw new Error(`No control named ${label}: ${container!.textContent}`);
  act(() => { button.click(); });
}

function type(words: string): void {
  const area = container!.querySelector("textarea")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => { setter.call(area, words); area.dispatchEvent(new Event("input", { bubbles: true })); });
}

/* Real time, for the beats onboarding stages on purpose: the intro steps
   aside before the questions, an answer is handed to the creature before
   the next is asked, and the scene fades before home. Generous on purpose —
   the suite asserts order, not timing. */
async function settle(ms: number): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
  await flush();
}

async function answer(words: string): Promise<void> {
  press("Write");
  type(words);
  press("Save");
  await flush();
  await settle(2200);
}

const completions = () => vi.mocked(updateAuthProfile).mock.calls.filter(([input]) => input.completeOnboarding === true);
const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

beforeEach(() => {
  window.localStorage.clear();
  saved = 0;
  vi.mocked(fetchCurrentViewer).mockResolvedValue(viewer({ done: "2026-01-01T00:00:00.000Z" }));
  vi.mocked(fetchInspirationSnapshot).mockResolvedValue({ profileId: "prof-1", total: 7, fingerprint: null });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null; container = null;
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("onboardingPreviewRequested", () => {
  it("answers only on a dev server, and only to preview=1", () => {
    expect(onboardingPreviewRequested("?preview=1", true)).toBe(true);
    expect(onboardingPreviewRequested("?preview=0", true)).toBe(false);
    expect(onboardingPreviewRequested("", true)).toBe(false);
    expect(onboardingPreviewRequested("?preview=1", false)).toBe(false);
  });
});

describe("the preview in a production build", () => {
  it("does nothing: an onboarded account is sent home as always", async () => {
    vi.stubEnv("DEV", false);
    const page = await render("/onboarding?preview=1");
    expect(page.textContent).toContain("HOME");
    expect(page.textContent).not.toContain("Preview");
  });
});

describe("the preview on a dev server", () => {
  beforeEach(() => { vi.stubEnv("DEV", true); });

  it("walks an onboarded account through every step and saves nothing", async () => {
    const page = await render("/onboarding?preview=1");
    expect(page.querySelector(".onb-preview-mark")?.textContent).toBe("Preview");
    expect(page.textContent).toContain("How many notes have you saved and never looked at again?");
    expect(fetchInspirationSnapshot).not.toHaveBeenCalled();
    for (let i = 0; i < 3; i += 1) press("Next");
    press("Start");
    await settle(400);
    for (const words of ["One", "Two", "Three"]) {
      press("Write");
      type(words);
      press("Save");
      await wait(2700);
      await flush();
    }
    expect(page.textContent).toContain("Reading your three…");
    await wait(2600);
    await flush();
    expect(page.textContent).toContain("An early read");
    press("Why?");
    expect(page.textContent).toContain("Three");
    expect(createInspiration).not.toHaveBeenCalled();
    press("Talk about this");
    await settle(400);
    expect(page.textContent).toContain("HOME");
    expect(completions()).toHaveLength(0);
    expect(updateAuthProfile).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("waka.onboarding:acc-1")).toBeNull();
  });
});
