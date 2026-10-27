// @vitest-environment jsdom
/**
 * THE PRINCIPLES PAGE BEFORE THERE ARE ANY, AND THE MOMENT THE FIRST ARRIVES.
 *
 * Founder, 2026-10-15: "in the beginning they wouldn't form because it takes
 * time, but even the waiting time I wanted to have a very thrilling and super
 * exciting waiting time."
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/api` supplies `fetchSignals`,
 * `listClaims` and `fetchPrinciples`, the three reads the page is built from,
 * so what it says can be checked against what the server holds. Storage,
 * copy and the components are real.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { PrinciplesGround } from "../src/components/PrinciplesGround";
import { PrinciplesOverlay } from "../src/components/PrinciplesOverlay";
import { fetchPrinciples, fetchSignals, listClaims, type ApiPrinciple, type ApiSignal } from "../src/lib/api";

vi.mock("../src/lib/api", async (original) => ({
  ...await original<typeof import("../src/lib/api")>(),
  fetchSignals: vi.fn(),
  listClaims: vi.fn(),
  fetchPrinciples: vi.fn(),
}));

const PROFILE = "33333333-3333-4333-8333-333333333333";
const signal = (id: string, statement: string, evidenceCount = 3): ApiSignal => ({
  id, statement, status: "active", confidence: 40, evidenceCount, lastEvidenceAt: null, locked: false,
  unsupported: false, dismissed: false, contested: false, yielded: false, sharedGroupIds: [], createdAt: "2026-10-01T00:00:00Z",
});
const PRINCIPLE: ApiPrinciple = { id: "44444444-4444-4444-8444-444444444444", statement: "Choose what you can undo.", type: "maxim", state: "held",
  origin: "minted", rank: 1, locked: false, heldSince: null, conflictsWithId: null, createdAt: "2026-10-01T00:00:00Z", citedSignals: [] } as ApiPrinciple;

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(listClaims).mockResolvedValue({ claims: [], more: false });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const ground = (onChat?: (said: string) => void) => act(async () => root.render(<PrinciplesGround locale="en-US" profileId={PROFILE} onChat={onChat} />));
const remount = async (onChat?: (said: string) => void) => {
  await act(async () => root.unmount());
  root = createRoot(host);
  await ground(onChat);
};
const seats = () => [...host.querySelectorAll(".waka-ground-seat")];
const line = () => host.querySelector(".waka-ground-bubble .jar-char-bubble-reading")?.textContent ?? "";

it("explains principles with a labeled example instead of empty placeholders", async () => {
  vi.mocked(fetchSignals).mockResolvedValue([]);
  await ground();
  expect(seats()).toHaveLength(0);
  expect(host.querySelector(".waka-ground-definition")?.textContent).toBe("A principle is a guide for making choices.");
  expect(host.querySelector(".waka-ground-example")?.textContent).toContain("Example principle");
  expect(host.querySelector(".waka-ground-example")?.textContent).toContain("Make room for small experiments.");
  expect(host.querySelector(".waka-ground-how")?.textContent).toContain("inspirations and Top of Mind");
  expect(host.querySelectorAll(".waka-ground-seat--held")).toHaveLength(0);
  expect(line()).toContain("Add more inspirations so WAKA can find patterns and generate your first principle.");
});

it("puts each holding pattern's own words in a seat and says what is left, in words", async () => {
  vi.mocked(fetchSignals).mockResolvedValue([signal("a", "You keep reversible doors open.", 5), signal("b", "You choose small first moves.", 3)]);
  await ground();
  const held = [...host.querySelectorAll(".waka-ground-seat--held")].map((node) => node.textContent);
  /* Longest-held first: it is the likeliest ground for the first principle. */
  expect(held).toEqual(["You keep reversible doors open.", "You choose small first moves."]);
  expect(line()).toBe("I’ve found two patterns that could help shape your first principle. Add more inspirations to help it take shape.");
  expect(line(), "states render, numerals never").not.toMatch(/\d/);
});

it("warms the card and quickens the creature when every seat is held, and never promises a date", async () => {
  vi.mocked(fetchSignals).mockResolvedValue([signal("a", "A."), signal("b", "B."), signal("c", "C."), signal("d", "D.")]);
  await ground();
  expect(host.querySelector(".waka-ground-card--full")).not.toBeNull();
  expect(host.querySelector(".waka-ground-hero--ready"), "the creature's anticipation is the full state").not.toBeNull();
  expect(host.querySelectorAll(".waka-ground-seat--held")).toHaveLength(3);
  expect(line()).toContain("These patterns could help shape your first principle");
  expect(line()).not.toMatch(/tonight|everything is in place/i);
});

it("leaves out patterns the person set aside or that lost their saves", async () => {
  vi.mocked(fetchSignals).mockResolvedValue([{ ...signal("a", "Set aside."), dismissed: true }, { ...signal("b", "Unsupported."), unsupported: true }, signal("c", "Still here.")]);
  await ground();
  expect([...host.querySelectorAll(".waka-ground-seat--held")].map((node) => node.textContent)).toEqual(["Still here."]);
});

/* THE BUBBLE ENDS IN THE HOME SCREEN'S ROW (2026-10-15): "make this also
   have the chat about it thing" — and the link to go and answer is gone. */
it("offers to chat about what the creature said, and no longer sends the person off to answer", async () => {
  vi.mocked(fetchSignals).mockResolvedValue([signal("a", "A.")]);
  const chat = vi.fn();
  await ground(chat);
  expect(host.querySelector(".waka-ground-act"), "the answer link went").toBeNull();
  const row = host.querySelector<HTMLButtonElement>(".waka-ground-bubble .jar-char-bubble-act")!;
  expect(row.textContent).toBe("Let’s chat about it");
  await act(async () => row.click());
  expect(chat).toHaveBeenCalledWith(line());
});

it("lights only the seat that filled since the last visit, and nothing on a first visit", async () => {
  vi.mocked(fetchSignals).mockResolvedValue([signal("a", "A.")]);
  await ground();
  expect(host.querySelectorAll(".waka-ground-seat--new"), "a first visit has nothing new in it").toHaveLength(0);

  vi.mocked(fetchSignals).mockResolvedValue([signal("a", "A.", 5), signal("b", "B.")]);
  await remount();
  const fresh = [...host.querySelectorAll(".waka-ground-seat--new")].map((node) => node.textContent);
  expect(fresh).toEqual(["B."]);
});

/* A FAILED READ USED TO SAY "No principles yet." — true of an account with
   forty steady signals too, which is why it was a lie over a dead connection.
   It says it failed now, and the Try again under it reads the ground again. */
it("says the ground could not be read, and reads it again on Try again", async () => {
  vi.mocked(fetchSignals).mockRejectedValue(new Error("down"));
  await ground();
  expect(host.textContent).toContain("Couldn’t read what your principles grow from.");
  expect(host.textContent).not.toContain("No principles yet.");
  vi.mocked(fetchSignals).mockResolvedValue([signal("a", "A.")]);
  const retry = host.querySelector<HTMLButtonElement>(".waka-over-retry")!;
  expect(retry.textContent).toBe("Try again");
  await act(async () => retry.click());
  await act(async () => undefined);
  expect(host.querySelector(".waka-ground-words")?.textContent).toBe("A.");
});

it("meets the first principle once, and only for someone who waited for it", async () => {
  const overlay = () => act(async () => root.render(
    <PrinciplesOverlay locale="en-US" profileId={PROFILE} name="Agi" title="Principles" onClose={() => {}} onOpen={() => {}} />,
  ));
  vi.mocked(fetchSignals).mockResolvedValue([]);
  vi.mocked(fetchPrinciples).mockResolvedValue([]);
  await overlay();
  expect(host.querySelector(".waka-ground")).not.toBeNull();

  vi.mocked(fetchPrinciples).mockResolvedValue([PRINCIPLE]);
  await act(async () => root.unmount());
  root = createRoot(host);
  await overlay();
  expect(host.querySelector(".waka-held-first")?.textContent).toBe("Here it is. Your first principle.");
  expect(host.querySelector(".waka-held-card--arriving")).not.toBeNull();

  await act(async () => root.unmount());
  root = createRoot(host);
  await overlay();
  expect(host.querySelector(".waka-held-first"), "the greeting is once").toBeNull();
});

it("does not greet principles that were already there on the first visit", async () => {
  vi.mocked(fetchPrinciples).mockResolvedValue([PRINCIPLE]);
  await act(async () => root.render(
    <PrinciplesOverlay locale="en-US" profileId={PROFILE} name="Agi" title="Principles" onClose={() => {}} onOpen={() => {}} />,
  ));
  expect(host.querySelector(".waka-held-first")).toBeNull();
});

/* THE WALK HOME CANNOT STRAND THE PAGE (2026-10-15). Home keeps the page up
   until the walk says it is done; a page with no creature of its own to walk
   from — measured nothing, as jsdom measures everything — must say so at
   once rather than hold the world behind it forever. */
it("lets the page go at once when there is no creature to walk home from", async () => {
  vi.mocked(fetchPrinciples).mockResolvedValue([PRINCIPLE]);
  const crossed = vi.fn();
  const page = (crossing: { going: "in" | "out"; home: { x: number; y: number; size: number } | null } | null) =>
    <PrinciplesOverlay locale="en-US" profileId={PROFILE} name="Agi" title="Principles" onClose={() => {}} onOpen={() => {}} crossing={crossing} onCrossed={crossed} />;
  await act(async () => root.render(page(null)));
  expect(host.querySelector(".waka-held-hero [data-crossing-target]"), "the list keeps its creature in view").not.toBeNull();
  await act(async () => root.render(page({ going: "out", home: { x: 640, y: 450, size: 100 } })));
  expect(crossed).toHaveBeenCalledTimes(1);
  expect(host.querySelector(".waka-crossing-being")).toBeNull();
});

/* THE TOP THREE, AND THE CREATURE SAYS WHAT THEY ARE (founder, 2026-10-16):
   "have max 3 principles only. vertical list of three" and "remove your
   principles text at the top. ensure the character always mention sth
   principle". */
it("holds only the top three, and the creature, not a title, says these are your principles", async () => {
  const five = ["One.", "Two.", "Three.", "Four.", "Five."].map((statement, index) =>
    ({ ...PRINCIPLE, id: `44444444-4444-4444-8444-44444444444${index}`, statement, rank: index + 1 }));
  vi.mocked(fetchPrinciples).mockResolvedValue(five);
  await act(async () => root.render(
    <PrinciplesOverlay locale="en-US" profileId={PROFILE} name="Agi" title="Principles" onClose={() => {}} onOpen={() => {}} />,
  ));
  expect([...host.querySelectorAll(".waka-held-words")].map((node) => node.textContent)).toEqual(["One.", "Two.", "Three."]);
  expect(host.querySelector(".waka-held-hero .waka-held-says")?.textContent)
    .toBe("These are your principles: what has stayed true across your top of mind for a long time.");
  expect(host.querySelector(".waka-held-hero [data-crossing-target]")).not.toBeNull();
  expect(host.querySelector(".waka-over-head")?.classList.contains("sr-only"), "the title is for screen readers only").toBe(true);
  expect(host.querySelector(".waka-over-what"), "the one-visit line is gone").toBeNull();
});

/* AN AGENT'S PRINCIPLES ARE NOT YOURS (review, 2026-10-16): the same page
   reads an agent's wall, and the bubble must say whose they are. */
it("says these are your agent's principles on an agent's wall", async () => {
  vi.mocked(fetchPrinciples).mockResolvedValue([PRINCIPLE]);
  await act(async () => root.render(
    <PrinciplesOverlay locale="en-US" profileId={PROFILE} name="Bot" title="Your Agent's Principles" whose="agent" onClose={() => {}} onOpen={() => {}} />,
  ));
  const said = host.querySelector(".waka-held-hero .waka-held-says")?.textContent ?? "";
  expect(said).toBe("These are your agent’s principles: what has stayed true across its top of mind for a long time.");
  expect(said).not.toContain("These are your principles");
});

it("on an agent's wall, the waiting ground and the first-principle greeting speak of the agent", async () => {
  const agentPage = () => act(async () => root.render(
    <PrinciplesOverlay locale="en-US" profileId={PROFILE} name="Bot" title="Your Agent's Principles" whose="agent" onClose={() => {}} onOpen={() => {}} />,
  ));
  vi.mocked(fetchSignals).mockResolvedValue([]);
  vi.mocked(fetchPrinciples).mockResolvedValue([]);
  await agentPage();
  expect(line()).toBe("More inspirations from your agent will help WAKA find patterns for its first principle.");
  expect(host.querySelector(".waka-ground-foot")?.textContent).toBe("Your agent’s first principle");
  expect(host.querySelector(".waka-ground")?.getAttribute("aria-label")).toBe("What your agent’s first principle will grow from");

  vi.mocked(fetchPrinciples).mockResolvedValue([{ ...PRINCIPLE, citedSignals: [{ examples: [{}, {}] }] } as unknown as ApiPrinciple]);
  await act(async () => root.unmount());
  root = createRoot(host);
  await agentPage();
  expect(host.querySelector(".waka-held-first")?.textContent).toBe("Here it is. Your agent’s first principle.");
  expect(host.querySelector(".waka-held-proof")?.textContent).toContain("Drawn from two things it kept");
  expect(host.textContent).not.toMatch(/your (first )?principle|you kept/i);
});

it("offers no chat about the creature's line on an agent's ground", async () => {
  vi.mocked(fetchSignals).mockResolvedValue([signal("a", "A.")]);
  vi.mocked(fetchPrinciples).mockResolvedValue([]);
  await act(async () => root.render(
    <PrinciplesOverlay locale="en-US" profileId={PROFILE} name="Bot" title="Your Agent's Principles" whose="agent" onClose={() => {}} onOpen={() => {}} onChat={() => {}} />,
  ));
  expect(host.querySelector(".waka-ground-bubble")).not.toBeNull();
  expect(host.querySelector(".waka-ground-bubble .jar-char-bubble-act"), "the agent's line is not yours to open a chat with").toBeNull();
});

it.each([0, 1, 2])("offers the existing inspiration draft when only %i patterns are available", async (count) => {
  vi.mocked(fetchSignals).mockResolvedValue(Array.from({ length: count }, (_, index) => signal(String(index), "A pattern.")));
  vi.mocked(fetchPrinciples).mockResolvedValue([]);
  const add = vi.fn(), chat = vi.fn();
  await act(async () => root.render(
    <PrinciplesOverlay locale="en-US" profileId={PROFILE} name="Agi" title="Principles"
      onClose={() => {}} onOpen={() => {}} onNewSave={add} newSaveLabel="Continue draft" onChat={chat} />,
  ));
  const actions = host.querySelectorAll<HTMLButtonElement>(".waka-ground-bubble .jar-char-bubble-act");
  expect(actions).toHaveLength(1);
  expect(actions[0]!.textContent).toBe("Continue draft");
  await act(async () => actions[0]!.click());
  expect(add).toHaveBeenCalledTimes(1);
  expect(chat).not.toHaveBeenCalled();
});

it("explains an agent’s empty memory in Korean without offering to write into it", async () => {
  vi.mocked(fetchSignals).mockResolvedValue([]);
  vi.mocked(fetchPrinciples).mockResolvedValue([]);
  const add = vi.fn();
  await act(async () => root.render(
    <PrinciplesOverlay locale="ko-KR" profileId={PROFILE} name="Bot" title="에이전트의 원칙" whose="agent"
      onClose={() => {}} onOpen={() => {}} onNewSave={add} onChat={() => {}} />,
  ));
  expect(line()).toBe("에이전트의 영감이 더 쌓이면 WAKA가 반복되는 패턴을 찾아 첫 원칙을 만들 수 있어요.");
  expect(host.querySelector(".waka-ground-how")?.textContent).toContain("이 에이전트의 영감과 탑 오브 마인드만");
  expect(host.querySelector(".waka-ground-example")?.textContent).toContain("원칙 예시");
  expect(host.querySelector(".waka-ground-bubble button")).toBeNull();
  expect(fetchSignals).toHaveBeenCalledWith({ profile: PROFILE, status: "active", limit: 20 });
  expect(add).not.toHaveBeenCalled();
});
