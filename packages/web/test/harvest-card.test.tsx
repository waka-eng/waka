// @vitest-environment jsdom
/**
 * A SENTENCE OF YOURS, PICKED FROM YOUR DAY: KEEP IT, OR SAY WHY NOT.
 *
 * Founder, 2026-10-15: "if I use the WAKA MCP, then the agent would derive
 * 'oh, this looks like inspiration, this looks important' ... we need more
 * than a yes and a no. When the user says no, select why not."
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/data` supplies the three layers;
 * `lib/api` supplies the claim queue, the basket, the save and the two
 * basket decisions, because those are the seams a candidate arrives and
 * leaves through, and each press here is only checkable if they are
 * observable. `lib/auth-context` supplies the viewer. `helpers/render-home`
 * and `helpers/canvas-stub` replace time, frames, randomness and drawing.
 * Every case presses a real control and asserts what reached the server.
 */
import { act } from "react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { installCanvasStub, setViewport } from "./helpers/canvas-stub";
import { apiMockFrom, dataMockFrom, diveIntoReview, mountWorld, VIEWER_ID, type MountedWorld } from "./helpers/render-home";
import { createInspiration, declineHarvest, keepHarvest, listClaims, listHarvest, updateInspiration } from "../src/lib/api";
import { SLIP_LEAVE_MS as LEAVE_MS } from "../src/components/ClaimSlip";

const FACTS = { inspirations: [{ id: "kept-1", text: "An original capture", daysAgo: 3 }], groups: [] };
const CANDIDATE = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", text: "Ship the ugly version first, then make it kind.", title: null, tool: "claude-code", createdAt: "2026-10-14T22:00:00Z", lapsesAt: "2026-10-21T22:00:00Z" };
const SECOND = { ...CANDIDATE, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", text: "Small doors, often.", title: "On shipping" };
const CLAIM = {
  id: "claim-1", statement: "You keep saving products that make the first move for you.", status: "emerging" as const,
  confidence: 24, evidenceCount: 1, lastEvidenceAt: "2026-10-01T00:00:00.000Z", locked: false, unsupported: false,
  sharedGroupIds: [], createdAt: "2026-10-01T00:00:00.000Z", statementRevision: "7", from: [],
};
const SAVED = (text: string) => ({
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", text, kind: "note", source: "app", visibility: "private",
  createdAt: "2026-10-15T09:00:00Z", updatedAt: "2026-10-15T09:00:00Z", attachments: [], reflections: [],
});

vi.mock("../src/lib/api", async (original) => ({
  ...await original<typeof import("../src/lib/api")>(),
  ...apiMockFrom({ inspirations: [{ id: "kept-1", text: "An original capture", daysAgo: 3 }], groups: [] }),
  listClaims: vi.fn(),
  listHarvest: vi.fn(),
  createInspiration: vi.fn(),
  keepHarvest: vi.fn(),
  declineHarvest: vi.fn(),
  updateInspiration: vi.fn(),
}));
vi.mock("../src/lib/auth-context", async (original) => ({
  ...await original<typeof import("../src/lib/auth-context")>(),
  useOptionalAuth: () => ({ status: "authenticated", account: { id: "a", email: "owner@example.test" },
    profile: { id: VIEWER_ID, name: "Owner", type: "human" }, profiles: [] }),
}));
vi.mock("../src/lib/data", async (original) => ({
  ...await original<typeof import("../src/lib/data")>(),
  ...dataMockFrom({ inspirations: [{ id: "kept-1", text: "An original capture", daysAgo: 3 }], groups: [] }),
}));

let world: MountedWorld;
beforeAll(() => {
  installCanvasStub(); setViewport(1280, 900);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => { world?.unmount(); vi.clearAllMocks(); });

const button = (label: string) => {
  /* A reason row carries its explaining line too, so a row is found by its
     own label; every other button by its whole text. */
  const found = [...world.container.querySelectorAll<HTMLButtonElement>("button")].find((node) =>
    (node.querySelector(".jar-harvest-row-label")?.textContent ?? node.textContent)?.trim() === label);
  if (!found) throw new Error(`no button named ${label}`);
  return found;
};
/* The FRONT slip's words: the next one is previewed behind it. */
const statement = () => (world.container.querySelector(".jar-pick-slip .jar-pick-words") ?? world.container.querySelector(".jar-pick-slip .jar-pick-statement"))?.textContent ?? "";
const leaves = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, LEAVE_MS + 30)); });

async function withBasket(candidates: Array<typeof CANDIDATE>, claims: Array<typeof CLAIM> = []) {
  vi.mocked(listHarvest).mockResolvedValue(candidates as never);
  vi.mocked(listClaims).mockResolvedValue({ claims, more: false } as never);
  vi.mocked(createInspiration).mockImplementation(async (input) => SAVED(input.text ?? "") as never);
  vi.mocked(keepHarvest).mockResolvedValue(undefined);
  vi.mocked(declineHarvest).mockResolvedValue(undefined);
  world = await mountWorld(FACTS);
  /* The cards are behind the invitation since 2026-10-15; see `diveIntoReview`. */
  await diveIntoReview(world.container, world.step);
}

it("asks about a picked sentence before any reading, in the agent's voice, and says where it came from", async () => {
  await withBasket([CANDIDATE], [CLAIM]);
  expect(statement()).toBe(CANDIDATE.text);
  /* NOT THE CLAIM CARD. Founder: type two needs "a very clear distinction". */
  expect(world.container.querySelector(".jar-pick--reading"), "a pick must not wear the reading's tone").toBeNull();
  expect(world.container.querySelector(".jar-pick-who")?.textContent).toContain("Your agent noticed this");
  expect(world.container.querySelector(".jar-pick-source")?.textContent).toContain("Noticed while you worked with Claude");
});

it("keeps it when the slip is dragged to the right, the pick's own gesture", async () => {
  await withBasket([CANDIDATE]);
  const slip = world.container.querySelector<HTMLDivElement>(".jar-pick-slip")!;
  const fire = (type: string, x: number, timeStamp: number) => {
    const event = new window.PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, clientX: x, clientY: 300, button: 0, buttons: 1 });
    Object.defineProperty(event, "timeStamp", { value: timeStamp });
    slip.dispatchEvent(event);
  };
  await act(async () => { fire("pointerdown", 100, 0); fire("pointermove", 140, 20); fire("pointermove", 180, 40); fire("pointerup", 180, 50); });
  expect(createInspiration).toHaveBeenCalledWith({ text: CANDIDATE.text }, expect.objectContaining({ requestId: CANDIDATE.id }));
});

it("keeps it as an ordinary save, keyed to the candidate so a retry cannot make two", async () => {
  await withBasket([CANDIDATE], [CLAIM]);
  await act(async () => button("Keep it").click());
  expect(createInspiration).toHaveBeenCalledWith({ text: CANDIDATE.text }, expect.objectContaining({ requestId: CANDIDATE.id, profile: VIEWER_ID }));
  expect(keepHarvest).toHaveBeenCalledWith(CANDIDATE.id, "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  await leaves();
  expect(statement(), "the reading comes up once the basket is empty").toBe(CLAIM.statement);
});

it("asks why not, and files the reason with the decline", async () => {
  await withBasket([CANDIDATE]);
  await act(async () => button("Not it").click());
  /* THE SWIPE LETS IT GO AT ONCE (review, 2026-10-15): a closed tab or an
     unanswered "why not" must not leave it waiting. The reason follows. */
  expect(declineHarvest).toHaveBeenCalledWith(CANDIDATE.id);
  await leaves();
  expect(world.container.querySelector(".jar-harvest-quote")?.textContent).toBe(CANDIDATE.text);
  await act(async () => button("Private").click());
  expect(declineHarvest).toHaveBeenCalledWith(CANDIDATE.id, "private", undefined);
  expect(world.container.querySelector(".jar-harvest-why")).toBeNull();
  expect(createInspiration).not.toHaveBeenCalled();
});

it("lets go without a reason when the person skips", async () => {
  await withBasket([CANDIDATE]);
  await act(async () => button("Not it").click());
  await leaves();
  await act(async () => button("Skip").click());
  expect(declineHarvest).toHaveBeenCalledWith(CANDIDATE.id, undefined, undefined);
});

/* THEIR OWN ANSWER (2026-10-15): "let user provide their own answers." */
it("lets the person say why in their own words, and files it with the decline", async () => {
  await withBasket([CANDIDATE]);
  await act(async () => button("Not it").click());
  await leaves();
  await act(async () => button("Something else").click());
  const field = world.container.querySelector<HTMLTextAreaElement>(".jar-harvest-fix textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "Someone else said it in the meeting");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("Let it go").click());
  expect(declineHarvest).toHaveBeenCalledWith(CANDIDATE.id, "other", "Someone else said it in the meeting");
});

it("treats a bad cut as a good thought: fix the words and keep them", async () => {
  await withBasket([CANDIDATE]);
  await act(async () => button("Not it").click());
  await leaves();
  await act(async () => button("Cut wrong").click());
  const area = world.container.querySelector<HTMLTextAreaElement>(".jar-harvest-fix textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, "Ship the ugly version first.");
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("Keep this").click());
  /* Corrected words are a new save, so they get their own request id: the
     candidate's would be refused as a conflicting replay of the original.
     The id is a digest, so the save is waited for, not assumed. */
  await act(async () => { await vi.waitFor(() => expect(keepHarvest).toHaveBeenCalled()); });
  expect(createInspiration).toHaveBeenCalledWith({ text: "Ship the ugly version first." }, expect.objectContaining({ requestId: expect.not.stringMatching(CANDIDATE.id) }));
  expect(keepHarvest).toHaveBeenCalledWith(CANDIDATE.id, expect.any(String));
  expect(declineHarvest, "only the swipe's own bare decline").toHaveBeenCalledTimes(1);
});

/* Found in review (2026-10-15): corrected once, the link failed, corrected
   again — the same save takes the new words, and the keep names the words it
   was first made with so the server can still tell whose save it is. */
it("corrects the same save after a failed link, and says what it was first saved as", async () => {
  await withBasket([CANDIDATE]);
  vi.mocked(updateInspiration).mockImplementation(async (_id, input) => SAVED(input.text ?? "") as never);
  vi.mocked(keepHarvest).mockRejectedValueOnce(new Error("offline"));
  const correct = async (words: string, fails = false) => {
    /* After a failed keep the words stay open to fix; only the first time is "Cut wrong" pressed. */
    if (!world.container.querySelector(".jar-harvest-fix textarea")) await act(async () => button("Cut wrong").click());
    const area = world.container.querySelector<HTMLTextAreaElement>(".jar-harvest-fix textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, words);
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const tries = vi.mocked(keepHarvest).mock.calls.length;
    await act(async () => button("Keep this").click());
    /* The save's request id is a digest, so each keep is waited for until
       it has actually been tried, and its failure has settled on screen. */
    await act(async () => { await vi.waitFor(() => expect(vi.mocked(keepHarvest).mock.calls.length).toBe(tries + 1)); });
    if (fails) await act(async () => { await vi.waitFor(() => expect(world.container.querySelector(".jar-harvest-fix textarea")).not.toBeNull()); });
  };
  await act(async () => button("Not it").click());
  await leaves();
  await correct("Ship it ugly.", true);
  await correct("Ship it ugly, then kind.");
  expect(createInspiration, "one save, whatever failed").toHaveBeenCalledTimes(1);
  expect(updateInspiration).toHaveBeenCalledWith("cccccccc-cccc-4ccc-8ccc-cccccccccccc", { text: "Ship it ugly, then kind." });
  expect(keepHarvest).toHaveBeenLastCalledWith(CANDIDATE.id, "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "Ship it ugly.");
});

it("a bad cut can still be let go, and says why", async () => {
  await withBasket([CANDIDATE]);
  await act(async () => button("Not it").click());
  await leaves();
  await act(async () => button("Cut wrong").click());
  await act(async () => button("Let it go").click());
  expect(declineHarvest).toHaveBeenCalledWith(CANDIDATE.id, "miscut", undefined);
});

it("puts a candidate back and says so when keeping it fails", async () => {
  await withBasket([CANDIDATE, SECOND]);
  vi.mocked(keepHarvest).mockRejectedValueOnce(new Error("offline"));
  await act(async () => button("Keep it").click());
  await leaves();
  expect(statement(), "the one that failed is back in front").toBe(CANDIDATE.text);
  expect(world.container.textContent).toContain("That didn’t keep.");
});

it("keeps the question open with its reason when letting go fails", async () => {
  await withBasket([CANDIDATE]);
  await act(async () => button("Not it").click());
  await leaves();
  vi.mocked(declineHarvest).mockRejectedValueOnce(new Error("offline"));
  await act(async () => button("Too small").click());
  expect(world.container.querySelector(".jar-harvest-failed")?.textContent).toContain("didn’t go through");
  await act(async () => button("Too small").click());
  /* the swipe's bare decline, the failed reason, and its retry */
  expect(declineHarvest).toHaveBeenCalledTimes(3);
  expect(world.container.querySelector(".jar-harvest-why")).toBeNull();
});
