#!/usr/bin/env tsx
/**
 * ERASURE: when a person asks to be forgotten, what actually goes.
 *
 * This is the highest-stakes path in the product and it was proven by nothing.
 * `docs/goals/every-workflow-works.md` carried J3 — "Delete the account" — with
 * the word **nothing** in its evidence column, next to J2 and E2. Of the three,
 * this is the one where "it silently did nothing" is worst: the person is gone,
 * they cannot check, and the failure is invisible from every surface.
 *
 * WHAT `lib/account-erasure.ts` PROMISES, AND HOW EACH PROMISE CAN FAIL QUIETLY
 * ───────────────────────────────────────────────────────────────────────────
 *
 *   1. **The bytes outside Postgres go first**, while the rows still list them
 *      — the attachment rows are the only inventory of what to delete, so
 *      dropping them first would strand private bytes with nothing pointing at
 *      them. Fails quietly: every surface 404s because the ROW is gone, and the
 *      object sits in the bucket forever. Nothing in the product can see it.
 *
 *   2. **The account row cascades** through profiles to everything personal.
 *      Fails quietly only in the other direction — a cascade that reaches too
 *      far — which is why this suite checks a bystander as hard as it checks
 *      the leaver.
 *
 *   3. **Group artifacts that cite this account's signals are deleted
 *      explicitly**, because a cascade cannot reach them: a room's top of mind
 *      belongs to the ROOM, and it can carry a departing member's thinking in
 *      its prose. Fails quietly and permanently: the person is erased and their
 *      sentences are still on somebody else's wall.
 *
 *   4. **No room is left without an owner.** Deleting an account is leaving
 *      every room at once, and leaving has always handed the seat on. Fails
 *      quietly: the room still renders, and nobody can rename, remove or close
 *      it ever again.
 *
 *   5. **Nothing of theirs survives anywhere the others can see.** The
 *      strongest form of the whole contract, and the one worth testing by
 *      SEARCHING rather than by inspecting fields.
 *
 * ── RUNNING IT ──────────────────────────────────────────────────────────────
 *
 *     pnpm e2e:s3-stub --port 8792                     # terminal A
 *     ATTACHMENTS_BUCKET=waka-local \
 *     ATTACHMENTS_ENDPOINT=http://127.0.0.1:8792 \
 *       pnpm dev:local                                 # terminal B
 *     ATTACHMENTS_BUCKET=waka-local \
 *     ATTACHMENTS_ENDPOINT=http://127.0.0.1:8792 \
 *       pnpm e2e:erasure                               # terminal C
 *
 * Without the object store the byte check CANNOT run, and this suite says so in
 * its own result line rather than passing over it. That distinction is the
 * point: promise 1 is the one that fails invisibly, so a run that skipped it
 * must never read like a run that made it.
 *
 * WHAT IT DOES NOT PROVE. The stub verifies no signatures and holds objects in
 * memory (see `s3-stub.ts`), so this proves OUR half — that erasure computes
 * the right inventory and issues the deletes — and nothing about S3's own
 * durability or IAM. It also spends real model calls: two archives have to
 * become signals, and the room has to read itself, before there is a citation
 * to erase.
 */
import {
  capture,
  deleteAccount,
  health,
  listInspirations,
  listSignals,
  login,
  attachImage,
  signUp,
  statusOf,
  waitFor,
  type Session,
  type Signal,
} from "./organic.js";

const DEFAULT_BASE_URL = "http://localhost:3010";
const DERIVATION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * A phrase that exists in exactly one capture on the whole stack, so finding it
 * anywhere after erasure is unambiguous. Testing by search rather than by field
 * inspection is deliberate: a field check only ever finds the leak you thought
 * of, and this is the class of bug nobody thinks of.
 */
const LEAVER_PHRASE = "the brass sextant my uncle never once used at sea";

/** Chosen, not generated, so the suite can prove it stops working. */
const LEAVER_PASSWORD = "e2e-erasure-leaver-password-1";

/*
 * TWO ARCHIVES THAT MEET. A room's statement is served only where memories
 * from two different members stand under the SAME one, so both of these say
 * that an object earns its place by being used. Archives that merely share a
 * subject mint two statements with one voice each and serve neither, and this
 * suite needs a served statement: a citation is what makes the room's
 * artifact reachable from the leaver's profile at erasure time.
 */
const LEAVER_ARCHIVE = [
  `I keep returning to ${LEAVER_PHRASE}, and I cannot decide if that is sentiment or shame.`,
  "An instrument that was never used is a different kind of object from one that wore out.",
  "I would rather own one thing that did its work than five that were admired.",
  "The plane with the worn handle is worth more to me than the boxed set beside it.",
  "Use is what makes a thing mine — the ones I never reach for were never really mine.",
];

const STAYER_ARCHIVE = [
  "My mother's sewing machine still runs, and that is the only reason I kept it.",
  "A tool earns its shelf by being reached for, not by being inherited.",
  "I am slowly letting go of everything I own that I do not actually touch.",
  "The pan she cooked in every night is the only thing of hers I use.",
  "A thing that gets handled holds a person; a thing that gets displayed holds nothing.",
];

/** A real 1x1 PNG — the bytes that land should be a decodable image. */
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** The room's artifact as `routes/groups.ts` publishes it, field by field. */
interface GroupBoard {
  topOfMind: { id: string; version: number; status: string } | null;
  entries?: Array<{
    id: string;
    body: string;
    contributors?: Array<{ profileId: string; name: string }>;
  }>;
}

const results: Array<{ ok: boolean; skipped?: boolean }> = [];

async function step(
  title: string,
  run: () => Promise<string>,
  options: { skip?: string } = {},
): Promise<void> {
  const index = results.length + 1;
  if (options.skip) {
    results.push({ ok: true, skipped: true });
    console.log(`SKIP ${index}. ${title}`);
    console.log(`     NOT CHECKED — ${options.skip}`);
    return;
  }
  const started = Date.now();
  try {
    const detail = await run();
    results.push({ ok: true });
    console.log(`PASS ${index}. ${title} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    console.log(`     ${detail}`);
  } catch (err) {
    results.push({ ok: false });
    const message = err instanceof Error ? err.message : String(err);
    console.log(`FAIL ${index}. ${title} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    console.log(`     ${message}`);
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

async function firstSignal(session: Session, label: string): Promise<Signal> {
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
 * The object store, addressed the way `s3-stub.ts` expects: path-style, because
 * `bucket.127.0.0.1` does not resolve.
 *
 * The attachment's own `url` cannot be used for this. It is serialized as a
 * virtual-host AWS URL regardless of `ATTACHMENTS_ENDPOINT` — correct for a
 * real deployment, useless for reaching a local stub — but the KEY is its path,
 * and that is the part this needs.
 */
function objectUrl(endpoint: string, bucket: string, attachmentUrl: string): string {
  const key = new URL(attachmentUrl).pathname.replace(/^\/+/, "");
  return `${endpoint.replace(/\/+$/, "")}/${bucket}/${key}`;
}

async function objectExists(url: string): Promise<boolean> {
  const response = await fetch(url, { method: "HEAD" });
  return response.status === 200;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const baseFlag = args.indexOf("--base-url");
  const baseUrl = baseFlag >= 0 ? args[baseFlag + 1]! : DEFAULT_BASE_URL;

  const endpoint = process.env.ATTACHMENTS_ENDPOINT?.trim() ?? "";
  const bucket = process.env.ATTACHMENTS_BUCKET?.trim() ?? "";
  const storeReachable = endpoint.length > 0 && bucket.length > 0;

  console.log(`[erasure] base url: ${baseUrl}`);
  console.log(
    storeReachable
      ? `[erasure] object store: ${endpoint} (bucket ${bucket})`
      : "[erasure] NO OBJECT STORE — the byte checks will be reported as not run",
  );
  console.log("");

  await health(baseUrl);

  let leaver: Session | undefined;
  let stayer: Session | undefined;
  let leaverProfileId = "";
  let groupId = "";
  /** How many of the room's own statements somebody agreed with — written by
      the step that grows the room, read by the step that asks it to speak.
      Declared HERE and not beside `citedBefore`: `let` is not hoisted, so a
      declaration sitting between the two steps put the writer in the temporal
      dead zone and the step failed with "cannot access before initialization"
      — a step that had been passing, now broken by the variable that was
      supposed to explain it. */
  let affirmedShared = 0;
  let attachmentObject = "";

  await step("two people keep their own archives, and one of them keeps a picture", async () => {
    /* The password is chosen here rather than generated, because one of the
       checks below is that it stops working — and `Session` does not carry the
       one `signUp` would have made up. */
    leaver = await signUp({ baseUrl, password: LEAVER_PASSWORD });
    stayer = await signUp({ baseUrl });

    /* PUBLIC, because a room reads its members' public memories and grows its
       own statements from them; a private archive leaves the room with
       nothing to say and this suite with no citation to follow. */
    const first = await capture(leaver, {
      text: LEAVER_ARCHIVE[0]!,
      kind: "note",
      visibility: "public",
    });
    for (const text of LEAVER_ARCHIVE.slice(1)) {
      await capture(leaver, { text, kind: "note", visibility: "public" });
    }
    for (const text of STAYER_ARCHIVE) {
      await capture(stayer, { text, kind: "note", visibility: "public" });
    }

    const attachment = await attachImage(leaver, {
      inspirationId: first.id,
      bytes: new Uint8Array(ONE_PIXEL_PNG),
      filename: "sextant.png",
      contentType: "image/png",
    });
    attachmentObject = storeReachable ? objectUrl(endpoint, bucket, attachment.url) : "";

    leaverProfileId = leaver.profileId;

    return `${LEAVER_ARCHIVE.length} + ${STAYER_ARCHIVE.length} captures, one image attached`;
  });

  await step(
    "the picture's bytes are really in the object store",
    async () => {
      if (!(await objectExists(attachmentObject))) {
        throw new Error(`the object store has nothing at ${attachmentObject}`);
      }
      return "HEAD 200 — there is something to delete";
    },
    { skip: storeReachable ? undefined : "ATTACHMENTS_ENDPOINT / ATTACHMENTS_BUCKET are unset" },
  );

  await step("they share a room, and the room grows a statement from both", async () => {
    const created = await api<{ group: { id: string; joinCode: string } }>(
      leaver!,
      "/api/groups",
      { method: "POST", body: JSON.stringify({ name: "Things that were used" }) },
    );
    if (created.status !== 200 && created.status !== 201) {
      throw new Error(`create room → ${created.status}: ${created.raw.slice(0, 200)}`);
    }
    groupId = created.body.group.id;

    const joined = await api(stayer!, "/api/groups/join", {
      method: "POST",
      body: JSON.stringify({ joinCode: created.body.group.joinCode }),
    });
    if (joined.status !== 200 && joined.status !== 201) {
      throw new Error(`join → ${joined.status}: ${joined.raw.slice(0, 200)}`);
    }

    /* Both archives have to become patterns, and the room has to grow one of
       its own from where they meet — this is the model spend this suite
       cannot avoid, because a citation is the only thing that makes the
       room's artifact reachable from the leaver's profile at erasure time.
       Nobody puts anything up any more (2026-08-24): forming the room asked
       it to read the ground both members already stood on. */
    await firstSignal(leaver!, "the leaver's first signal");
    await firstSignal(stayer!, "the stayer's first signal");

    const wall = await waitFor(
      async ({ note }) => {
        const seen = await api<{ wall: Array<{ signalId: string }> }>(
          stayer!,
          `/api/groups/${groupId}/wall`,
        );
        if (seen.status !== 200) throw new Error(`wall → ${seen.status}`);
        note(`${seen.body.wall.length} statements the room grew`);
        return seen.body.wall.length > 0 ? seen.body.wall : null;
      },
      { timeoutMs: 240_000, label: "the room's first statement of its own" },
    );

    /* AND SOMEBODY AGREES WITH THEM, BECAUSE A ROOM DOES NOT SPEAK FIRST ON
       ITS OWN. `groupDraftMinAffirmed` (top-of-mind-synthesis.ts) holds a
       room's first generative draft until enough of its shared statements
       have been affirmed by a member other than their owner — the same shape
       as `emerging → active`, one level up, so a room never drafts from thin
       evidence in a slow week. This room has two members, so the bar it is
       held to is the small-room one (founder ruling, 2026-08-25).

       This suite never affirmed anything, so the room waited forever and the
       step after this one spent five minutes discovering that. The wait was
       not the bug; the silence was. Agreeing here is also what a person does,
       and it is the only way the next step has anything to read. */
    for (const row of wall) {
      const said = await api(stayer!, `/api/feedback`, {
        method: "POST",
        body: JSON.stringify({ targetType: "signal", targetId: row.signalId, value: "true" }),
      });
      if (said.status !== 200 && said.status !== 201) {
        throw new Error(`agreeing with a room statement → ${said.status}: ${said.raw.slice(0, 160)}`);
      }
    }
    affirmedShared = wall.length;

    return (
      `room ${groupId.slice(0, 8)}, two members, ${wall.length} statements it grew, ` +
      `all ${wall.length} agreed with`
    );
  });

  let citedBefore = 0;
  await step("the room reads itself, and what it writes cites the leaver", async () => {
    const read = await api(stayer!, `/api/groups/${groupId}/top-of-mind/refresh`, {
      method: "POST",
    });
    if (read.status !== 200 && read.status !== 201 && read.status !== 202) {
      throw new Error(`refresh → ${read.status}: ${read.raw.slice(0, 200)}`);
    }

    /* `entries` is TOP LEVEL, beside `topOfMind`, and attribution is
       `contributors`, not citations — the route serializes field by field
       (routes/groups.ts) rather than handing back a loader's shape. Guessing
       it cost a five-minute timeout waiting on a path that could never match. */
    /* A ROOM DOES NOT SPEAK FIRST UNTIL ENOUGH OF IT HAS BEEN AGREED WITH.
       The count is over SHARED STATEMENTS, not over agreements: a room that
       grew one of its own can never reach two however many times it is
       affirmed. This suite grows its room from two members and four
       captures, so how many it grows is the model's call.

       The bar is the SMALL-ROOM one — two — because this room has two
       members (`groupDraftMinAffirmed`, founder ruling 2026-08-25). It was a
       flat three until then, which a two-person room could not reach at all;
       two is reachable here, and this step now fails only when the model
       genuinely grew fewer than two statements for the pair to agree with.

       Waiting five minutes to discover a gate we can read directly is not a
       test, it is a delay. If the room is holding, say so in the words of the
       rule and stop — the same shape as the attachment steps above, which
       report what the stack has not got rather than failing it. */
    const MIN_AFFIRMED = 2;
    if (affirmedShared < MIN_AFFIRMED) {
      throw new Error(
        `the room is holding its first draft: ${affirmedShared} of its own statements ` +
          `were agreed with and a room needs ${MIN_AFFIRMED} before it drafts ` +
          `(groupDraftMinAffirmed, top-of-mind-synthesis.ts). Nothing is broken — ` +
          `there was not enough agreed material in a two-person room for it to speak, ` +
          `so the erasure claims below could not be exercised against a room's own words.`,
      );
    }

    const board = await waitFor(
      async ({ note }) => {
        const response = await api<GroupBoard>(
          stayer!,
          `/api/groups/${groupId}/top-of-mind`,
        );
        const entries = response.body.entries ?? [];
        note(`${entries.length} entries`);
        return entries.length > 0 ? response : null;
      },
      { timeoutMs: DERIVATION_TIMEOUT_MS, label: "the room's top of mind" },
    );

    const entries = board.body.entries ?? [];
    citedBefore = entries.filter((entry) =>
      (entry.contributors ?? []).some((c) => c.profileId === leaverProfileId),
    ).length;

    /* NOT AN ASSERTION ON THE COUNT, AND ON PURPOSE. Whether the synthesis
       happens to cite this particular member is the model's call, and a suite
       that failed here would be failing the model rather than the erasure. The
       number is CARRIED to the check after the delete, which is where it
       decides whether the strong claim or the weak one is being made. */
    return `${entries.length} entries, ${citedBefore} of them citing the leaver`;
  });

  await step("the account is erased", async () => {
    await deleteAccount(leaver!);
    return "the delete returned without error";
  });

  await step("they cannot get back in, and their session is dead", async () => {
    const stillLive = await statusOf({
      method: "GET",
      baseUrl,
      path: "/api/auth/me",
      token: leaver!.token,
    });
    if (stillLive < 400) {
      throw new Error(`the erased session still answers /api/auth/me → ${stillLive}`);
    }

    let signedBackIn = false;
    try {
      await login({ baseUrl, email: leaver!.email, password: LEAVER_PASSWORD });
      signedBackIn = true;
    } catch {
      signedBackIn = false;
    }
    if (signedBackIn) throw new Error("the erased account could sign in again");

    return `session → ${stillLive}, and the password no longer opens anything`;
  });

  await step(
    "the picture's bytes are gone from the object store",
    async () => {
      if (await objectExists(attachmentObject)) {
        throw new Error(
          "the object is still in the store — the rows are gone, so nothing in " +
            "the product can ever point at these bytes again",
        );
      }
      return "HEAD 404 — the bytes went before the inventory did";
    },
    { skip: storeReachable ? undefined : "ATTACHMENTS_ENDPOINT / ATTACHMENTS_BUCKET are unset" },
  );

  await step("the room survives, and still has somebody who can administer it", async () => {
    const rooms = await api<{ groups?: Array<{ id: string; role?: string }> }>(
      stayer!,
      "/api/groups",
    );
    if (rooms.status !== 200) throw new Error(`rooms → ${rooms.status}`);
    const room = (rooms.body.groups ?? []).find((g) => g.id === groupId);
    if (!room) throw new Error("the room went with the account that created it");

    const members = await api<{ members?: Array<{ role?: string }> }>(
      stayer!,
      `/api/groups/${groupId}/members`,
    );
    if (members.status !== 200) throw new Error(`members → ${members.status}`);
    const owners = (members.body.members ?? []).filter((m) => m.role === "owner");
    if (owners.length === 0) {
      throw new Error(
        "the room has no owner — nobody can rename it, remove anyone, or close it, ever",
      );
    }
    return `the room stands with ${members.body.members?.length ?? 0} member(s) and ${owners.length} owner(s)`;
  });

  await step("what the room wrote about them is gone with them", async () => {
    const board = await api<GroupBoard>(stayer!, `/api/groups/${groupId}/top-of-mind`);
    if (board.status !== 200 && board.status !== 404) {
      throw new Error(`top of mind → ${board.status}: ${board.raw.slice(0, 200)}`);
    }
    const entries = board.body.entries ?? [];
    const stillCiting = entries.filter((entry) =>
      (entry.contributors ?? []).some((c) => c.profileId === leaverProfileId),
    ).length;
    if (stillCiting > 0) {
      throw new Error(
        `${stillCiting} entr(ies) still credit the erased account — a cascade cannot ` +
          "reach a room's own artifact, so this is the explicit delete failing",
      );
    }
    /* SAID PLAINLY WHEN THE STRONG CLAIM CANNOT BE MADE. If the synthesis
       never cited this member, "no citations remain" is true and proves
       nothing, and reporting it as though it did would be the same lie as a
       silent skip. */
    return citedBefore > 0
      ? `the ${citedBefore} entr(ies) that cited them are gone`
      : `no citations remain — but the room never cited them, so this ran over nothing`;
  });

  await step("the other member's memory is untouched", async () => {
    const kept = await listInspirations(stayer!, { limit: 50 });
    if (kept.inspirations.length < STAYER_ARCHIVE.length) {
      throw new Error(
        `the bystander lost memories: ${kept.inspirations.length} of ${STAYER_ARCHIVE.length} left`,
      );
    }
    const signals = await listSignals(stayer!, { limit: 50 });
    if (signals.length === 0) {
      throw new Error("the bystander's signals went with somebody else's account");
    }
    return `${kept.inspirations.length} memories and ${signals.length} signal(s) still theirs`;
  });

  await step("nothing of theirs is anywhere the other member can look", async () => {
    const surfaces = [
      "/api/groups",
      `/api/groups/${groupId}/wall`,
      `/api/groups/${groupId}/members`,
      `/api/groups/${groupId}/top-of-mind`,
      `/api/groups/${groupId}/proposals`,
      "/api/inspirations",
      "/api/signals",
    ];
    const needle = LEAVER_PHRASE.toLowerCase();
    const leaked: string[] = [];
    for (const path of surfaces) {
      const response = await api(stayer!, path);
      if (response.raw.toLowerCase().includes(needle)) leaked.push(path);
    }
    if (leaked.length > 0) {
      throw new Error(`the erased account's words are still readable at: ${leaked.join(", ")}`);
    }
    return `${surfaces.length} surfaces searched, the phrase is on none of them`;
  });

  const failed = results.filter((r) => !r.ok).length;
  const skipped = results.filter((r) => r.skipped).length;
  console.log("");
  console.log(
    `[erasure] ${results.length - failed - skipped} passed, ${failed} failed` +
      (skipped > 0 ? `, ${skipped} NOT RUN` : ""),
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error(`[erasure] harness error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});
