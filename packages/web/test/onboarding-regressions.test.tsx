// @vitest-environment jsdom
/**
 * TWO ONBOARDING BUGS A REVIEW FOUND, HELD SHUT.
 *
 *   A replaced photo must upload itself — not ride the receipt of the photo it
 *   replaced, after a save that failed.
 *   "Talk about this" must reach the chat under StrictMode, which renders the
 *   route guard twice: where onboarding is going is read, never consumed,
 *   during render.
 *
 * WHAT THIS MOCKS, AND WHY: `lib/api` — the HTTP client, the layer directly
 * under the page and the auth provider (the real module is spread back in so
 * `ApiError` stays the product's own class), and `lib/api/conversations`, the
 * same client's conversation module, which Talk about this writes through.
 * `lib/first-read`'s
 * `requestFirstRead`, because the read's own ordering is asserted in
 * `onboarding-progress.test.ts` and here only its OUTCOME matters: a read,
 * or none in time. `presignAttachment` and `uploadToPresignedUrl` are the same
 * `lib/api` client's upload calls, answered with a fresh key per upload. Left real: `AuthProvider`, `RequireAuth`, the router, the
 * page and every control, which a test presses (Law 8).
 */
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RequireAuth } from "../src/components/RequireAuth";
import {
  createInspiration,
  fetchCurrentViewer,
  presignAttachment,
  uploadToPresignedUrl,
  fetchInspirationPage,
  fetchInspirationSnapshot,
  updateAuthProfile,
  type ApiViewer,
} from "../src/lib/api";
import { requestFirstRead } from "../src/lib/first-read";
import { createConversation } from "../src/lib/api/conversations";
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
    presignAttachment: vi.fn(),
    uploadToPresignedUrl: vi.fn(),
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
      <StrictMode><MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <Routes>
            <Route path="/onboarding" element={<RequireAuth><OnboardingPage /></RequireAuth>} />
            <Route path="/" element={<RequireAuth><main>HOME</main></RequireAuth>} />
            <Route path="/chat/:id" element={<RequireAuth><main>CHAT</main></RequireAuth>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter></StrictMode>,
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


/* The smallest real PNG: the photo check reads the bytes, not the name. */
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
const photo = (name: string) => new File([PNG], name, { type: "image/png" });

async function choosePhoto(file: File): Promise<void> {
  const input = container!.querySelector<HTMLInputElement>('[data-testid="onboarding-photo-input"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await flush();
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("waka.onboarding:acc-1", JSON.stringify({ named: true, introSeen: true }));
  saved = 0;
  let current = viewer();
  vi.mocked(fetchCurrentViewer).mockImplementation(async () => current);
  vi.mocked(updateAuthProfile).mockImplementation(async (input) => {
    current = viewer({ name: input.name, done: input.completeOnboarding ? "2026-11-08T00:00:00.000Z" : current.account.onboardingCompletedAt });
    return current;
  });
  vi.mocked(fetchInspirationSnapshot).mockImplementation(async () => ({ profileId: "prof-1", total: saved, fingerprint: null }));
  vi.mocked(fetchInspirationPage).mockResolvedValue({ inspirations: [] });
  let uploads = 0;
  vi.mocked(presignAttachment).mockImplementation(async () => { uploads += 1; return { uploadUrl: "https://bucket.invalid/put", key: `key-${uploads}`, headers: {}, profileId: "prof-1" } as never; });
  vi.mocked(uploadToPresignedUrl).mockResolvedValue(undefined);
  vi.mocked(createInspiration).mockImplementation(async (input) => {
    saved += 1;
    return { id: `insp-${saved}`, profileId: "prof-1", text: input.text, kind: input.kind ?? "note", source: "app" } as never;
  });
  vi.mocked(requestFirstRead).mockResolvedValue("A read across the three.");
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null; container = null;
  vi.clearAllMocks();
});

describe("a replaced photo", () => {
  it("uploads itself after a failed save, rather than reusing the old photo's receipt", async () => {
    await render();
    await choosePhoto(photo("first.png"));
    vi.mocked(createInspiration).mockRejectedValueOnce(new Error("offline"));
    press("Save");
    await flush();
    expect(container!.querySelector("[role=status].onb-error, .onb-error")).not.toBeNull();
    press("Remove photo");
    await flush();
    await choosePhoto(photo("second.png"));
    press("Save");
    await flush();
    const calls = vi.mocked(createInspiration).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]![0].attachments?.[0]).toMatchObject({ key: "key-1" });
    expect(calls[1]![0].attachments?.[0]).toMatchObject({ key: "key-2" });
  });
});

describe("Talk about this under StrictMode", () => {
  it("lands in the chat, not at home", async () => {
    saved = 3;
    const page = await render();
    press("Talk about this");
    await settle(500);
    expect(page.textContent).toContain("CHAT");
  });
});

describe("naming, when this browser keeps nothing", () => {
  it("moves on to the intro instead of asking the name again forever", async () => {
    window.localStorage.clear();
    vi.mocked(fetchCurrentViewer).mockResolvedValue(viewer({ name: "" }));
    vi.mocked(updateAuthProfile).mockResolvedValue(viewer({ name: "Mina" }));
    const blocked = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
    try {
    const page = await render();
    const input = page.querySelector<HTMLInputElement>('input[name="name"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => { setter.call(input, "Mina"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { page.querySelector("form")!.requestSubmit(); });
    await flush();
    expect(page.querySelector('input[name="name"]')).toBeNull();
    expect(page.textContent).toContain("How many notes have you saved and never looked at again?");
    } finally { blocked.mockRestore(); }
  });
});

describe("Talk about this, retried after the finish failed", () => {
  it("opens one conversation, not two", async () => {
    saved = 3;
    const page = await render();
    vi.mocked(updateAuthProfile).mockRejectedValueOnce(new Error("offline"));
    press("Talk about this");
    await settle(500);
    expect(page.textContent).not.toContain("CHAT");
    press("Talk about this");
    await settle(500);
    expect(page.textContent).toContain("CHAT");
    expect(vi.mocked(createConversation)).toHaveBeenCalledTimes(1);
  });
});

describe("a share that arrived before onboarding", () => {
  it("is still waiting, freshly, when onboarding hands over to home", async () => {
    saved = 3;
    const began = Date.now();
    const stale = began - 9 * 60 * 1000;
    sessionStorage.setItem("waka:shared", JSON.stringify({ title: "", text: "Words shared from a page", url: "", via: "share", at: stale }));
    try {
      const page = await render();
      press("Continue");
      await settle(500);
      expect(page.textContent).toContain("HOME");
      const waiting = JSON.parse(sessionStorage.getItem("waka:shared") ?? "null");
      expect(waiting?.text).toBe("Words shared from a page");
      expect(waiting?.at).toBeGreaterThanOrEqual(began);
    } finally { sessionStorage.clear(); }
  });
});
