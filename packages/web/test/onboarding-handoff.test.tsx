// @vitest-environment jsdom
/**
 * THE HANDOFF AFTER A SAVE, AND THE ONE CREATURE ACROSS EVERY STEP.
 *
 * After each Save: the answer is received (inputs locked), the bubble says
 * "Saved" as the next dot fills, then the next question is asked. A failed
 * save says why and keeps the answer. And however many screens onboarding
 * passes through, there is one creature, the same element, never two.
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
 * Also `window.matchMedia`, a browser API, set to reduced motion for the case
 * about it, and `getBoundingClientRect`, because jsdom lays nothing out and
 * the creature stands where its slot's box is.
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
  press("Save an inspiration");
  type(words);
  press("Save");
  await flush();
  await settle(1700);
}

const dots = () => container!.querySelectorAll(".onb-dot--on").length;
const bubble = () => container!.querySelector(".onb-ask-bubble")?.textContent ?? "";
const ways = () => [...container!.querySelectorAll<HTMLButtonElement>(".onb-choice")];
const tick = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); await flush(); };

function reducedMotion(on: boolean): void {
  Object.defineProperty(window, "matchMedia", { configurable: true,
    value: (query: string) => ({ matches: on && query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} }) });
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("waka.onboarding:acc-1", JSON.stringify({ named: true, introSeen: true }));
  saved = 0;
  reducedMotion(false);
  vi.mocked(fetchCurrentViewer).mockResolvedValue(viewer());
  vi.mocked(updateAuthProfile).mockImplementation(async (input) => viewer({ done: input.completeOnboarding ? "2026-11-08T00:00:00.000Z" : null }));
  vi.mocked(fetchInspirationSnapshot).mockImplementation(async () => ({ profileId: "prof-1", total: saved, fingerprint: null }));
  vi.mocked(fetchInspirationPage).mockResolvedValue({ inspirations: [3, 2, 1].map((n) => ({ id: `insp-${n}`, textPreview: `Answer ${n}`, attachmentSummary: [] })) as never });
  vi.mocked(createInspiration).mockImplementation(async (input) => {
    saved += 1;
    return { id: `insp-${saved}`, profileId: "prof-1", text: input.text, kind: "note", source: "app" } as never;
  });
  vi.mocked(requestFirstRead).mockResolvedValue("A read.");
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null; container = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

async function writeAndSave(words: string): Promise<void> {
  press("Save an inspiration");
  type(words);
  press("Save");
  await flush();
}

describe("the handoff after a save", () => {
  it("receives, says Saved as the next dot fills, then asks the next — locked throughout", async () => {
    await render();
    vi.useFakeTimers();
    expect(bubble()).toContain("Tell me one thing");
    expect(dots()).toBe(1);
    await writeAndSave("The guy who quit to make furniture");

    /* receive: still the first question, nothing pressable */
    expect(createInspiration).toHaveBeenCalledTimes(1);
    expect(bubble()).toContain("Tell me one thing");
    expect(ways().every((way) => way.disabled)).toBe(true);
    expect(container!.querySelector("textarea")).toBeNull();

    /* kept */
    await tick(500);
    expect(bubble()).toBe("Saved");
    expect(dots()).toBe(2);
    expect(ways().every((way) => way.disabled)).toBe(true);

    /* ask */
    /* Kept is home's bubble, hugging one word: nothing else is in it */
    expect(container!.querySelector(".onb-ask-bubble")!.classList.contains("jar-char-bubble-body")).toBe(true);
    expect(container!.querySelector(".onb-ask-bubble .onb-say-soft")).toBeNull();
    await tick(900);
    expect(bubble()).toContain("Tell me about a conversation you keep thinking about.");
    expect(dots()).toBe(2);
    expect(ways().every((way) => way.disabled)).toBe(true);
    await tick(300);
    expect(ways().every((way) => !way.disabled)).toBe(true);
    expect(createInspiration).toHaveBeenCalledTimes(1);
  });

  it("never says Saved when the save fails, and keeps the answer to try again", async () => {
    vi.mocked(createInspiration).mockRejectedValueOnce(new Error("offline"));
    await render();
    vi.useFakeTimers();
    await writeAndSave("Kept words");
    await tick(1500);
    expect(bubble()).not.toContain("Saved");
    expect(bubble()).toContain("Tell me one thing");
    expect(container!.querySelector("[role=alert]")?.textContent).toBeTruthy();
    expect(container!.querySelector("textarea")!.value).toBe("Kept words");
    press("Save");
    await flush();
    const ids = vi.mocked(createInspiration).mock.calls.map(([, options]) => options?.requestId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  it("under reduced motion says Saved at once, then the next question", async () => {
    reducedMotion(true);
    await render();
    vi.useFakeTimers();
    await writeAndSave("One");
    await tick(0);
    expect(bubble()).toBe("Saved");
    await tick(700);
    expect(bubble()).toContain("Tell me about a conversation");
  });
});

describe("one creature", () => {
  it("is one element from the intro through the questions, never two", async () => {
    window.localStorage.setItem("waka.onboarding:acc-1", JSON.stringify({ named: true }));
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const slot = this.classList.contains("onb-slot");
      return { x: 10, y: 10, left: 10, top: 10, width: slot ? 116 : 0, height: slot ? 86 : 0, right: 126, bottom: 96, toJSON() { return {}; } } as DOMRect;
    });
    const page = await render();
    const creatures = () => page.querySelectorAll('[data-testid="onboarding-creature"]');
    expect(creatures()).toHaveLength(1);
    const first = creatures()[0];
    for (let beat = 0; beat < 3; beat += 1) {
      press("Next");
      await flush();
      expect(creatures()).toHaveLength(1);
      expect(creatures()[0]).toBe(first);
    }
    press("Start");
    await settle(400);
    expect(page.textContent).toContain("Tell me one thing");
    expect(creatures()).toHaveLength(1);
    expect(creatures()[0]).toBe(first);
    /* the walker in D is somebody else's and gone now; yours is the only body */
    expect(page.querySelectorAll(".waka-walking")).toHaveLength(0);
  });
});
