/**
 * The access matrix, proven cell by cell.
 *
 * Every combination of (who the session acts as) × (whose profile is being
 * touched) × (what is being done) is asserted here rather than sampled,
 * because this function is the whole of "what can an agent do to my memory?"
 * and a gap in it is not visible from any single route's tests.
 *
 * Agent sessions are isolated to their bound profile, for every operation.
 * Historical sibling grants cannot widen that boundary.
 */

import { describe, expect, it } from "vitest";

import type { AuthenticatedSession } from "./session.js";
import { type ProfileOperation, resolveProfileAccess } from "./middleware.js";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const OTHER_ACCOUNT = "22222222-2222-4222-8222-222222222222";

const HUMAN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SECOND_AGENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const STRANGER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function session(profileId: string, type: "human" | "agent"): AuthenticatedSession {
  return {
    sessionId: "session-1",
    account: { id: ACCOUNT, email: "owner@example.test" },
    profile: {
      id: profileId,
      accountId: ACCOUNT,
      type,
      name: type === "human" ? "Owner" : "Agent",
      preferredLocale: "en-US",
    },
  };
}

const humanSession = session(HUMAN, "human");
const agentSession = session(AGENT, "agent");

const ownProfile = { id: HUMAN, accountId: ACCOUNT, type: "human" as const };
const agentProfile = { id: AGENT, accountId: ACCOUNT, type: "agent" as const };
const siblingAgent = { id: SECOND_AGENT, accountId: ACCOUNT, type: "agent" as const };
const foreignProfile = { id: STRANGER, accountId: OTHER_ACCOUNT, type: "human" as const };

const OPERATIONS: ProfileOperation[] = ["read", "capture", "write"];

describe("a human-profile session is the account's owner", () => {
  it.each(OPERATIONS)("may %s its own profile", (operation) => {
    expect(resolveProfileAccess(humanSession, ownProfile, operation)).toBe("allowed");
  });

  it.each(OPERATIONS)("may %s an agent profile it owns — no grant needed anywhere", (operation) => {
    expect(resolveProfileAccess(humanSession, agentProfile, operation)).toBe("allowed");
    expect(resolveProfileAccess(humanSession, siblingAgent, operation)).toBe("allowed");
  });

  it.each(OPERATIONS)("may not %s a profile in another account", (operation) => {
    expect(resolveProfileAccess(humanSession, foreignProfile, operation)).toBe("denied");
  });
});

describe("an agent-profile session works inside its own memory", () => {
  it.each(OPERATIONS)("may %s its own profile — its bound profile needs no grant", (operation) => {
    expect(resolveProfileAccess(agentSession, agentProfile, operation)).toBe("allowed");
  });
});

describe("an agent-profile session cannot access the human profile", () => {
  it("may not read it — only its own profile is reachable", () => {
    expect(resolveProfileAccess(agentSession, ownProfile, "read")).toBe("denied");
  });

  /* The 2026-08-29 ruling: what an agent generates stays wholly in its own
     stack, so nothing it saves can move the human's signals or top of mind.
     This retires the read+capture default of 2026-08-15 — the relaying case
     is the person keeping the memory themselves. */
  it("may NOT capture into it — agent-generated memory never enters the human's stack", () => {
    expect(resolveProfileAccess(agentSession, ownProfile, "capture")).toBe("denied");
  });

  it("may NOT write to it — curating the person's memory is not its to do", () => {
    expect(resolveProfileAccess(agentSession, ownProfile, "write")).toBe("denied");
  });
});

describe("sibling agent profiles remain isolated", () => {
  it("a sibling read is denied regardless of historical grants", () => {
    expect(resolveProfileAccess(agentSession, siblingAgent, "read")).toBe(
      "denied",
    );
  });

  /* Same 2026-08-29 ruling, sibling edition: a grant opens READING only.
     Capture across agents would mix one agent's generated memory into
     another's stack, which no grant may do. */
  it("a sibling capture is denied outright — no grant mixes agents' stacks", () => {
    expect(resolveProfileAccess(agentSession, siblingAgent, "capture")).toBe("denied");
  });

  it("may not write to another agent's profile — no grant reaches write", () => {
    expect(resolveProfileAccess(agentSession, siblingAgent, "write")).toBe("denied");
  });
});

describe("nothing reaches across accounts", () => {
  it.each(OPERATIONS)("an agent session may not %s a foreign profile", (operation) => {
    expect(resolveProfileAccess(agentSession, foreignProfile, operation)).toBe("denied");
  });

  it("account identity is what decides, not profile identity", () => {
    // Same profile id, different account: still refused. Guards against a
    // check that compares ids and forgets the tenant.
    const collidingId = { id: HUMAN, accountId: OTHER_ACCOUNT, type: "human" as const };
    for (const operation of OPERATIONS) {
      expect(resolveProfileAccess(humanSession, collidingId, operation)).toBe("denied");
    }
  });
});

describe("a keeper key is the person, scoped down to keep-and-recall", () => {
  /* The standing credential in an MCP config file (2026-08-29): it reads
     and captures its OWN profile and does nothing else — never the account
     admin the same person is at a browser. */
  const keeperSession = { ...session(HUMAN, "human"), keyScoped: true as const };
  const ownAgent = { id: AGENT, accountId: ACCOUNT, type: "agent" as const };

  it("reads and captures its own profile", () => {
    expect(resolveProfileAccess(keeperSession, ownProfile, "read")).toBe("allowed");
    expect(resolveProfileAccess(keeperSession, ownProfile, "capture")).toBe("allowed");
  });

  it("may not curate even its own profile — a config file does not edit memory", () => {
    expect(resolveProfileAccess(keeperSession, ownProfile, "write")).toBe("denied");
  });

  it.each(OPERATIONS)(
    "gets nothing on the account's other profiles — %s denied",
    (operation) => {
      expect(resolveProfileAccess(keeperSession, ownAgent, operation)).toBe("denied");
    },
  );

  it.each(OPERATIONS)("and nothing across accounts — %s denied", (operation) => {
    expect(resolveProfileAccess(keeperSession, foreignProfile, operation)).toBe("denied");
  });
});
