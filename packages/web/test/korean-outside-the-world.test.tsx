// @vitest-environment jsdom

/**
 * KOREAN ON THE TWO SURFACES THE MOUNTED WORLD CANNOT REACH.
 *
 * `the-world-in-korean.test.tsx` states a limit about itself: it mounts
 * `Home` with a Korean profile and sweeps what that world hands a person,
 * and there are exactly two surfaces it can never see from there.
 *
 *   `LoadingHome`   renders BEFORE the world exists — that is its whole job.
 *                   It cannot be reached from a mounted Home because a
 *                   mounted Home is the thing that replaces it.
 *   `PublicProfile` is a different route, `/@handle`, and the only
 *                   unauthenticated surface in the product. It takes its
 *                   language from the profile BEING READ rather than from a
 *                   viewer, because a stranger has no profile to read one
 *                   from. Nothing about Home's session reaches it.
 *
 * Both carried an English label until `7036a17`, and both were left held by
 * the source gate alone. A stated limit that nobody closes is a limit that
 * gets quoted back as coverage, so this closes it.
 *
 * THE LOADING SCREEN IS THE SHARPEST CASE IN THE PRODUCT. Its visible word
 * has read `불러오는 중` since the face shipped, three lines under an
 * `aria-label="loading"` that never did — the eye given Korean and the ear
 * given English, on one element, at the very first moment anybody sees the
 * product. So the case here is not "the label is Korean". It is that the
 * label and the word beneath it are THE SAME STRING. That is the shape the
 * bug had, and it is the shape a test should refuse.
 *
 * EVERY CASE HAS ITS ENGLISH TWIN. Each Korean assertion is paired with the
 * same render in `en-US` asserting the English. Alone, a Korean assertion
 * proves the string is Korean; it does not prove the surface is LISTENING.
 * A component that hardcoded `불러오는 중` would pass a Korean-only file
 * forever, and that is the same bug wearing the other language.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6).
 *
 *   `LoadingHome` — nothing, and that is a real answer. It reaches no
 *   network, no database and no clock; it reads one value out of
 *   `localStorage` through `readStoredLocale()`, and this file writes that
 *   value rather than replacing the reader. There is no seam to choose
 *   because there is no layer beneath it.
 *
 *   `lib/api` — for `PublicProfile` only, and here `lib/api` IS the right
 *   seam rather than the mistake gate G6 warns about. That warning is about
 *   the three layers, where `lib/data` sits above the client and the page
 *   answers a throw by showing the dev fixture. This page has no loader and
 *   no fixture: it calls `fetchPublicProfile` directly and renders an error
 *   line if it throws. `lib/data` is not in its path at all.
 *
 *   `lib/auth-context` — `PublicProfile` asks it only whether anyone is
 *   signed in, to choose between two words on one button. Replaced so the
 *   page renders without a provider; it supplies no language, because this
 *   surface takes its language from the profile it is showing.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LoadingHome } from "../src/components/LoadingHome";
import { LOCALE_STORAGE_KEY, type SupportedLocale } from "../src/lib/i18n";

const HANGUL = /[ㄱ-힝]/;

vi.mock("../src/lib/auth-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/auth-context")>();
  return { ...actual, useOptionalAuth: () => ({ isAuthenticated: false }) };
});

const PROFILE = (locale: SupportedLocale) => ({
  profile: { name: "윤지", handle: "yunji", preferredLocale: locale },
  topOfMind: {
    version: 1,
    publishedAt: "2026-09-01T00:00:00.000Z",
    entries: [
      { type: "belief", body: "무언가를 오래 생각하면 그것이 나를 바꾼다", belief: null, prompt: null, pinned: false },
      { type: "belief", body: "두 번째 문장", belief: null, prompt: null, pinned: false },
    ],
  },
});

const fetchPublicProfile = vi.fn();

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return { ...actual, fetchPublicProfile: (h: string) => fetchPublicProfile(h) };
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  try {
    window.localStorage.removeItem(LOCALE_STORAGE_KEY);
  } catch {
    /* a browser with storage shut off is a case the product handles, not this */
  }
});

function mount(node: React.ReactElement): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

/** Everything the surface is handing a person as words. */
function spoken(el: ParentNode): Array<{ where: string; attr: string; value: string }> {
  const out: Array<{ where: string; attr: string; value: string }> = [];
  for (const node of Array.from(el.querySelectorAll("*"))) {
    if (node.closest("[aria-hidden='true']")) continue;
    for (const attr of ["aria-label", "title", "placeholder", "alt"]) {
      const value = node.getAttribute(attr);
      if (!value || !value.trim()) continue;
      const cls = typeof node.className === "string" ? node.className.split(" ")[0] : "";
      out.push({ where: `${node.tagName.toLowerCase()}${cls ? "." + cls : ""}`, attr, value });
    }
  }
  return out;
}

describe("the loading screen, which renders before the world exists", () => {
  function render(locale: SupportedLocale): HTMLElement {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    const el = mount(<LoadingHome />);
    const status = el.querySelector<HTMLElement>('[role="status"]');
    if (!status) throw new Error("no `role=status` — the loading screen never rendered");
    return status;
  }

  it("says the same word to the ear as it shows to the eye, in Korean", () => {
    const status = render("ko-KR");
    const said = status.getAttribute("aria-label") ?? "";
    const shown = (status.textContent ?? "").trim();

    expect(shown, "the loading screen showed nothing — this case measured nothing").not.toBe("");
    expect(HANGUL.test(said), `the ear was given "${said}" on a Korean surface`).toBe(true);
    expect(said, "the label and the word beneath it must be one string, not two").toBe(shown);
  });

  it("and the same word in English, which is what proves it is listening", () => {
    const status = render("en-US");
    const said = status.getAttribute("aria-label") ?? "";
    const shown = (status.textContent ?? "").trim();

    expect(shown).not.toBe("");
    expect(HANGUL.test(said), `a Korean label on an English surface: "${said}"`).toBe(false);
    expect(said).toBe(shown);
  });
});

describe("the public profile, which a stranger reads without signing in", () => {
  async function render(locale: SupportedLocale): Promise<HTMLElement> {
    fetchPublicProfile.mockReset();
    fetchPublicProfile.mockResolvedValue(PROFILE(locale));
    const { default: PublicProfilePage } = await import("../src/pages/PublicProfile");

    const el = mount(
      <MemoryRouter initialEntries={["/@yunji"]}>
        <Routes>
          <Route path="/:handle" element={<PublicProfilePage />} />
        </Routes>
      </MemoryRouter>,
    );
    /* let the one fetch this page makes settle */
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    return el;
  }

  it("hands a Korean reader nothing in English", async () => {
    const el = await render("ko-KR");
    const said = spoken(el);
    expect(
      said.length,
      "the page handed out no labels at all — it never got past loading",
    ).toBeGreaterThan(1);

    const english = said.filter((s) => !HANGUL.test(s.value));
    expect(
      english.map((s) => `${s.where}  ${s.attr}="${s.value}"`),
      "these reached a Korean reader in English",
    ).toEqual([]);

    /* the label this commit's sibling moved onto the page's own copy */
    const preview = el.querySelector(".nc-note-preview");
    expect(preview?.getAttribute("aria-label")).toBe("포스트잇 미리보기");
  });

  it("and an English reader nothing in Korean", async () => {
    const el = await render("en-US");
    const said = spoken(el);
    expect(said.length).toBeGreaterThan(1);

    const korean = said.filter((s) => HANGUL.test(s.value));
    expect(
      korean.map((s) => `${s.where}  ${s.attr}="${s.value}"`),
      "these reached an English reader in Korean",
    ).toEqual([]);

    const preview = el.querySelector(".nc-note-preview");
    expect(preview?.getAttribute("aria-label")).toBe("post-it preview");
  });
});
