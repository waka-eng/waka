#!/usr/bin/env tsx
/**
 * CONNECTIONS: which machines hold a credential for this account, and ending
 * one for real.
 *
 * `docs/goals/every-workflow-works.md` carried J2 — "List and revoke
 * connections" — with the word **nothing** in its evidence column. It is the
 * surface a person reaches for at the worst moment: a laptop is gone, an agent
 * is misbehaving, a terminal was set up on a machine that is no longer theirs.
 * A revoke that returns 200 and leaves the token working is the whole failure,
 * and every screen would keep saying the connection is ended.
 *
 * WHAT `routes/sessions.ts` PROMISES, AND HOW EACH PROMISE FAILS QUIETLY
 * ─────────────────────────────────────────────────────────────────────
 *
 *   1. **The list is every live connection in the account**, with `current`
 *      marking the caller's own. Quiet failure: an agent's credential is
 *      missing from the list, so the one connection a person most wants to end
 *      is the one they cannot see.
 *
 *   2. **Revoking revokes.** The row is the revocation — the token stays
 *      syntactically valid until it expires, and the lookup that would accept
 *      it finds nothing. Quiet failure: the delete answers 200, the row is
 *      gone, and the token is still accepted because something else was
 *      trusted to authenticate it. Nothing on any screen would say so.
 *
 *   3. **One account cannot end another's connection**, and an unknown id and
 *      somebody else's id answer alike. Quiet failure: cross-account
 *      revocation, and — through the difference between 404 and 403 — an
 *      oracle telling a stranger which session ids are real.
 *
 *   4. **An agent-bound session may neither list nor revoke.** An agent that
 *      could enumerate connections would be reporting on the person rather
 *      than remembering for them. Quiet failure: it can, and nothing
 *      distinguishes that from working correctly.
 *
 *   5. **Ending your own connection is allowed**, and says so — refusing it
 *      would mean the device in your hand is the one you cannot cut off, which
 *      is backwards when the reason to revoke is usually that a device is no
 *      longer yours.
 *
 * NO MODEL CALLS. Nothing here derives anything, so this suite is fast and
 * free, and there is no reason it should not run on every change.
 *
 *     pnpm e2e:connections [--base-url http://127.0.0.1:3010]
 */
import {
  health,
  login,
  mintAgentToken,
  signUp,
  statusOf,
  type Session,
} from "./organic.js";

const DEFAULT_BASE_URL = "http://localhost:3010";

interface Connection {
  id: string;
  deviceLabel: string | null;
  profile: { id: string; name: string; type: "human" | "agent" };
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

const results: Array<{ ok: boolean }> = [];

async function step(title: string, run: () => Promise<string>): Promise<void> {
  const index = results.length + 1;
  const started = Date.now();
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

async function call<T>(
  baseUrl: string,
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: T; raw: string }> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
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

const listConnections = (baseUrl: string, token: string) =>
  call<{ sessions?: Connection[]; error?: string }>(baseUrl, token, "/api/sessions");

/** Does this token still open the account? The one question revocation is about. */
async function tokenStillWorks(baseUrl: string, token: string): Promise<boolean> {
  const status = await statusOf({ method: "GET", baseUrl, path: "/api/auth/me", token });
  return status < 400;
}

const PASSWORD = "e2e-connections-password-1";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = args.indexOf("--base-url");
  const baseUrl = flag >= 0 ? args[flag + 1]! : DEFAULT_BASE_URL;

  console.log(`[connections] base url: ${baseUrl}`);
  console.log("");
  await health(baseUrl);

  let owner: Session | undefined;
  let secondBrowser = "";
  let agentToken = "";
  let stranger: Session | undefined;

  await step("one person signs in from a second browser, and adds an agent", async () => {
    owner = await signUp({ baseUrl, password: PASSWORD });
    stranger = await signUp({ baseUrl });

    const second = await login({ baseUrl, email: owner.email, password: PASSWORD });
    secondBrowser = second.token;

    /* An agent needs a profile of its own before a credential can be bound to
       it — an agent-bound token IS the binding, so there is nothing to mint
       without one. */
    const created = await call<{ profile: { id: string } }>(
      baseUrl,
      owner.token,
      "/api/profiles",
      /* `name` only — the create schema is `.strict()` and the route makes an
         AGENT profile by construction, so passing `type` is a 400. */
      { method: "POST", body: JSON.stringify({ name: "E2E Agent" }) },
    );
    if (created.status !== 200 && created.status !== 201) {
      throw new Error(`create agent profile → ${created.status}: ${created.raw.slice(0, 200)}`);
    }
    agentToken = await mintAgentToken(owner, created.body.profile.id);

    return "three credentials: two browsers and one terminal-bound agent";
  });

  await step("all three show up, and the caller can tell which one is itself", async () => {
    const listed = await listConnections(baseUrl, owner!.token);
    if (listed.status !== 200) throw new Error(`list → ${listed.status}: ${listed.raw.slice(0, 200)}`);
    const rows = listed.body.sessions ?? [];

    if (rows.length < 3) {
      throw new Error(`expected at least 3 connections, saw ${rows.length}`);
    }
    /* THE AGENT MUST BE IN THE LIST. This is the whole point of the surface:
       the credential a person is least able to see from anywhere else is the
       one they most need to be able to end. */
    if (!rows.some((row) => row.profile.type === "agent")) {
      throw new Error("the agent's credential is not in the list — it cannot be ended from here");
    }
    const current = rows.filter((row) => row.current);
    if (current.length !== 1) {
      throw new Error(`expected exactly one connection marked current, saw ${current.length}`);
    }

    /* A hash is stored, never the token — so nothing here can hand one back.
       Checked by searching the whole payload for the credentials themselves. */
    const leaked = [owner!.token, secondBrowser, agentToken].filter((t) =>
      listed.raw.includes(t),
    );
    if (leaked.length > 0) throw new Error(`${leaked.length} raw token(s) came back in the listing`);

    return `${rows.length} connections, 1 current, agent present, no token in the payload`;
  });

  await step("ending the other browser's connection actually ends it", async () => {
    if (!(await tokenStillWorks(baseUrl, secondBrowser))) {
      throw new Error("the second browser's token was dead before anything was revoked");
    }

    const rows = (await listConnections(baseUrl, owner!.token)).body.sessions ?? [];
    const target = rows.find((row) => !row.current && row.profile.type === "human");
    if (!target) throw new Error("no other browser connection to end");

    const ended = await call<{ id: string; endedCurrent: boolean }>(
      baseUrl,
      owner!.token,
      `/api/sessions/${target.id}`,
      { method: "DELETE" },
    );
    if (ended.status !== 200) throw new Error(`revoke → ${ended.status}: ${ended.raw.slice(0, 200)}`);
    if (ended.body.endedCurrent) throw new Error("revoking another connection reported ending this one");

    /* THE ASSERTION THAT MATTERS. A 200 and a vanished row prove the write;
       only the token proves the revocation. */
    if (await tokenStillWorks(baseUrl, secondBrowser)) {
      throw new Error(
        "the revoked token still opens the account — the row is gone and the credential is not",
      );
    }
    if (!(await tokenStillWorks(baseUrl, owner!.token))) {
      throw new Error("revoking one connection ended the caller's own");
    }
    return "the other browser is locked out, this one is not";
  });

  await step("ending the agent's connection ends the agent, and nothing else", async () => {
    const rows = (await listConnections(baseUrl, owner!.token)).body.sessions ?? [];
    const agent = rows.find((row) => row.profile.type === "agent");
    if (!agent) throw new Error("the agent's connection is no longer listed");

    const ended = await call(baseUrl, owner!.token, `/api/sessions/${agent.id}`, {
      method: "DELETE",
    });
    if (ended.status !== 200) throw new Error(`revoke agent → ${ended.status}`);

    if (await tokenStillWorks(baseUrl, agentToken)) {
      throw new Error("the agent's credential still works after being revoked");
    }
    if (!(await tokenStillWorks(baseUrl, owner!.token))) {
      throw new Error("revoking the agent ended the person's own connection");
    }
    return "the terminal is cut off, the browser is untouched";
  });

  await step("nobody can end a connection that is not theirs", async () => {
    const mine = (await listConnections(baseUrl, owner!.token)).body.sessions ?? [];
    const target = mine[0];
    if (!target) throw new Error("no connection left to attempt");

    const attempt = await call(baseUrl, stranger!.token, `/api/sessions/${target.id}`, {
      method: "DELETE",
    });
    if (attempt.status !== 404) {
      throw new Error(
        `a stranger's revoke of somebody else's connection answered ${attempt.status}, not 404`,
      );
    }
    if (!(await tokenStillWorks(baseUrl, owner!.token))) {
      throw new Error("a stranger ended this account's connection");
    }

    /* AND IT ANSWERS THE SAME AS A NONEXISTENT ONE. A 403 here and a 404 there
       is an oracle: it tells a stranger which session ids are real, one guess
       at a time. */
    const invented = await call(
      baseUrl,
      stranger!.token,
      "/api/sessions/00000000-0000-4000-8000-000000000000",
      { method: "DELETE" },
    );
    if (invented.status !== attempt.status) {
      throw new Error(
        `someone else's id answers ${attempt.status} and a nonexistent one answers ${invented.status} — the difference is an oracle`,
      );
    }
    return `both answer ${attempt.status}, and the connection survived`;
  });

  await step("an agent may neither see the connections nor end one", async () => {
    /* A second agent credential, because the first was revoked above. */
    const created = await call<{ profile: { id: string } }>(
      baseUrl,
      owner!.token,
      "/api/profiles",
      { method: "POST", body: JSON.stringify({ name: "E2E Agent Two" }) },
    );
    if (created.status !== 200 && created.status !== 201) {
      throw new Error(`create second agent profile → ${created.status}`);
    }
    const secondAgent = await mintAgentToken(owner!, created.body.profile.id);

    const listed = await listConnections(baseUrl, secondAgent);
    if (listed.status !== 403) {
      throw new Error(
        `an agent listing its owner's connections answered ${listed.status}, not 403` +
          (listed.status === 200
            ? ` — it saw ${(listed.body.sessions ?? []).length} of them`
            : ""),
      );
    }

    const mine = (await listConnections(baseUrl, owner!.token)).body.sessions ?? [];
    const humanRow = mine.find((row) => row.profile.type === "human");
    if (!humanRow) throw new Error("no human connection left to attempt against");
    const attempt = await call(baseUrl, secondAgent, `/api/sessions/${humanRow.id}`, {
      method: "DELETE",
    });
    if (attempt.status !== 403) {
      throw new Error(`an agent revoking its owner's browser answered ${attempt.status}, not 403`);
    }
    if (!(await tokenStillWorks(baseUrl, owner!.token))) {
      throw new Error("an agent ended its owner's connection");
    }
    return "403 on both, and the owner is still signed in";
  });

  await step("a person can end the connection they are holding", async () => {
    const mine = (await listConnections(baseUrl, owner!.token)).body.sessions ?? [];
    const self = mine.find((row) => row.current);
    if (!self) throw new Error("the caller's own connection is not marked current");

    const ended = await call<{ endedCurrent: boolean }>(
      baseUrl,
      owner!.token,
      `/api/sessions/${self.id}`,
      { method: "DELETE" },
    );
    if (ended.status !== 200) throw new Error(`revoke self → ${ended.status}`);
    if (!ended.body.endedCurrent) {
      throw new Error("ending the current connection did not report itself as such");
    }
    if (await tokenStillWorks(baseUrl, owner!.token)) {
      throw new Error("ending the current connection left it working");
    }

    /* And signing in again is how you come back — the account is not damaged,
       only that one credential is gone. */
    const again = await login({ baseUrl, email: owner!.email, password: PASSWORD });
    if (!(await tokenStillWorks(baseUrl, again.token))) {
      throw new Error("signing back in after ending the current connection did not work");
    }
    return "logged out from the device in hand, and able to sign back in";
  });

  const failed = results.filter((r) => !r.ok).length;
  console.log("");
  console.log(`[connections] ${results.length - failed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error(
    `[connections] harness error: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(2);
});
