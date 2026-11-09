// @vitest-environment jsdom
/**
 * A SHARE SURVIVES THE DOOR. Something shared to WAKA by a signed-out (or
 * still-onboarding) visitor is handed over before sign-in, not carried in the
 * address — an address past 2048 characters is dropped by the sign-in return
 * path, and a bookmarklet's selection is easily that long.
 *
 * WHAT THIS MOCKS, AND WHY: `lib/api` — the HTTP client under the auth
 * provider — so the visitor can be signed out. `sessionStorage` is the
 * browser's own and is read back directly. Left real: `ShareArrival`, the
 * route guard and the router, as `main.tsx` arranges them.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

import { RequireAuth } from "../src/components/RequireAuth";
import { SHARED_KEY, ShareArrival } from "../src/components/ShareArrival";
import { fetchCurrentViewer } from "../src/lib/api";
import { AuthProvider } from "../src/lib/auth-context";

vi.mock("../src/lib/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/lib/api")>(),
  fetchCurrentViewer: vi.fn(async () => null),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  sessionStorage.clear();
  vi.clearAllMocks();
});

it("keeps a long share from a signed-out visitor through the way to sign-in", async () => {
  vi.mocked(fetchCurrentViewer).mockResolvedValue(null);
  const words = "오래 기억하고 싶은 문장. ".repeat(300);
  const path = `/share?text=${encodeURIComponent(words)}&url=${encodeURIComponent("https://example.test/a")}&via=bookmarklet`;
  expect(path.length).toBeGreaterThan(2048);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <Routes>
            <Route path="/share" element={<ShareArrival />} />
            <Route path="/login" element={<main>LOGIN</main>} />
            <Route path="/" element={<RequireAuth><main>HOME</main></RequireAuth>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
  });
  for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); });
  expect(host.textContent).toContain("LOGIN");
  const kept = JSON.parse(sessionStorage.getItem(SHARED_KEY) ?? "null");
  expect(kept?.text).toBe(words.slice(0, 20000));
  expect(kept?.via).toBe("bookmarklet");
});

it("is how main.tsx serves /share: in front of the sign-in gate, not behind it", async () => {
  const { readFileSync } = await import("node:fs");
  const { resolve, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const main = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../src/main.tsx"), "utf8");
  expect(main).toMatch(/path="\/share" element=\{<ShareArrival \/>\}/);
});
