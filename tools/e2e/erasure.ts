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
 *      its prose. Fails quietly and permanently.
 *
 *   4. **No room is left without an owner.** Deleting an account is leaving
 *      every room at once, and leaving has always handed the seat on.
 *
 *      NEITHER 3 NOR 4 IS CHECKED HERE ANY MORE (2026-10-15). The steps that
 *      checked them drove `/api/groups` over HTTP and those routes are gone.
 *      BOTH PROMISES ARE STILL LIVE: the room rows were never dropped and
 *      `lib/account-erasure.ts` still deletes them, so this is untested
 *      behaviour rather than retired behaviour. Setting the state up now
 *      means seeding `groups`/`group_members` in SQL, which belongs beside
 *      the erasure code rather than in a browser harness.
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

/* `GroupBoard` WENT WITH THE ROOM STEPS: it described what
   `/api/groups/:id/top-of-mind` served, and nothing serves that now. */

/**
 * THIS STACK CANNOT EXERCISE THE CLAIM — WHICH IS NOT THE PRODUCT FAILING.
 *
 * `options.skip` below is decided BEFORE a step runs, from what the
 * environment declares. That covers the attachment byte checks, which can read
 * `ATTACHMENTS_BUCKET` up front — and covers nothing that is only discoverable
 * once a request has been made. So step 1 posted to `/api/attachments/presign`,
 * got `500 Attachments bucket is not configured`, and reported FAIL directly
 * above a SKIP whose stated reason was the identical missing bucket.
 *
 * The comment on the room-draft step said out loud that it meant to behave
 * "the same shape as the attachment steps above, which report what the stack
 * has not got rather than failing it" — and then threw a plain `Error`, which
 * is a FAIL. The intent was written down and never implemented.
 *
 * Narrow rule, the same as organic's: throw this ONLY when the stack lacks a
 * capability the claim needs. A product that answered wrongly is a failure and
 * stays one.
 */
class NotExercised extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "NotExercised";
  }
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
    const message = err instanceof Error ? err.message : String(err);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (err instanceof NotExercised) {
      results.push({ ok: true, skipped: true });
      console.log(`SKIP ${index}. ${title} (${seconds}s)`);
      console.log(`     NOT EXERCISED — ${message}`);
      return;
    }
    results.push({ ok: false });
    console.log(`FAIL ${index}. ${title} (${seconds}s)`);
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
  /* `leaverProfileId`, `groupId` and `affirmedShared` went with the room
     steps that wrote them. `affirmedShared` carried a seven-line note about a
     temporal-dead-zone bug between two steps that no longer exist; the lesson
     survives as one line: `let` is not hoisted, so a declaration placed
     between a writer and a reader breaks the writer. */
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

    /* TWO CLAIMS IN ONE STEP, AND ONLY ONE OF THEM NEEDS A BUCKET. The
       archives are the load-bearing half and they had already been written by
       the time this ran; the picture needs an object store. On a stack with
       none, `attachImage` answers `500 Attachments bucket is not configured`
       and the whole step went red — reporting that two people could not keep
       their own archives, which they demonstrably had.

       So the picture is attempted and its absence is reported in words. The
       archives stay a hard claim: anything else thrown here is still a
       failure. */
    let pictureNote = "one image attached";
    try {
      const attachment = await attachImage(leaver, {
        inspirationId: first.id,
        bytes: new Uint8Array(ONE_PIXEL_PNG),
        filename: "sextant.png",
        contentType: "image/png",
      });
      attachmentObject = storeReachable ? objectUrl(endpoint, bucket, attachment.url) : "";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/bucket is not configured/i.test(message)) throw err;
      attachmentObject = "";
      pictureNote = "no image — this stack has no attachments bucket, so the picture half of this step was not exercised";
    }

    return `${LEAVER_ARCHIVE.length} + ${STAYER_ARCHIVE.length} captures, ${pictureNote}`;
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

  /* ═══ THE ROOM HALF OF THIS HARNESS IS GONE (2026-10-15) ═══════════════
     Until today this file carried ~245 lines driving `/api/groups`,
     `/api/groups/join`, `/api/groups/:id/wall`, `/members`, `/top-of-mind`
     and `/proposals` directly over HTTP. It was the last room coupling in
     `tools/`, and it was kept deliberately while those routes were live.
     They are not live any more -- the API half landed on `dev` -- so every
     one of those steps now fails on a 404, which is a red run for the wrong
     reason: the harness reporting its own staleness as a product fault.

     WHAT COVERAGE GOES WITH IT, said plainly rather than buried. These steps
     proved that erasing an account also erases what a ROOM held about that
     person -- their wall contributions, their lines in the room's top of
     mind, their membership -- while leaving the OTHER member's memory whole.
     That is the strongest claim this file ever made, because it is the one
     place erasure crosses a boundary between two people.

     IT IS NOT MOOT, and that is the part to keep hold of. The room rows
     still exist in the database (no table was dropped), and
     `packages/api/src/lib/account-erasure.ts` still deletes them on erasure.
     So the BEHAVIOUR is live and is now untested. What is gone is only the
     way to SET THE STATE UP over HTTP, because the doors are closed.

     TO RESTORE IT: seed `groups` and `group_members` with direct SQL the way
     `inspiration-processing.db.test.ts` now seeds its legacy seat, then erase
     and assert. That is fixture work, not harness work, and it belongs in
     `packages/api` beside the erasure code rather than here. */

  await step("the bystander has material of their own", async () => {
    /* HOISTED out of the deleted room block, where it was incidental setup.
       The two steps below need the bystander to own a signal as well as
       memories, or "untouched" is only a claim about inspirations. */
    await firstSignal(stayer!, "the stayer's first signal");
    return "a signal of their own, which the erasure must not touch";
  });


  /* ═══ RESTORED 2026-10-15, AFTER I DELETED THEM BY ACCIDENT ════════════
     These three are NOT room steps and should never have gone. Cutting the
     room block above, I anchored on its first and last line and took
     everything between — and three non-room steps were sitting inside that
     span. The result passed: `pnpm e2e:erasure` signed up two accounts,
     captured, attached an image, waited for a signal, and exited 0 with "4
     passed" HAVING ERASED NOTHING. `deleteAccount` was still imported and
     called from nowhere.

     Worse than a lost test: the two steps below are a CONTROL for an
     erasure, so without it they cannot fail. "the other member's memory is
     untouched" was never at risk, and "nothing of theirs is anywhere the
     other member can look" searches as the stayer for a phrase the stayer
     could never see anyway.

     The same mistake as the botched CSS deletion earlier tonight: anchor a
     cut on a span boundary without inventorying what is inside it. */

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
    /* FIVE ROOM SURFACES CAME OFF THIS LIST with the block above; the two
       that remain are the ones still served. The claim is narrower now --
       the erased words are not readable by another ACCOUNT -- where it used
       to also cover another MEMBER of a shared room. */
    const surfaces = ["/api/inspirations", "/api/signals"];
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
