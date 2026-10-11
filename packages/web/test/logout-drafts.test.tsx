// @vitest-environment jsdom

/**
 * SIGNING OUT TAKES THE UNSENT WORDS WITH IT.
 *
 * Draft text is kept in `localStorage` on purpose — a crash or a closed tab
 * must not cost the person the sentence they were mid-way through. Logout used
 * to leave all of it behind, so on a shared machine the next person could read
 * the save the previous one had not decided to keep and the message they had
 * not decided to send.
 *
 * The half of this that is easy to get wrong is the other half: a returning
 * owner has to find their settings, their place in a thread, and above all any
 * save that was already submitted and is waiting out a dead network. So the
 * cases below assert the absences AND the survivals, and a fix that simply
 * emptied the store would fail them.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/api` only — the layer directly
 * beneath the subject, because `AuthProvider` calls it itself and a logout
 * must not need a server here. `localStorage` is jsdom's real implementation,
 * not a stub: the eviction works by enumerating keys and matching prefixes, so
 * a hand-written store with three methods on it would be asserting the sweep
 * against a store that cannot be swept. The provider, the eviction, and the
 * key-scoping rules are all the real modules — the bug was in the seam between
 * them, which is the one thing a faked provider could not have.
 */
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchCurrentViewer, logout as apiLogout } from "../src/lib/api";
import type { ApiViewer } from "../src/lib/api";
import { AuthProvider, useAuth, type AuthContextValue } from "../src/lib/auth-context";
import { storeConversationDraft } from "../src/lib/conversation-drafts";
import { profileStorageKey, writeProfileText } from "../src/lib/profile-storage";

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return {
    ...actual,
    fetchCurrentViewer: vi.fn(async () => null),
    logout: vi.fn(async () => undefined),
  };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const SCOPE = { accountId: "account-1", profileId: "profile-1" };
const OTHER = { accountId: "account-1", profileId: "profile-2" };

const VIEWER: ApiViewer = {
  account: {
    id: SCOPE.accountId,
    email: "ada@example.com",
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
    isAdmin: false,
  },
  profile: {
    id: SCOPE.profileId,
    accountId: SCOPE.accountId,
    type: "human",
    name: "Ada",
    avatarUrl: null,
    preferredLocale: "en-US",
    publicHandle: null,
    publicProfileEnabled: false,
    publicTopOfMindEnabled: false,
  },
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let auth: AuthContextValue | null = null;

function Probe(): JSX.Element {
  const value = useAuth();
  useEffect(() => {
    auth = value;
  }, [value]);
  return createElement("main");
}

async function signedIn(): Promise<void> {
  vi.mocked(fetchCurrentViewer).mockResolvedValue(VIEWER);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(AuthProvider, null, createElement(Probe)));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const draft = (conversationId: string, content: string) =>
  storeConversationDraft(SCOPE, conversationId, {
    id: crypto.randomUUID(),
    writer: crypto.randomUUID(),
    updatedAt: 1,
    revision: 0,
    pending: false,
    content,
  });

beforeEach(() => {
  localStorage.clear();
  auth = null;
  vi.mocked(apiLogout).mockClear();
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  localStorage.clear();
});

describe("logging out", () => {
  it("leaves no unsent draft text behind for the next person at the browser", async () => {
    writeProfileText(SCOPE, "draft", "the bench in the window at my mother's house");
    const composer = draft("00000000-0000-4000-8000-000000000001", "what I could not say yet");
    const second = draft("00000000-0000-4000-8000-000000000002", "and the other thing");
    await signedIn();

    await act(async () => {
      await auth?.logout();
    });

    expect(localStorage.getItem(profileStorageKey(SCOPE, "draft")!)).toBeNull();
    expect(localStorage.getItem(composer.key)).toBeNull();
    expect(localStorage.getItem(second.key)).toBeNull();
    /* The whole point is that the person actually left, so the server was
       asked too — a fix that only emptied storage would be a different bug. */
    expect(apiLogout).toHaveBeenCalled();
  });

  it("keeps what the person already submitted, and what they expect to find", async () => {
    /* A save that IS on its way: kept so a dead network cannot silently lose
       it. Evicting this would turn a privacy fix into data loss, in exactly
       the case the backup exists for. */
    const pending = profileStorageKey(SCOPE, "pendingSave:keep:x:1")!;
    const scroll = profileStorageKey(SCOPE, "conversationScroll:journal")!;
    const keepPublic = profileStorageKey(SCOPE, "keepPublic")!;
    localStorage.setItem(pending, JSON.stringify({ text: "already sent" }));
    localStorage.setItem(scroll, JSON.stringify({ top: 120, nearBottom: false }));
    localStorage.setItem(keepPublic, "1");
    await signedIn();

    await act(async () => {
      await auth?.logout();
    });

    expect(localStorage.getItem(pending)).not.toBeNull();
    expect(localStorage.getItem(scroll)).not.toBeNull();
    expect(localStorage.getItem(keepPublic)).toBe("1");
  });

  it("clears only the profile that left — another on this browser is untouched", async () => {
    /* Keys carry the account and the profile, and two people can be signed
       into one browser. Signing one out is not an event about the other. */
    writeProfileText(OTHER, "draft", "someone else's half-written keep");
    const theirs = storeConversationDraft(OTHER, "00000000-0000-4000-8000-000000000003", {
      id: crypto.randomUUID(),
      writer: crypto.randomUUID(),
      updatedAt: 1,
      revision: 0,
      pending: false,
      content: "theirs",
    });
    writeProfileText(SCOPE, "draft", "mine");
    await signedIn();

    await act(async () => {
      await auth?.logout();
    });

    expect(localStorage.getItem(profileStorageKey(SCOPE, "draft")!)).toBeNull();
    expect(localStorage.getItem(profileStorageKey(OTHER, "draft")!)).toBe(
      "someone else's half-written keep",
    );
    expect(localStorage.getItem(theirs.key)).not.toBeNull();
  });

  it("does not evict a draft when the network merely went away", async () => {
    /* Hydration clears the viewer whenever `/auth/me` cannot be answered, and
       that person has a valid session and bad wifi. Losing their words to a
       dropped packet is the regression this case exists to prevent. */
    writeProfileText(SCOPE, "draft", "still being written");
    vi.mocked(fetchCurrentViewer).mockRejectedValue(new Error("offline"));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(AuthProvider, null, createElement(Probe)));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(auth?.isAuthenticated).toBe(false);
    expect(localStorage.getItem(profileStorageKey(SCOPE, "draft")!)).toBe("still being written");
  });
});
