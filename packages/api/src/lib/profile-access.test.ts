/**
 * The access matrix, proven cell by cell.
 *
 * Every combination of (who the session acts as) × (whose profile is being
 * touched) × (what is being done) is asserted here rather than sampled,
 * because this function is the whole of "what can an agent do to my memory?"
 * and a gap in it is not visible from any single route's tests.
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

const ownProfile = { id: HUMAN, accountId: ACCOUNT };
const agentProfile = { id: AGENT, accountId: ACCOUNT };
const siblingAgent = { id: SECOND_AGENT, accountId: ACCOUNT };
const foreignProfile = { id: STRANGER, accountId: OTHER_ACCOUNT };

const OPERATIONS: ProfileOperation[] = ["read", "capture", "write"];

describe("a human-profile session is the account's owner", () => {
  it.each(OPERATIONS)("may %s its own profile", (operation) => {
    expect(resolveProfileAccess(humanSession, ownProfile, operation)).toBe(true);
  });

  it.each(OPERATIONS)("may %s an agent profile it owns", (operation) => {
    expect(resolveProfileAccess(humanSession, agentProfile, operation)).toBe(true);
    expect(resolveProfileAccess(humanSession, siblingAgent, operation)).toBe(true);
  });

  it.each(OPERATIONS)("may not %s a profile in another account", (operation) => {
    expect(resolveProfileAccess(humanSession, foreignProfile, operation)).toBe(false);
  });
});

describe("an agent-profile session works inside its own memory", () => {
  it.each(OPERATIONS)("may %s its own profile", (operation) => {
    expect(resolveProfileAccess(agentSession, agentProfile, operation)).toBe(true);
  });
});

describe("an agent-profile session may read and capture into the human profile", () => {
  it("may read it — the conditioning case", () => {
    expect(resolveProfileAccess(agentSession, ownProfile, "read")).toBe(true);
  });

  it("may capture into it — relaying what the person asked to save", () => {
    expect(resolveProfileAccess(agentSession, ownProfile, "capture")).toBe(true);
  });

  it("may NOT write to it — curating the person's memory is not its to do", () => {
    expect(resolveProfileAccess(agentSession, ownProfile, "write")).toBe(false);
  });
});

describe("an agent-profile session is not privileged over its siblings", () => {
  it("may read and capture into another agent's profile in the same account", () => {
    expect(resolveProfileAccess(agentSession, siblingAgent, "read")).toBe(true);
    expect(resolveProfileAccess(agentSession, siblingAgent, "capture")).toBe(true);
  });

  it("may not write to another agent's profile", () => {
    expect(resolveProfileAccess(agentSession, siblingAgent, "write")).toBe(false);
  });
});

describe("nothing reaches across accounts", () => {
  it.each(OPERATIONS)("an agent session may not %s a foreign profile", (operation) => {
    expect(resolveProfileAccess(agentSession, foreignProfile, operation)).toBe(false);
  });

  it("account identity is what decides, not profile identity", () => {
    // Same profile id, different account: still refused. Guards against a
    // check that compares ids and forgets the tenant.
    const collidingId = { id: HUMAN, accountId: OTHER_ACCOUNT };
    for (const operation of OPERATIONS) {
      expect(resolveProfileAccess(humanSession, collidingId, operation)).toBe(false);
    }
  });
});
