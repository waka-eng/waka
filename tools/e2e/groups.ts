/**
 * The group gate: what crosses between people, and what must never.
 *
 * A wall shows members' distilled signals. The inspirations behind them stay
 * with their owner — that boundary is the whole reason sharing lives at layer
 * 2, and it is the one thing here that cannot be allowed to regress quietly.
 * So the leak check does not inspect a field: it captures a phrase nobody
 * would write twice, then greps *every* group response for it.
 *
 *   pnpm tsx tools/e2e/groups.ts [--base-url http://localhost:3010]
 */

import {
  capture,
  deleteAccount,
  health,
  listSignals,
  mintAgentToken,
  signUp,
  waitFor,
  type Session,
  type Signal,
} from "./organic.js";

const DEFAULT_BASE_URL = "http://localhost:3010";
const DERIVATION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * A phrase that appears in exactly one capture and nowhere else, so finding
 * it anywhere in a group payload is unambiguous evidence of a leak.
 */
const SECRET_PHRASE = "the porcelain kestrel on my grandmother's windowsill";

/*
 * TWO ARCHIVES THAT MEET. A room's statement is served only where memories
 * from two different members stand under the SAME one, so these two say the
 * same thing — an object matters because it was USED, not because it was
 * kept — in two people's different words. Archives that merely share a topic
 * mint two statements with one voice each and serve neither, which would make
 * this harness fail for a reason that is not a defect.
 *
 * The owner's first line carries `SECRET_PHRASE`, which the leak step later
 * hunts for across every group surface: raw capture text must never cross to
 * another member, however much of the room grew out of it.
 */
const OWNER_ARCHIVE = [
  `I keep coming back to ${SECRET_PHRASE}, and I still cannot say why it matters to me.`,
  "Small inherited objects carry more of a person than any photograph I own.",
  "I would rather keep one thing that was held daily than a shelf of things that were displayed.",
  "The teacup my grandmother used every morning means more than the set nobody touched.",
  "What makes an heirloom is the wear on it — the handling, not the keeping.",
];

const MEMBER_ARCHIVE = [
  "My father's tools are the only inheritance I actually use. The rest sits in a box.",
  "An object earns its place by being used, not by being kept.",
  "I am slowly giving away everything I own that I do not touch.",
  "The chair he sat in every evening is the only thing of his I wanted.",
  "A thing that was handled daily holds a person; a thing on display holds nothing.",
];

/** A row the wall serves: the room's own statement, and who stands under it. */
interface WallRow {
  signalId: string;
  statement: string;
  contributors: Array<{ profileId: string; name: string }>;
  reactions?: Array<{ profileId: string; name: string; value: string }>;
}

const results: Array<{ ok: boolean }> = [];

async function step(title: string, run: () => Promise<string>): Promise<void> {
  const started = Date.now();
  const index = results.length + 1;
  try {
    const detail = await run();
    results.push({ ok: true });
    console.log(`PASS ${index}. ${title} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    console.log(`     ${detail}`);
  } catch (err) {
    results.push({ ok: false });
    console.log(`FAIL ${index}. ${title} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    console.log(`     ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function api<T>(
  session: Session,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: T; raw: string }> {
  const response = await fetch(`${session.baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
      ...(init.headers ?? {}),
    },
  });
  const raw = await response.text();
  let body: unknown = null;
  try {
    body = raw.length > 0 ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }
  return { status: response.status, body: body as T, raw };
}

async function waitForSignal(session: Session, label: string): Promise<Signal> {
  return waitFor(
    async ({ note }) => {
      const signals = await listSignals(session, { limit: 50 });
      note(`${signals.length} signals`);
      return signals[0] ?? null;
    },
    { timeoutMs: DERIVATION_TIMEOUT_MS, label },
  );
}

async function main(): Promise<void> {
  const baseUrl = process.argv.includes("--base-url")
    ? process.argv[process.argv.indexOf("--base-url") + 1]!
    : DEFAULT_BASE_URL;

  console.log(`[groups] base url: ${baseUrl}\n`);

  let owner: Session | undefined;
  let member: Session | undefined;

  try {
    await step("the stack answers as waka", async () => {
      const body = await health(baseUrl);
      if (body.service !== "waka") throw new Error(`service=${body.service}`);
      return `service=${body.service}`;
    });

    let groupId = "";
    let joinCode = "";
    await step("two people each build an archive and meet in a group", async () => {
      owner = await signUp({ baseUrl });
      member = await signUp({ baseUrl });
      /* PUBLIC, because a room reads its members' public memories and grows
         its own statements from them; a private archive leaves the wall
         correctly empty and this harness with nothing to check. */
      for (const text of OWNER_ARCHIVE) {
        await capture(owner, { text, kind: "note", visibility: "public" });
      }
      for (const text of MEMBER_ARCHIVE) {
        await capture(member, { text, kind: "note", visibility: "public" });
      }

      const created = await api<{ group: { id: string; joinCode: string } }>(
        owner,
        "/api/groups",
        { method: "POST", body: JSON.stringify({ name: "Inherited things" }) },
      );
      if (created.status !== 200 && created.status !== 201) {
        throw new Error(`create group → ${created.status}: ${created.raw.slice(0, 200)}`);
      }
      groupId = created.body.group.id;
      joinCode = created.body.group.joinCode;

      const joined = await api(member, "/api/groups/join", {
        method: "POST",
        body: JSON.stringify({ joinCode }),
      });
      if (joined.status !== 200 && joined.status !== 201) {
        throw new Error(`join → ${joined.status}: ${joined.raw.slice(0, 200)}`);
      }
      return `group ${groupId.slice(0, 8)}, two members`;
    });

    let wallSignalId = "";
    await step("the room grows its own statements from the pooled ground", async () => {
      /* Nobody puts anything up. Forming the room asked it to read the ground
         both members already stood on, and a statement appears where their
         memories meet — so this waits for the model rather than asserting the
         wall instantly. Their own signals form first; waiting for those keeps
         a slow personal derivation from reading as a failed room. */
      await waitForSignal(owner!, "the owner's first signal");
      await waitForSignal(member!, "the member's first signal");

      const wall = await waitFor(
        async ({ note }) => {
          const seen = await api<{ wall: WallRow[] }>(
            member!,
            `/api/groups/${groupId}/wall`,
          );
          if (seen.status !== 200) throw new Error(`wall → ${seen.status}`);
          note(`${seen.body.wall.length} statements the room grew`);
          return seen.body.wall.length > 0 ? seen.body.wall : null;
        },
        { timeoutMs: 240_000, label: "the room's first statement of its own" },
      );

      wallSignalId = wall[0]!.signalId;
      return `${wall.length} statements`;
    });

    await step("every statement on the wall stands on two members, named", async () => {
      const wall = await api<{ wall: WallRow[] }>(member!, `/api/groups/${groupId}/wall`);
      if (wall.status !== 200) throw new Error(`wall → ${wall.status}`);
      if (wall.body.wall.length === 0) throw new Error("the wall emptied between steps");

      /* THE TWO-VOICES GATE, from outside. A statement one member's memories
         support is that member's own — already on their own wall — and must
         never wear the room's name. The wall is where that rule is visible,
         so it is checked here rather than trusted. */
      for (const row of wall.body.wall) {
        const voices = new Set(row.contributors.map((c) => c.profileId));
        if (voices.size < 2) {
          throw new Error(
            `"${row.statement.slice(0, 60)}" is served with ${voices.size} voice(s)`,
          );
        }
        if (row.contributors.some((c) => !c.name)) {
          throw new Error("a contributor reached the wall unnamed");
        }
      }

      const everyone = new Set(
        wall.body.wall.flatMap((row) => row.contributors.map((c) => c.profileId)),
      );
      return `${wall.body.wall.length} statements, ${everyone.size} members standing under them`;
    });

    await step("a member can answer a statement the room grew", async () => {
      /* Answerability used to come from the share: you may answer what
         somebody put up. A room-grown statement was put up by nobody, so the
         rule is now membership — you are in the room whose mind holds it.
         Checked from outside because it is the one authorization rule the
         room-grown wall added. */
      const answered = await api(member!, "/api/feedback", {
        method: "POST",
        body: JSON.stringify({
          targetType: "signal",
          targetId: wallSignalId,
          value: "true",
        }),
      });
      if (answered.status !== 200 && answered.status !== 201) {
        throw new Error(`feedback → ${answered.status}: ${answered.raw.slice(0, 200)}`);
      }

      const wall = await api<{ wall: WallRow[] }>(member!, `/api/groups/${groupId}/wall`);
      const row = wall.body.wall.find((candidate) => candidate.signalId === wallSignalId);
      if (!row) throw new Error("the answered statement left the wall");
      if (!row.reactions?.some((r) => r.value === "true")) {
        throw new Error("the answer did not come back on the wall");
      }
      return `answered, and named on the wall`;
    });

    await step("no group surface exposes another member's raw capture", async () => {
      const surfaces = [
        `/api/groups`,
        `/api/groups/${groupId}/wall`,
        `/api/groups/${groupId}/members`,
        `/api/groups/${groupId}/top-of-mind`,
        `/api/groups/${groupId}/proposals`,
      ];

      const needle = SECRET_PHRASE.toLowerCase();
      const leaked: string[] = [];
      for (const path of surfaces) {
        const response = await api(member!, path);
        if (response.raw.toLowerCase().includes(needle)) leaked.push(path);
      }

      if (leaked.length > 0) {
        throw new Error(`raw capture text reachable from: ${leaked.join(", ")}`);
      }
      return `${surfaces.length} group surfaces checked, the phrase appears in none`;
    });

    await step("a member can propose a change and another can affirm it", async () => {
      const proposed = await api<{ proposal: { id: string; status: string } }>(
        member!,
        `/api/groups/${groupId}/proposals`,
        {
          method: "POST",
          body: JSON.stringify({
            kind: "add_entry",
            body: "We are both circling what an object earns by being used.",
            rationale: "Both archives keep landing here.",
          }),
        },
      );
      if (proposed.status !== 200 && proposed.status !== 201) {
        throw new Error(`propose → ${proposed.status}: ${proposed.raw.slice(0, 200)}`);
      }

      const affirmed = await api<{ accepted: boolean }>(
        owner!,
        `/api/groups/${groupId}/proposals/${proposed.body.proposal.id}/affirm`,
        { method: "POST" },
      );
      if (affirmed.status !== 200) {
        throw new Error(`affirm → ${affirmed.status}: ${affirmed.raw.slice(0, 200)}`);
      }
      if (!affirmed.body.accepted) {
        throw new Error("a second member's affirmation did not accept the proposal");
      }
      return "proposal accepted once a second member affirmed it";
    });

    /*
      The assertion the first version of this suite lacked, to its cost: for
      months, acceptance marked the proposal accepted and then NOTHING
      happened — group synthesis was an explicit not_implemented seam, and
      this suite passed anyway. An accepted change must MATERIALIZE: the
      refresh writes the next version and the members' words arrive on it
      verbatim and locked.
    */
    await step("acceptance materializes a reading with the words locked", async () => {
      const landed = await waitFor(
        async ({ note }) => {
          const tom = await api<{
            topOfMind: { version: number; reason: string } | null;
            entries: Array<{ body: string; lockedAt: string | null }>;
          }>(owner!, `/api/groups/${groupId}/top-of-mind`);
          if (tom.status !== 200) throw new Error(`top-of-mind → ${tom.status}`);
          const added = (tom.body.entries ?? []).find((entry) =>
            entry.body.includes("what an object earns by being used"),
          );
          note(
            `version: ${tom.body.topOfMind?.version ?? 0}, accepted entry: ${added ? "present" : "absent"}`,
          );
          return tom.body.topOfMind && added
            ? { version: tom.body.topOfMind.version, locked: added.lockedAt !== null }
            : null;
        },
        { timeoutMs: 180_000, label: "the accepted words on the group's reading" },
      );
      if (!landed.locked) {
        throw new Error("the accepted entry arrived unlocked — member words must lock");
      }
      return `v${landed.version}, accepted entry present and locked`;
    });

    await step("a non-member cannot tell the group exists", async () => {
      const stranger = await signUp({ baseUrl });
      try {
        const wall = await api(stranger, `/api/groups/${groupId}/wall`);
        if (wall.status !== 404) {
          throw new Error(`expected 404 for a non-member, got ${wall.status}`);
        }
        return "a non-member gets 404, not 403 — existence does not leak";
      } finally {
        await deleteAccount(stranger).catch(() => undefined);
      }
    });

    await step("an agent-bound session cannot reach a wall at all", async () => {
      const created = await api<{ profile: { id: string; name: string } }>(
        owner!,
        "/api/profiles",
        { method: "POST", body: JSON.stringify({ name: "Scout" }) },
      );
      if (created.status !== 201) {
        throw new Error(`create agent profile → ${created.status}: ${created.raw.slice(0, 200)}`);
      }

      // Mint a credential that genuinely acts as the agent profile, through
      // the same loopback flow the CLI uses. Asserting the gate against a
      // human session with a profile parameter would prove nothing: the
      // routes read the session's own profile, which is the point.
      const agentToken = await mintAgentToken(owner!, created.body.profile.id);
      const asAgent = await fetch(`${baseUrl}/api/groups/${groupId}/wall`, {
        headers: { Authorization: `Bearer ${agentToken}` },
      });
      if (asAgent.status !== 403) {
        // A 404 here has meant a shared cache answering with someone else's
        // response rather than the gate failing; the body distinguishes them.
        const body = (await asAgent.text()).slice(0, 120);
        throw new Error(
          `expected 403 for an agent-bound session, got ${asAgent.status}: ${body}`,
        );
      }

      // And it cannot join one either.
      const join = await fetch(`${baseUrl}/api/groups/join`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${agentToken}`,
        },
        body: JSON.stringify({ joinCode }),
      });
      if (join.status !== 403) {
        throw new Error(`expected 403 joining as an agent, got ${join.status}`);
      }
      return "an agent-bound credential is refused at the wall and at the door";
    });

  } finally {
    for (const session of [owner, member]) {
      if (session) await deleteAccount(session).catch(() => undefined);
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n[groups] ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

await main();
