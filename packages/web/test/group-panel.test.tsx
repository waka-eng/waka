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
 * (`setPropose`, `answerProposal`, `copyInvite`, `leaveThisGroup`,
 * `sendProposal`, `setLeaving`, `onClose`) are vi.fn spies: each is a verb
 * the PAGE owns — network calls and page state live in Home, and this suite
 * is about what the panel SHOWS and which verb it fires, not about what the
 * page then does with it (Home's own suites cover that side of the seam).
 * The data props (`members`, `openProposals`, `groups`) are fixture values
 * in the exact shape the API client returns, replacing the network read for
 * the same reason. Nothing else is replaced: the component under test is the
 * real one, rendered by the real React into a real (jsdom) document.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiGroupMember, ApiGroupProposal, ApiGroupSummary } from "../src/lib/api";
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
  viewerAffirmed: boolean;
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
    affirmations: input.affirmedBy.map((a) => ({ ...a, createdAt: "" })),
    viewerAffirmed: input.viewerAffirmed,
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
    groups: [{ id: GROUP_ID, name: "the reading circle", joinCode: "CODE", role: "member" } as unknown as ApiGroupSummary],
    members: new Map(),
    openProposals: new Map(),
    propose: null,
    setPropose: vi.fn(),
    sendProposal: vi.fn(),
    answerProposal: vi.fn(),
    copied: null,
    copyInvite: vi.fn(),
    leaving: null,
    setLeaving: vi.fn(),
    leaveThisGroup: vi.fn(),
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
  it("signs the proposal, lights the whole four-person room, and prints no numeral", () => {
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
              viewerAffirmed: false,
            }),
          ],
        ],
      ]),
    });

    expect(el.textContent, "the proposal arrived unsigned").toContain("Ari put this to the room");

    const said = [...el.querySelectorAll(".jar-said")].map((n) => n.textContent?.trim());
    const notSaid = [...el.querySelectorAll(".jar-not-said")].map((n) => n.textContent?.trim());
    expect(said.join(" ")).toContain("Ari");
    expect(said.join(" ")).toContain("Bo");
    expect(notSaid.join(" "), "the missing approvals are not visible as people").toContain("Cy");
    expect(notSaid.join(" ")).toContain("Dee");

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
              viewerAffirmed: false,
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
              viewerAffirmed: false,
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
              viewerAffirmed: true,
            }),
          ],
        ],
      ]),
    });

    expect(el.textContent).toContain("you agreed");
    expect(el.textContent).not.toContain("yes, that is us");
  });
});
