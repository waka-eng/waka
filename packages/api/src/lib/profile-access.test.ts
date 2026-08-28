/**
 * The access matrix, proven cell by cell.
 *
 * Every combination of (who the session acts as) × (whose profile is being
 * touched) × (what is being done) is asserted here rather than sampled,
 * because this function is the whole of "what can an agent do to my memory?"
 * and a gap in it is not visible from any single route's tests.
 *
 * Since no-quiet-corners Phase 6 the matrix answers in three words:
 * `allowed`, `denied`, or `sibling_grant_required` — the last being the
 * founder-ruled flip (2026-08-23, signed in data-model.md's decision log):
 * an agent reaching for a SIBLING agent's memory goes through an explicit,
 * human-granted, revocable grant, checked live by `profileAccessError`.
 * The grant's own behavior — granted reads, refused without, revocation on
 * the next request — is pinned on real Postgres in
 * `sibling-grants.db.test.ts`; this file pins the pure matrix.
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

describe("an agent-profile session may read and capture into the human profile", () => {
  it("may read it — the conditioning case, no grant needed", () => {
    expect(resolveProfileAccess(agentSession, ownProfile, "read")).toBe("allowed");
  });

  it("may capture into it — relaying what the person asked to save", () => {
    expect(resolveProfileAccess(agentSession, ownProfile, "capture")).toBe("allowed");
  });

  it("may NOT write to it — curating the person's memory is not its to do", () => {
    expect(resolveProfileAccess(agentSession, ownProfile, "write")).toBe("denied");
  });
});

describe("the sibling door has a hand on it — the ruled flip", () => {
  it("a sibling read or capture goes through the grant, never through the matrix alone", () => {
    expect(resolveProfileAccess(agentSession, siblingAgent, "read")).toBe(
      "sibling_grant_required",
    );
    expect(resolveProfileAccess(agentSession, siblingAgent, "capture")).toBe(
      "sibling_grant_required",
    );
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
