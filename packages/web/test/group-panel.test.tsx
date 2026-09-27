// @vitest-environment jsdom
/**
 * THE APPROVAL SURFACE, PINNED.
 *
 * goal: a-room-you-can-trust, Phase 1c. Three laws this panel must keep:
 *
 *   1. A proposal arrives signed — the room reads WHO is asking.
 *   2. The whole room is shown, the ones who agreed lit and the rest dimmed,
 *      so you can always tell whether the missing approval is your own —
 *      and NO NUMERAL anywhere: the count is legible because the people are.
 *   3. Saying no is not the only answer: the counter carries the proposal's
 *      words into your own draft box, to be reshaped and put back.
 *
 * jsdom render of the real component with fixture props; no canvas, no
 * network, no Home.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). The panel's callback props
 * (`setPropose`, `answerProposal`, `sendProposal`, `onRetryProposals`,
 * `onClose`) are vi.fn spies: each is a verb
 * the PAGE owns — network calls and page state live in Home, and this suite
 * is about what the panel SHOWS and which verb it fires, not about what the
 * page then does with it (Home's own suites cover that side of the seam).
 * The data props (`members`, `openProposals`) are fixture values
 * in the exact shape the API client returns, replacing the network read for
 * the same reason. Nothing else is replaced: the component under test is the
 * real one, rendered by the real React into a real (jsdom) document.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiGroupMember, ApiGroupProposal } from "../src/lib/api";
import { GroupPanel, type GroupPanelProps } from "../src/space-kinds/GroupPanel";
import type { Space } from "../src/space-kinds";

const GROUP_ID = "00000000-0000-4000-8000-00000000aaaa";

function member(profileId: string, name: string, role: "owner" | "member"): ApiGroupMember {
  return { profileId, name, initials: name.slice(0, 1), type: "human", role, joinedAt: "" } as ApiGroupMember;
}

function proposal(input: {
  id: string;
  body: string;
  by: { profileId: string; name: string };
  affirmedBy: Array<{ profileId: string; name: string }>;
  declinedBy?: Array<{ profileId: string; name: string }>;
  viewerStance?: "affirmed" | "declined" | null;
}): ApiGroupProposal {
  return {
    id: input.id,
    kind: "add_entry",
    status: "open",
    entryId: null,
    body: input.body,
    rationale: null,
    proposedByProfileId: input.by.profileId,
    proposedByName: input.by.name,
    stances: [
      ...input.affirmedBy.map((a) => ({ ...a, value: "affirmed" as const, createdAt: "" })),
      ...(input.declinedBy ?? []).map((a) => ({
        ...a,
        value: "declined" as const,
        createdAt: "",
      })),
    ],
    viewerStance: input.viewerStance ?? null,
    resolvedAt: null,
    createdAt: "",
  } as ApiGroupProposal;
}

let root: Root | null = null;
let host: HTMLElement | null = null;

function renderPanel(overrides: Partial<GroupPanelProps>): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  const props: GroupPanelProps = {
    groupId: GROUP_ID,
    space: { kind: "group", id: GROUP_ID, name: "the reading circle", col: 1 } as unknown as Space,
    members: new Map(),
    openProposals: new Map(),
    timeline: null,
    selectedStop: null,
    proposalState: "ready",
    onRetryProposals: vi.fn(),
    pendingProposalId: null,
    receipt: null,
    trouble: null,
    propose: null,
    setPropose: vi.fn(),
    sendProposal: vi.fn(),
    answerProposal: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  act(() => {
    root = createRoot(host!);
    root.render(<GroupPanel {...props} />);
  });
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const ARI = { profileId: "00000000-0000-4000-8000-000000000001", name: "Ari Han" };
const BO = { profileId: "00000000-0000-4000-8000-000000000002", name: "Bo Lee" };
const CY = { profileId: "00000000-0000-4000-8000-000000000003", name: "Cy Park" };
const DEE = { profileId: "00000000-0000-4000-8000-000000000004", name: "Dee Song" };

describe("the approval surface", () => {
  it("keeps the current room's proposal action ahead of history and separate from settings", () => {
    const el = renderPanel({});
    expect(el.textContent).toContain("shape this together");
    expect(el.textContent).toContain("put something to this room");
    expect(el.textContent).not.toContain("copy the invite link");
    expect(el.textContent).not.toContain("leave this room");
  });

  it("does not offer a new proposal while the room's questions are still loading", () => {
    const el = renderPanel({ proposalState: "loading" });
    expect(el.textContent).toContain("Checking what the room is considering");
    expect(el.textContent).not.toContain("put something to this room");
  });

  it("shows a failed proposal read with a working retry", () => {
    const onRetryProposals = vi.fn();
    const el = renderPanel({ proposalState: "failed", onRetryProposals });
    expect(el.querySelector('[role="alert"]')?.textContent).toContain("could not be loaded");
    const retry = [...el.querySelectorAll("button")].find((button) => button.textContent === "Try again");
    act(() => retry?.click());
    expect(onRetryProposals).toHaveBeenCalledTimes(1);
  });

  it("signs the proposal, lights the whole four-person room in three states, and prints no numeral", () => {
    const el = renderPanel({
      members: new Map([
        [
          GROUP_ID,
          [member(ARI.profileId, ARI.name, "owner"), member(BO.profileId, BO.name, "member"), member(CY.profileId, CY.name, "member"), member(DEE.profileId, DEE.name, "member")],
        ],
      ]),
      openProposals: new Map([
        [
          GROUP_ID,
          [
            proposal({
              id: "00000000-0000-4000-8000-00000000bbbb",
              body: "We keep choosing walks over meetings.",
              by: ARI,
              affirmedBy: [ARI, BO],
              declinedBy: [CY],
            }),
          ],
        ],
      ]),
    });

    expect(el.textContent, "the proposal arrived unsigned").toContain("Ari put this to the room");

    const said = [...el.querySelectorAll(".jar-said")].map((n) => n.textContent?.trim());
    const saidNo = [...el.querySelectorAll(".jar-said-no")].map((n) => n.textContent?.trim());
    const notSaid = [...el.querySelectorAll(".jar-not-said")].map((n) => n.textContent?.trim());
    expect(said.join(" ")).toContain("Ari");
    expect(said.join(" ")).toContain("Bo");
    expect(
      saidNo.join(" "),
      "a recorded no must stand in the room as a person, not vanish (the counted-stance ruling)",
    ).toContain("Cy");
    expect(notSaid.join(" "), "the missing approvals are not visible as people").toContain("Dee");

    expect(
      /\d/.test(el.textContent ?? ""),
      "a numeral appeared on the approval surface — the count must be legible because the people are",
    ).toBe(false);
  });

  it("shows a two-person room whole, and tells the viewer the missing approval is their own", () => {
    const el = renderPanel({
      members: new Map([
        [GROUP_ID, [member(ARI.profileId, ARI.name, "owner"), member(BO.profileId, BO.name, "member")]],
      ]),
      openProposals: new Map([
        [
          GROUP_ID,
          [
            proposal({
              id: "00000000-0000-4000-8000-00000000bbbb",
              body: "Two of us is already a room.",
              by: ARI,
              affirmedBy: [ARI],

            }),
          ],
        ],
      ]),
    });

    expect([...el.querySelectorAll(".jar-said, .jar-not-said")]).toHaveLength(2);
    // The viewer has not answered, so the verbs are on screen.
    expect(el.textContent).toContain("yes, that is us");
    expect(el.textContent).toContain("not us");
  });

  it("the counter carries the proposal's words into the draft box", () => {
    const setPropose = vi.fn();
    const el = renderPanel({
      setPropose,
      members: new Map([
        [GROUP_ID, [member(ARI.profileId, ARI.name, "owner"), member(BO.profileId, BO.name, "member")]],
      ]),
      openProposals: new Map([
        [
          GROUP_ID,
          [
            proposal({
              id: "00000000-0000-4000-8000-00000000bbbb",
              body: "We keep choosing walks over meetings.",
              by: ARI,
              affirmedBy: [ARI],

            }),
          ],
        ],
      ]),
    });

    const counter = [...el.querySelectorAll("button")].find(
      (b) => b.textContent === "say it differently",
    );
    expect(counter, "no way to counter").toBeTruthy();
    act(() => counter!.click());
    expect(setPropose).toHaveBeenCalledWith({
      text: "We keep choosing walks over meetings.",
      busy: false,
    });
  });

  it("tells the room so far in words — moves and door marks, no numeral", () => {
    const el = renderPanel({
      members: new Map([
        [GROUP_ID, [member(ARI.profileId, ARI.name, "owner"), member(BO.profileId, BO.name, "member")]],
      ]),
      timeline: {
        versions: [
          { id: "v2", version: 2, status: "live", reason: "member_proposal", entryCount: 3, createdAt: "2026-08-20T00:00:00.000Z" },
          { id: "v1", version: 1, status: "superseded", reason: "initial", entryCount: 2, createdAt: "2026-08-10T00:00:00.000Z" },
          { id: "v0", version: 3, status: "superseded", reason: "no_change", entryCount: 3, createdAt: "2026-08-21T00:00:00.000Z" },
        ],
        doorMarks: [
          { profileId: ARI.profileId, name: ARI.name, kind: "joined", occurredAt: "2026-08-01T00:00:00.000Z" },
          { profileId: BO.profileId, name: BO.name, kind: "joined", occurredAt: "2026-08-05T00:00:00.000Z" },
          { profileId: BO.profileId, name: BO.name, kind: "removed", occurredAt: "2026-08-15T00:00:00.000Z" },
        ],
      },
    });

    expect(el.textContent).toContain("the room so far");
    expect(el.textContent).toContain("the room first spoke");
    expect(el.textContent).toContain("a proposal carried");
    expect(el.textContent).toContain("Bo was removed");
    expect(el.textContent).toContain("Ari arrived");
    expect(
      el.textContent,
      "an honest no_change pass is not an event in the room's life",
    ).not.toContain("re-read itself");
    /* Dates may be digits now — a calendar date is a LABEL a person reads,
       not a state (the ruling refinement written into `dateWords`, folded in
       from the world-craft session). What must stay worded is everything
       that IS a state: versions are events, counts are words. So the sweep
       strips the date labels and then insists on silence from digits. */
    /* no trailing \b: textContent glues the date to the next word ("Aug
       20Bo…"), and digit-to-letter is not a boundary */
    const withoutDates = (el.textContent ?? "").replace(
      /\b[A-Z][a-z]{2} \d{1,2}(, \d{4})?/g,
      "",
    );
    expect(
      /\d/.test(withoutDates),
      "a numeral appeared on the timeline beyond the date labels — versions are events, counts are words",
    ).toBe(false);
  });

  it("an answered proposal says so instead of asking again", () => {
    const el = renderPanel({
      members: new Map([
        [GROUP_ID, [member(ARI.profileId, ARI.name, "owner"), member(BO.profileId, BO.name, "member")]],
      ]),
      openProposals: new Map([
        [
          GROUP_ID,
          [
            proposal({
              id: "00000000-0000-4000-8000-00000000bbbb",
              body: "Two of us is already a room.",
              by: ARI,
              affirmedBy: [ARI, BO],
              viewerStance: "affirmed",
            }),
          ],
        ],
      ]),
    });

    expect(el.textContent).toContain("you agreed");
    expect(el.textContent).not.toContain("yes, that is us");
    // ...but the open question still offers the other answer (the
    // counted-stance ruling: an answer is not a door that locks behind you)
    expect(el.textContent).toContain("not us after all");
  });

  it("a recorded no says so, and offers the yes back", () => {
    const el = renderPanel({
      members: new Map([
        [GROUP_ID, [member(ARI.profileId, ARI.name, "owner"), member(BO.profileId, BO.name, "member"), member(CY.profileId, CY.name, "member")]],
      ]),
      openProposals: new Map([
        [
          GROUP_ID,
          [
            proposal({
              id: "00000000-0000-4000-8000-00000000bbbb",
              body: "Two of us is already a room.",
              by: ARI,
              affirmedBy: [ARI],
              declinedBy: [BO],
              viewerStance: "declined",
            }),
          ],
        ],
      ]),
    });

    expect(el.textContent).toContain("you said not us");
    expect(el.textContent).toContain("yes, that is us after all");
    expect(
      /\d/.test(el.textContent ?? ""),
      "a numeral appeared on the approval surface",
    ).toBe(false);
  });
});
