// @vitest-environment jsdom
/**
 * A member reaches the room's question from its current reading, proposes a
 * thought, and can see an accepted answer become the next reading.
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/data` supplies a deterministic
 * personal archive; `lib/api` supplies versioned room reads and proposal
 * writes, since this suite proves the web lifecycle without a server or
 * model. `lib/auth-context` supplies the acting member.
 * `helpers/canvas-stub` and `helpers/render-home` replace drawing, the clock,
 * and browser geometry. The real Home and proposal panel run against those
 * seams.
 */
import { act } from "react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { ApiGroupProposal, ApiGroupTopOfMind } from "../src/lib/api";
import { installCanvasStub, setViewport } from "./helpers/canvas-stub";
import { apiMockFrom, dataMockFrom, mountWorld, VIEWER_ID, type MountedWorld } from "./helpers/render-home";

const ROOM_ID = "group-shaping";
const ROOM_NAME = "shaping room";
const BEFORE = "We begin with small experiments.";
const AFTER = "We begin with small experiments and share what we learn.";
const FACTS = {
  inspirations: [{ id: "mine-1", text: "I learn by trying a small version first.", daysAgo: 8 }],
  groups: [{ id: ROOM_ID, name: ROOM_NAME, field: [
    { id: "mine-1", ownerProfileId: VIEWER_ID, ownerName: "You", daysAgo: 8 },
    { id: "theirs-1", ownerProfileId: "profile-other", ownerName: "Bo", daysAgo: 7 },
  ] }],
};
const server = vi.hoisted(() => ({ version: 1, proposals: [] as ApiGroupProposal[], failNextAffirm: false, solo: false }));
const iso = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const proposal = (id: string, body: string, by: string): ApiGroupProposal => ({
  id, kind: "add_entry", status: "open", entryId: null, body, rationale: null,
  proposedByProfileId: by === "You" ? VIEWER_ID : "profile-other", proposedByName: by,
  stances: [], viewerStance: null, resolvedAt: null, createdAt: iso(0),
});
const top = (version: number): ApiGroupTopOfMind => ({
  topOfMind: { id: `tom-${version}`, version, status: "live", reason: version === 1 ? "initial" : "member_proposal", createdAt: iso(0) },
  entries: [{ id: `entry-${version}`, type: "pattern", body: version === 1 ? BEFORE : AFTER,
    belief: null, prompt: null, lockedAt: null, pinnedAt: iso(0), sortOrder: 0,
    createdAt: iso(0), contributors: [{ profileId: VIEWER_ID, name: "You" }] }],
});

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return {
    ...actual, ...apiMockFrom(FACTS),
    fetchGroupTopOfMind: async (_groupId: string, version?: number) => top(version ?? server.version),
    fetchGroupTimeline: async () => ({
      versions: server.version === 2 ? [
        { id: "v2", version: 2, status: "live", reason: "member_proposal", entryCount: 1, createdAt: iso(0) },
        { id: "v1", version: 1, status: "superseded", reason: "initial", entryCount: 1, createdAt: iso(1) },
      ] : [{ id: "v1", version: 1, status: "live", reason: "initial", entryCount: 1, createdAt: iso(1) }],
      doorMarks: [],
    }),
    fetchGroupProposals: async () => server.proposals,
    createGroupProposal: async (_groupId: string, input: { body: string }) => {
      const made = { ...proposal("new-question", input.body, "You"),
        viewerStance: "affirmed" as const,
        stances: [{ profileId: VIEWER_ID, name: "You", value: "affirmed" as const, createdAt: iso(0) }] };
      if (server.solo) {
        server.version = 2;
        return { ...made, status: "accepted" as const };
      }
      server.proposals = [made, ...server.proposals];
      return made;
    },
    affirmGroupProposal: async (_groupId: string, id: string) => {
      if (server.failNextAffirm) {
        server.failNextAffirm = false;
        throw new Error("temporarily unavailable");
      }
      const old = server.proposals.find((row) => row.id === id)!;
      const accepted = { ...old, status: "accepted" as const, viewerStance: "affirmed" as const };
      server.proposals = server.proposals.filter((row) => row.id !== id);
      server.version = 2;
      return { proposal: accepted, accepted: true };
    },
  };
});
vi.mock("../src/lib/data", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/lib/data")>(), ...dataMockFrom(FACTS),
}));
vi.mock("../src/lib/auth-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/auth-context")>();
  const session = { status: "authenticated", account: { id: "account-1", email: "you@example.test" },
    profile: { id: VIEWER_ID, name: "You", type: "human" }, profiles: [],
    refresh: async () => undefined, signOut: async () => undefined };
  return { ...actual, useOptionalAuth: () => session, useAuth: () => session };
});

let layout: MountedWorld;
beforeAll(() => {
  installCanvasStub(); setViewport(1280, 900);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(async () => {
  server.version = 1; server.proposals = []; server.failNextAffirm = false; server.solo = false;
  layout = await mountWorld(FACTS);
  await layout.travelTo(new RegExp(ROOM_NAME, "i"));
});
afterEach(() => { vi.useRealTimers(); layout?.unmount(); });
const find = (selector: string) => {
  const element = layout.container.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
};
const open = async () => {
  await act(async () => find(".jar-room-shape").click());
  await act(async () => { await Promise.resolve(); });
};

it("keeps a newly proposed thought visible while the room waits for others", async () => {
  await open();
  await act(async () => {
    [...layout.container.querySelectorAll<HTMLElement>(".jar-roomform--group button")]
      .find((button) => button.textContent === "put something to this room")!.click();
  });
  const editor = find(".jar-reflect-box") as HTMLTextAreaElement;
  const nativeValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (!nativeValue) throw new Error("No textarea value setter");
  await act(async () => {
    nativeValue.call(editor, "We make experiments small enough to share.");
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    [...layout.container.querySelectorAll<HTMLElement>(".jar-roomform--group button")]
      .find((button) => button.textContent === "put it to them")!.click();
  });
  expect(find(".jar-roomform--group").textContent).toContain("We make experiments small enough to share.");
  expect(find(".jar-roomform--group").textContent).toContain("Members can answer it now");
  expect(find(".jar-roomform--group").textContent).toContain("you agreed");
});

it("keeps an accepted answer visible until the next version reaches the room", async () => {
  server.proposals = [proposal("question-1", "We share what we learn.", "Bo")];
  await open();
  expect(find(".jar-roomform--group").textContent).toContain("We share what we learn.");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await act(async () => {
    [...layout.container.querySelectorAll<HTMLElement>(".jar-roomform--group button")]
      .find((button) => button.textContent === "yes, that is us")!.click();
  });
  expect(find(".jar-roomform--group").textContent).toContain("next reading is taking shape");
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  vi.useRealTimers();
  await layout.step(40);
  expect(find(".jar-roomform--group").textContent).toContain("new reading is here");
  expect(find('h1.jar-poster[data-jar-chrome="1"]').textContent).toContain(AFTER);
});

it("follows an immediately carried proposal into its new version", async () => {
  server.solo = true;
  await open();
  await act(async () => {
    [...layout.container.querySelectorAll<HTMLElement>(".jar-roomform--group button")]
      .find((button) => button.textContent === "put something to this room")!.click();
  });
  const editor = find(".jar-reflect-box") as HTMLTextAreaElement;
  const nativeValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (!nativeValue) throw new Error("No textarea value setter");
  await act(async () => {
    nativeValue.call(editor, "We share what we learn.");
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await act(async () => {
    [...layout.container.querySelectorAll<HTMLElement>(".jar-roomform--group button")]
      .find((button) => button.textContent === "put it to them")!.click();
  });
  expect(find(".jar-roomform--group").textContent).toContain("next reading is taking shape");
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  vi.useRealTimers();
  await layout.step(40);
  expect(find('h1.jar-poster[data-jar-chrome="1"]').textContent).toContain(AFTER);
});

it("keeps an open question visible when an answer fails to save", async () => {
  server.proposals = [proposal("question-1", "We share what we learn.", "Bo")];
  server.failNextAffirm = true;
  await open();
  await act(async () => {
    [...layout.container.querySelectorAll<HTMLElement>(".jar-roomform--group button")]
      .find((button) => button.textContent === "yes, that is us")!.click();
  });
  expect(find(".jar-roomform--group").textContent).toContain("We share what we learn.");
  expect(find('.jar-roomform--group [role="alert"]').textContent).toContain("temporarily unavailable");
  expect(server.proposals).toHaveLength(1);
});

it("shows another member's answer and the room's next version while the panel stays open", async () => {
  const question = { ...proposal("question-1", "We share what we learn.", "You"),
    viewerStance: "affirmed" as const,
    stances: [{ profileId: VIEWER_ID, name: "You", value: "affirmed" as const, createdAt: iso(0) }] };
  server.proposals = [question];
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await open();
  server.proposals = [{ ...question, stances: [...question.stances,
    { profileId: "profile-other", name: "Bo", value: "affirmed", createdAt: iso(0) }] } as ApiGroupProposal];
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect([...layout.container.querySelectorAll(".jar-proposal .jar-said")]
    .map((element) => element.textContent).join(" ")).toContain("Bo");

  server.proposals = [];
  server.version = 2;
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  vi.useRealTimers();
  await layout.step(40);
  expect(find('h1.jar-poster[data-jar-chrome="1"]').textContent).toContain(AFTER);
  expect(find(".jar-roomform--group").textContent).toContain("new reading is here");
});
