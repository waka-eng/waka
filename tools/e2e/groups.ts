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

const OWNER_ARCHIVE = [
  `I keep coming back to ${SECRET_PHRASE}, and I still cannot say why it matters to me.`,
  "Small inherited objects carry more of a person than any photograph I own.",
  "I would rather keep one thing that was held daily than a shelf of things that were displayed.",
];

const MEMBER_ARCHIVE = [
  "My father's tools are the only inheritance I actually use. The rest sits in a box.",
  "An object earns its place by being used, not by being kept.",
  "I am slowly giving away everything I own that I do not touch.",
];

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

/**
 * Drive the loopback login the way waka-mcp does, binding the credential to a
 * chosen profile: open the consent page, submit its form, exchange the code.
 */
async function mintAgentSession(browser: Session, profileId: string): Promise<string> {
  const callback = "http://127.0.0.1:65535/callback";
  const state = "e2e-state";

  const page = await fetch(
    `${browser.baseUrl}/api/auth/cli/start?callback=${encodeURIComponent(callback)}` +
      `&state=${state}&profile=${profileId}&device=e2e`,
    { headers: { Authorization: `Bearer ${browser.token}` } },
  );
  if (!page.ok) throw new Error(`cli/start → ${page.status}`);
  const html = await page.text();

  const field = (name: string): string => {
    const match = html.match(new RegExp(`name="${name}" value="([^"]*)"`));
    if (!match) throw new Error(`consent form is missing ${name}`);
    return match[1]!.replace(/&amp;/g, "&").replace(/&#39;/g, "'");
  };

  const form = new URLSearchParams({
    callback: field("callback"),
    state: field("state"),
    device: field("device"),
    consent: field("consent"),
    profileId,
  });

  const consented = await fetch(`${browser.baseUrl}/api/auth/cli/consent`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Bearer ${browser.token}`,
    },
    body: form.toString(),
  });
  if (consented.status !== 302) throw new Error(`cli/consent → ${consented.status}`);

  const code = new URL(consented.headers.get("location")!).searchParams.get("code");
  if (!code) throw new Error("consent redirect carried no code");

  const exchanged = await fetch(`${browser.baseUrl}/api/auth/cli/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!exchanged.ok) throw new Error(`cli/exchange → ${exchanged.status}`);
  const { token } = (await exchanged.json()) as { token: string };
  const who = await fetch(`${browser.baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json() as Promise<{ profile: { id: string; type: string } }>);
  if (who.profile.id !== profileId) {
    throw new Error(
      `consent bound the credential to ${who.profile.type} ${who.profile.id}, not the requested ${profileId}`,
    );
  }
  return token;
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
      for (const text of OWNER_ARCHIVE) await capture(owner, { text, kind: "note" });
      for (const text of MEMBER_ARCHIVE) await capture(member, { text, kind: "note" });

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

    let ownerSignal: Signal | undefined;
    await step("each member shares one of their own signals to the wall", async () => {
      ownerSignal = await waitForSignal(owner!, "the owner's first signal");
      const memberSignal = await waitForSignal(member!, "the member's first signal");

      for (const [session, signal] of [
        [owner!, ownerSignal],
        [member!, memberSignal],
      ] as const) {
        const shared = await api(session, `/api/signals/${signal.id}/shares`, {
          method: "POST",
          body: JSON.stringify({ groupId }),
        });
        if (shared.status !== 200 && shared.status !== 201) {
          throw new Error(`share → ${shared.status}: ${shared.raw.slice(0, 200)}`);
        }
      }
      return `two signals shared`;
    });

    await step("the wall shows statements, attributed to their owners", async () => {
      const wall = await api<{ wall: Array<{ statement: string; ownerProfileId: string }> }>(
        member!,
        `/api/groups/${groupId}/wall`,
      );
      if (wall.status !== 200) throw new Error(`wall → ${wall.status}`);
      if (wall.body.wall.length < 2) {
        throw new Error(`expected two shared signals, saw ${wall.body.wall.length}`);
      }
      const owners = new Set(wall.body.wall.map((row) => row.ownerProfileId));
      if (owners.size < 2) throw new Error("both entries attributed to one profile");
      return `${wall.body.wall.length} statements from ${owners.size} members`;
    });

    /**
     * The boundary that matters. Every group surface the member can reach is
     * fetched and searched for the owner's secret phrase.
     */
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
      const agentToken = await mintAgentSession(owner!, created.body.profile.id);
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
