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
 * against a store that cannot be swept. `indexedDB` is `fake-indexeddb`, a
 * real IndexedDB engine in Node, for the same reason — the save box's photos
 * and recordings are emptied by a cursor over an index inside a transaction,
 * and a stub with a `clear()` on it would prove none of that ran. The
 * provider, the eviction, and the key-scoping rules are all the real modules —
 * the bug was in the seam between them, which is the one thing a faked
 * provider could not have.
 */
import { IDBFactory } from "fake-indexeddb";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchCurrentViewer, logout as apiLogout } from "../src/lib/api";
import type { ApiViewer } from "../src/lib/api";
import { AuthProvider, useAuth, type AuthContextValue } from "../src/lib/auth-context";
import { storeConversationDraft } from "../src/lib/conversation-drafts";
import {
  loadInspirationDraft,
  newInspirationDraft,
  settleInspirationMediaDraft,
  writeInspirationDraft,
} from "../src/lib/inspiration-draft-store";
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

/**
 * Rows counted straight out of the object store.
 *
 * Two reasons, and the second is the stronger one. A row carrying a voice
 * recording cannot be read back through `loadInspirationDraft` in jsdom — the
 * Blob that survives this environment's structured clone is not an instance of
 * this realm's `Blob`, and the module's verifier rightly refuses it. And
 * counting proves the row is GONE rather than merely filtered out of a read,
 * which is the whole claim being made about logout.
 */
function storedDraftCount(scope: { accountId: string; profileId: string }): Promise<number> {
  const owner = profileStorageKey(scope, "inspirationDraft")!;
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("waka-inspiration-drafts", 1);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction("drafts", "readonly").objectStore("drafts").index("owner").count(owner);
      request.onsuccess = () => { db.close(); resolve(request.result); };
      request.onerror = () => { db.close(); reject(request.error ?? new Error("count failed")); };
    };
    open.onerror = () => reject(open.error ?? new Error("open failed"));
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
  vi.stubGlobal("indexedDB", new IDBFactory());
  auth = null;
  vi.mocked(apiLogout).mockClear();
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  localStorage.clear();
  vi.unstubAllGlobals();
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

  it("clears unconfirmed save journals too, and keeps what they expect to find", async () => {
    /* A save not yet landed is still words on a shared machine (decided
       2026-10-18, security review): signing out lets it go with the rest.
       Settings and positions stay. */
    const pending = profileStorageKey(SCOPE, "pendingSave:inspiration::00000000-0000-4000-8000-000000000009")!;
    const unrecovered = profileStorageKey(SCOPE, "unrecoveredSave:00000000-0000-4000-8000-000000000008")!;
    localStorage.setItem(unrecovered, JSON.stringify({ raw: "words" }));
    const scroll = profileStorageKey(SCOPE, "conversationScroll:journal")!;
    const keepPublic = profileStorageKey(SCOPE, "keepPublic")!;
    localStorage.setItem(pending, JSON.stringify({ text: "already sent" }));
    localStorage.setItem(scroll, JSON.stringify({ top: 120, nearBottom: false }));
    localStorage.setItem(keepPublic, "1");
    await signedIn();

    await act(async () => {
      await auth?.logout();
    });

    expect(localStorage.getItem(pending)).toBeNull();
    expect(localStorage.getItem(unrecovered)).toBeNull();
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

  it("takes the per-id drafts too: a reflection, a review, a selection, a share card", async () => {
    /* These four are written under keys that carry an id — of an inspiration,
       a review, a principle — so logout cannot name them and has to sweep the
       prefix. They are the four the first pass at this fix did not reach.
       Three of the writers are gone now (the reflection and review surfaces
       were removed on 2026-10-10) and the cases stay anyway: a browser that
       used those surfaces still holds the keys, which is the only thing
       eviction is about. */
    const reflection = profileStorageKey(SCOPE, "reflectionDraft:inspiration-7")!;
    const review = profileStorageKey(SCOPE, "reviewDialogue:review-3:draft-1")!;
    const selection = profileStorageKey(SCOPE, "reviewSelection:selection-9")!;
    const share = profileStorageKey(SCOPE, "principleArtifact:principle-2:draft-4")!;
    localStorage.setItem(reflection, JSON.stringify({ afterId: null, answer: "because she never said it out loud" }));
    localStorage.setItem(review, JSON.stringify({ answer: "I am not sure this is true of me any more" }));
    localStorage.setItem(selection, JSON.stringify({ ids: ["a"], query: "the ones about my father" }));
    localStorage.setItem(share, JSON.stringify({ entries: [{ text: "half a sentence I have not finished" }] }));
    await signedIn();

    await act(async () => {
      await auth?.logout();
    });

    for (const key of [reflection, review, selection, share]) expect(localStorage.getItem(key)).toBeNull();
  });

  it("leaves the recovery copies that sit one character away from those prefixes", async () => {
    /* `reviewSelectionRecovery:` begins with `reviewSelection`, and only the
       colon separates them. Each of these holds bytes a store could not verify
       and moved aside rather than destroy, which is submitted-work territory:
       a sweep that matched them would be data loss dressed as a privacy fix.
       `principleArtifactRecovery:` is still written today; the other two are
       from retired surfaces and are no less worth not destroying. */
    const reviewBackup = profileStorageKey(SCOPE, "reviewDialogueRecovery:review-3:backup-1")!;
    const selectionBackup = profileStorageKey(SCOPE, "reviewSelectionRecovery:backup-2")!;
    const shareBackup = profileStorageKey(SCOPE, "principleArtifactRecovery:backup-3")!;
    for (const key of [reviewBackup, selectionBackup, shareBackup]) localStorage.setItem(key, "{\"unreadable\":true}");
    await signedIn();

    await act(async () => {
      await auth?.logout();
    });

    for (const key of [reviewBackup, selectionBackup, shareBackup]) expect(localStorage.getItem(key)).not.toBeNull();
  });

  it("empties the save box's IndexedDB copy — the photo and the recording, not just the words", async () => {
    /* The one store in the product that holds a person's own media before they
       have decided to keep it. Emptying it is a transaction, which is why
       logout awaits this rather than firing it off. */
    const draft = {
      ...newInspirationDraft("the bench in the window at my mother's house"),
      revision: 1,
      linkText: "https://example.test/the-photo-i-was-about-to-paste",
      media: [{ id: "photo-1", type: "image" as const, name: "Kitchen.png", blob: new Blob(["png bytes"], { type: "image/png" }) }],
      recordingCandidate: { id: "voice-1", type: "audio" as const, name: "Recording.webm", blob: new Blob(["voice bytes"], { type: "audio/webm" }) },
    };
    await writeInspirationDraft(SCOPE, draft, 0);
    expect(await storedDraftCount(SCOPE)).toBe(1);
    await signedIn();

    await act(async () => {
      await auth?.logout();
    });

    expect(await storedDraftCount(SCOPE)).toBe(0);
    expect(await loadInspirationDraft(SCOPE, draft.id)).toBeNull();
  });

  it("keeps the settled receipt in IndexedDB, so an old tab still cannot resubmit it", async () => {
    /* A settled row holds no words — settlement empties them — and what it
       does hold is the fact that this draft was already saved. Deleting it
       buys no privacy and costs the guarantee it exists for. */
    const draft = { ...newInspirationDraft("already on its way"), revision: 1 };
    await writeInspirationDraft(SCOPE, draft, 0);
    expect(await settleInspirationMediaDraft(SCOPE, draft.id, 1, "inspiration-1")).toBe(true);
    await signedIn();

    await act(async () => {
      await auth?.logout();
    });

    expect(await storedDraftCount(SCOPE)).toBe(1);
    await expect(writeInspirationDraft(SCOPE, { ...draft, revision: 1, text: "resubmitted by a stale tab" }, 0))
      .rejects.toThrow();
  });

  it("another profile's IndexedDB draft survives this profile leaving", async () => {
    const mine = { ...newInspirationDraft("mine"), revision: 1 };
    const theirs = { ...newInspirationDraft("someone else's half-written keep"), revision: 1 };
    await writeInspirationDraft(SCOPE, mine, 0);
    await writeInspirationDraft(OTHER, theirs, 0);
    await signedIn();

    await act(async () => {
      await auth?.logout();
    });

    expect(await loadInspirationDraft(SCOPE)).toBeNull();
    expect((await loadInspirationDraft(OTHER))?.text).toBe("someone else's half-written keep");
  });

  it("completes even when IndexedDB never answers, and the words are gone regardless", async () => {
    /* A control that never finishes is worse than one that reports a failure.
       `indexedDB.open` here returns a request whose handlers are never called
       — the documented way this hangs is another tab holding an older version
       open — so the only thing that can resolve the logout is the eviction's
       own deadline. The synchronous sweep must already have happened. */
    vi.stubGlobal("indexedDB", { open: () => ({}) });
    writeProfileText(SCOPE, "draft", "the sentence I had not finished");
    const reflection = profileStorageKey(SCOPE, "reflectionDraft:inspiration-7")!;
    localStorage.setItem(reflection, JSON.stringify({ afterId: null, answer: "unsent" }));
    await signedIn();

    await act(async () => {
      await auth?.logout();
    });

    expect(localStorage.getItem(profileStorageKey(SCOPE, "draft")!)).toBeNull();
    expect(localStorage.getItem(reflection)).toBeNull();
    expect(auth?.isAuthenticated).toBe(false);
    expect(apiLogout).toHaveBeenCalled();
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
