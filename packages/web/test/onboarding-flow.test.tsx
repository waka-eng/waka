// @vitest-environment jsdom
/**
 * ONBOARDING, END TO END IN THE BROWSER LAYER: the gate, resuming, the three
 * saves, and going in when the read is slow.
 *
 * WHAT THIS MOCKS, AND WHY: `lib/api` — the HTTP client, the layer directly
 * under the page and the auth provider (the real module is spread back in so
 * `ApiError` stays the product's own class), and `lib/api/conversations`, the
 * same client's conversation module, which Talk about this writes through.
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
import OnboardingPage, { FIRST_READ_PATIENCE_MS } from "../src/pages/Onboarding";

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
  await settle(1700);
}

const completions = () => vi.mocked(updateAuthProfile).mock.calls.filter(([input]) => input.completeOnboarding === true);

beforeEach(() => {
  window.localStorage.clear();
  saved = 0;
  let current = viewer();
  vi.mocked(fetchCurrentViewer).mockImplementation(async () => current);
  vi.mocked(updateAuthProfile).mockImplementation(async (input) => {
    current = viewer({ name: input.name, done: input.completeOnboarding ? "2026-11-08T00:00:00.000Z" : current.account.onboardingCompletedAt });
    return current;
  });
  vi.mocked(fetchInspirationSnapshot).mockImplementation(async () => ({ profileId: "prof-1", total: saved, fingerprint: null }));
  vi.mocked(fetchInspirationPage).mockResolvedValue({ inspirations: [] });
  vi.mocked(createInspiration).mockImplementation(async (input) => {
    saved += 1;
    return { id: `insp-${saved}`, profileId: "prof-1", text: input.text, kind: input.kind ?? "note", source: "app" } as never;
  });
  vi.mocked(requestFirstRead).mockResolvedValue("You keep choosing slow mornings over the right rooms.");
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null; container = null;
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("the onboarding gate", () => {
  it("sends an unfinished account to onboarding and a finished one past it", async () => {
    let page = await render("/");
    expect(page.textContent).not.toContain("HOME");
    act(() => root?.unmount()); container?.remove();

    vi.mocked(fetchCurrentViewer).mockResolvedValue(viewer({ done: "2026-01-01T00:00:00.000Z" }));
    page = await render("/onboarding");
    expect(page.textContent).toContain("HOME");
  });

  it("confirms the name without finishing onboarding, then shows the intro", async () => {
    vi.mocked(fetchCurrentViewer).mockResolvedValue(viewer({ name: "" }));
    const page = await render();
    const input = page.querySelector<HTMLInputElement>('input[name="name"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => { setter.call(input, "Mina"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { page.querySelector("form")!.requestSubmit(); });
    await flush();
    expect(vi.mocked(updateAuthProfile).mock.calls[0]![0]).toEqual({ name: "Mina", preferredLocale: "en-US" });
    expect(page.textContent).toContain("How many notes have you saved and never looked at again?");
    for (let i = 0; i < 3; i += 1) press("Next");
    press("Start");
    await settle(400);
    expect(page.textContent).toContain("Share one thing that’s stuck with you lately.");
    expect(completions()).toHaveLength(0);
  });
});

describe("resuming", () => {
  it("opens on the third question when two answers are already saved", async () => {
    saved = 2;
    const page = await render();
    expect(page.textContent).toContain("Share something you want more of in your life.");
    expect(page.textContent).not.toContain("How many notes");
  });

  it("skips the name and intro this browser already passed", async () => {
    window.localStorage.setItem("waka.onboarding:acc-1", JSON.stringify({ named: true, introSeen: true }));
    const page = await render();
    expect(page.textContent).toContain("Share one thing that’s stuck with you lately.");
  });
});

describe("three saves, then the first read", () => {
  beforeEach(() => {
    window.localStorage.setItem("waka.onboarding:acc-1", JSON.stringify({ named: true, introSeen: true }));
  });

  it("saves each answer as an inspiration, reads across them, and finishes only on leaving", async () => {
    const page = await render();
    await answer("The guy who quit to make furniture");
    expect(page.textContent).toContain("Share a conversation you keep thinking about.");
    await answer("My sister saying she finally sleeps");
    expect(page.textContent).toContain("Share something you want more of in your life.");
    expect(completions()).toHaveLength(0);
    await answer("Slow mornings with no plan");

    const inputs = vi.mocked(createInspiration).mock.calls;
    expect(inputs.map(([input]) => input.text)).toEqual([
      "The guy who quit to make furniture", "My sister saying she finally sleeps", "Slow mornings with no plan",
    ]);
    expect(inputs.every(([input]) => input.kind === "note" && input.source === "app")).toBe(true);
    expect(new Set(inputs.map(([, options]) => options?.requestId)).size).toBe(3);
    expect(vi.mocked(requestFirstRead)).toHaveBeenCalledWith("prof-1", ["insp-1", "insp-2", "insp-3"]);

    expect(page.textContent).toContain("An early read");
    expect(page.textContent).toContain("You keep choosing slow mornings over the right rooms.");
    expect(page.textContent).not.toMatch(/\d/);
    expect(completions()).toHaveLength(0);

    press("Why?");
    expect(page.textContent).toContain("My sister saying she finally sleeps");

    press("Continue");
    await settle(400);
    expect(completions()).toHaveLength(1);
    expect(page.textContent).toContain("HOME");
    expect(window.localStorage.getItem("waka.onboarding:acc-1")).toBeNull();
  });

  it("does not let Save press with nothing written", async () => {
    const page = await render();
    press("Write");
    const save = [...page.querySelectorAll("button")].find((node) => node.textContent === "Save")!;
    expect(save.disabled).toBe(true);
  });

  it("opens a conversation about the read from Talk about this", async () => {
    saved = 3;
    const page = await render();
    press("Talk about this");
    await settle(400);
    expect(completions()).toHaveLength(1);
    expect(page.textContent).toContain("CHAT");
  });

  it("goes into home when the read is not back in time", async () => {
    saved = 3;
    vi.mocked(requestFirstRead).mockReturnValue(new Promise(() => {}));
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const page = await render();
    expect(page.textContent).toContain("Reading your three…");
    expect(completions()).toHaveLength(0);
    await act(async () => { vi.advanceTimersByTime(FIRST_READ_PATIENCE_MS); });
    await flush();
    await act(async () => { vi.advanceTimersByTime(400); });
    await flush();
    expect(completions()).toHaveLength(1);
    expect(page.textContent).toContain("HOME");
  });
});
