/**
 * `/api/harvest` — the basket of the person's own sentences, picked from
 * their work, waiting to be kept or let go.
 *
 * See `db/schema-harvest.ts` for the model and the rules that keep it a
 * basket rather than a second archive. In one screen:
 *
 *   POST /                 propose (the human's own sessions, keeper key included)
 *   GET  /                 what is waiting (browser only); lapses the old first
 *   POST /:id/keep         link the save the person just made (browser only)
 *   POST /:id/decline      let it go, with a reason or without (browser only)
 *
 * KEEP DOES NOT WRITE THE INSPIRATION ITSELF. The client saves through the
 * ordinary `POST /api/inspirations`, with the candidate's id as the save
 * request id so a retry can never make two, and then links that save here.
 * The capture route carries processing, derivation and idempotency that a
 * second writer would have to copy and would drift from; one path for "this
 * is now a memory" is the rule everything else in the archive follows.
 */
import { createHmac } from "node:crypto";

import { and, asc, count, eq, isNull, lte, ne, or, sql } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import { HARVEST_LAPSE_DAYS, harvestCandidates, harvestReasonValues, inspirations, type HarvestContext } from "../db/index.js";
import { getDb } from "../lib/db.js";
import { humanSessionsOnly, requireAuth, type AuthEnv } from "../lib/middleware.js";
import { validationDetails } from "../lib/validation.js";

export { HARVEST_LAPSE_DAYS };
/** At most this many waiting at once; a collector that floods is refused. */
export const HARVEST_MAX_WAITING = 30;
const MAX_PER_PROPOSAL = 10;
const MAX_WORDS = 2000;

const contextSchema = z
  .object({
    /* An app's name as it introduces itself — shown back to the person as
       "Inferred from your … MCP". Reduced to letters, digits and a few
       joiners, so a hostile client cannot put control or direction-override
       characters in front of them — stripped rather than refused, because a
       real client named "Claude Desktop (beta)" must not lose its proposal
       over a parenthesis. */
    tool: z.string().max(80).transform((value) => value.replace(/[^A-Za-z0-9 ._-]/g, "").trim()).optional(),
    project: z.string().trim().max(80).optional(),
    hour: z.number().int().min(0).max(23).optional(),
    position: z.string().trim().max(40).optional(),
    mode: z.string().trim().max(40).optional(),
    readExternal: z.boolean().optional(),
    exploration: z.boolean().optional(),
  })
  .strict();

const proposeSchema = z
  .object({
    candidates: z
      .array(
        z
          .object({
            text: z.string().trim().min(1, "A candidate needs words").max(MAX_WORDS, "A candidate is a sentence or two, not a document"),
            title: z.string().trim().min(1).max(120).optional(),
            context: contextSchema.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_PER_PROPOSAL),
  })
  .strict();

const keepSchema = z.object({ inspirationId: z.string().uuid() }).strict();
/* `other` comes with the person's own words and nothing else does. */
const declineSchema = z
  .object({ reason: z.enum(harvestReasonValues).optional(), note: z.string().trim().min(1).max(280).optional() })
  .strict()
  .refine((body) => (body.reason === "other") === (body.note !== undefined), { message: "A note goes with reason other, and only with it" });
const idSchema = z.string().uuid();

/**
 * The same sentence, however it was spaced or cased, is the same candidate
 * for the same person. Keyed by the server's secret and the profile, so the
 * hash a refused sentence leaves behind cannot be checked against guesses by
 * anyone holding the table without the secret, nor matched across people.
 */
export function harvestHash(profileId: string, text: string): string {
  const normal = text.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
  const secret = process.env.JWT_SECRET ?? process.env.AUTH_SECRET ?? "";
  return createHmac("sha256", `${secret}:harvest:${profileId}`).update(normal).digest("hex");
}

const LAPSE_MS = HARVEST_LAPSE_DAYS * 86_400_000;

/** The moment a candidate made at `createdAt` lapses. */
function harvestLapsesAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + LAPSE_MS);
}

type HarvestWriter = Pick<ReturnType<typeof getDb>, "update">;

/**
 * THE WEEK IS UP: words, title and hash go. Run wherever the basket is read
 * or filled — the GET, the propose (inside its lock, before counting, so an
 * unopened basket cannot fill with week-old rows and refuse new ones
 * forever) and the export — because there is no clock job, and those are
 * the only places the difference can show.
 *
 * AND A KEPT SENTENCE WHOSE SAVE IS GONE may be asked about again: the
 * hash stayed so a kept line is not proposed twice, but once the person has
 * deleted that save (the foreign key empties `inspiration_id`) nothing would
 * otherwise ever let it back.
 */
export async function lapseHarvest(db: HarvestWriter, profileId: string, at: Date): Promise<void> {
  const cutoff = new Date(at.getTime() - LAPSE_MS);
  await db
    .update(harvestCandidates)
    .set({ status: "lapsed", text: null, title: null, sourceHash: null, decidedAt: at })
    .where(and(eq(harvestCandidates.profileId, profileId), eq(harvestCandidates.status, "pending"), lte(harvestCandidates.createdAt, cutoff)));
  await db
    .update(harvestCandidates)
    .set({ sourceHash: null })
    .where(and(eq(harvestCandidates.profileId, profileId), eq(harvestCandidates.status, "kept"), isNull(harvestCandidates.inspirationId), sql`${harvestCandidates.sourceHash} IS NOT NULL`));
}

export interface HarvestRouteDependencies {
  getDatabase?: typeof getDb;
  now?: () => Date;
  /** Tests stand a session up without a token; production uses `requireAuth`. */
  authMiddleware?: MiddlewareHandler<AuthEnv>;
}

export function createHarvestRoutes(deps: HarvestRouteDependencies = {}): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  const now = deps.now ?? (() => new Date());

  routes.use("*", deps.authMiddleware ?? requireAuth);
  routes.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    await next();
  });

  /* PROPOSE. Always into the session's own profile — there is no `?profile=`
     here, because a candidate is a sentence of the person's own and the only
     stack it may wait in is theirs. An agent profile proposes nothing: since
     2026-08-29 agents do not write into the human's material, and a basket
     is not a way around that. */
  routes.post("/", async (c) => {
    const session = c.get("session");
    /* THE KEEPER KEY IS ADMITTED ON PURPOSE, and named so the decision is
       visible: it is the person's own credential, and carrying sentences in
       from a terminal is its job. Deciding on them is not — the routes below
       use `humanSessionsOnly`, which refuses it. The `keyScoped` clause is
       that admission; the profile check is what refuses an agent's session
       (a keeper key always stands as the human, so it needs no second ask). */
    const mayPropose = session.keyScoped === true || session.profile.type === "human";
    if (!mayPropose) {
      return c.json({ error: "Only your own sessions can propose candidates" }, 403);
    }
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }
    const parsed = proposeSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid harvest proposal", details: validationDetails(parsed.error) }, 400);
    }

    const db = getDatabase();
    const profileId = session.profile.id;
    /* ONE PROPOSAL AT A TIME PER PERSON. Counting and inserting outside a
       transaction let parallel proposals each see the same count and each
       fill the basket past its limit; the lock makes the count true for the
       inserts that follow it. */
    const { proposed, skipped } = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"harvest:" + profileId}))`);
      const at = now();
      await lapseHarvest(tx, profileId, at);
      const [{ waiting }] = await tx
        .select({ waiting: count() })
        .from(harvestCandidates)
        .where(and(eq(harvestCandidates.profileId, profileId), eq(harvestCandidates.status, "pending")));
      let space = Math.max(0, HARVEST_MAX_WAITING - Number(waiting));

      let proposed = 0;
      let skipped = 0;
      for (const candidate of parsed.data.candidates) {
        if (space === 0) {
          skipped += 1;
          continue;
        }
        const rows = await tx
          .insert(harvestCandidates)
          .values({
            profileId,
            text: candidate.text,
            title: candidate.title ?? null,
            context: (candidate.context ?? {}) as HarvestContext,
            sourceHash: harvestHash(profileId, candidate.text),
            createdAt: at,
          })
          /* Already waiting, already kept, or already refused: the same
             sentence is not asked about twice. */
          .onConflictDoNothing({ target: [harvestCandidates.profileId, harvestCandidates.sourceHash] })
          .returning({ id: harvestCandidates.id });
        if (rows.length) {
          proposed += 1;
          space -= 1;
        } else {
          skipped += 1;
        }
      }
      return { proposed, skipped };
    });
    return c.json({ proposed, skipped }, proposed ? 201 : 200);
  });

  /* WHAT IS WAITING. The ones past their week are lapsed first, in the same
     request — see `lapseHarvest`. */
  routes.get("/", humanSessionsOnly, async (c) => {
    const db = getDatabase();
    const profileId = c.get("session").profile.id;
    await lapseHarvest(db, profileId, now());
    const rows = await db
      .select({ id: harvestCandidates.id, text: harvestCandidates.text, title: harvestCandidates.title, context: harvestCandidates.context, createdAt: harvestCandidates.createdAt })
      .from(harvestCandidates)
      .where(and(eq(harvestCandidates.profileId, profileId), eq(harvestCandidates.status, "pending")))
      .orderBy(asc(harvestCandidates.createdAt))
      .limit(HARVEST_MAX_WAITING);
    return c.json({
      candidates: rows.map((row) => ({
        id: row.id,
        text: row.text ?? "",
        title: row.title,
        /* Which app proposed it, as the collector named itself — the card
           says "Inferred from your Claude MCP". */
        tool: typeof row.context?.tool === "string" && row.context.tool ? row.context.tool : null,
        createdAt: row.createdAt.toISOString(),
        lapsesAt: harvestLapsesAt(row.createdAt).toISOString(),
      })),
    });
  });

  /* KEPT. The save already exists — the client made it through the ordinary
     route — and this records which save it became and lets the basket's
     copy of the words go. Pressing it twice with the same save is not an
     error: the second press finds the first one's result. */
  routes.post("/:id/keep", humanSessionsOnly, async (c) => {
    const id = idSchema.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "Unknown candidate" }, 404);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }
    const parsed = keepSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid keep", details: validationDetails(parsed.error) }, 400);
    }
    const db = getDatabase();
    const profileId = c.get("session").profile.id;
    const [owned] = await db
      .select({ id: inspirations.id, createdAt: inspirations.createdAt })
      .from(inspirations)
      .where(and(eq(inspirations.profileId, profileId), eq(inspirations.id, parsed.data.inspirationId)));
    if (!owned) return c.json({ error: "That save is not in your archive" }, 404);
    /* THE SAVE MUST BE THE ONE MADE FOR THIS CANDIDATE. Ownership alone let
       any old save be recorded as what the candidate became — the words
       deleted, the hash blocking the sentence for good, and nothing of it
       anywhere. So: no other candidate already points at it, and it was
       made after this candidate was proposed. */
    const [linked] = await db
      .select({ id: harvestCandidates.id })
      .from(harvestCandidates)
      .where(and(eq(harvestCandidates.profileId, profileId), eq(harvestCandidates.inspirationId, owned.id), ne(harvestCandidates.id, id.data)))
      .limit(1);
    if (linked) return c.json({ error: "That save already belongs to another candidate", code: "harvest_save_taken" }, 409);

    const [kept] = await db
      .update(harvestCandidates)
      .set({ status: "kept", text: null, title: null, inspirationId: owned.id, decidedAt: now() })
      /* Pending, or let go only a moment ago: the swipe declines at once
         (so a closed tab cannot leave it waiting), and "cut wrong — keep
         these words instead" can still follow it. A decline with any other
         reason stays a decline. */
      .where(and(eq(harvestCandidates.id, id.data), eq(harvestCandidates.profileId, profileId),
        lte(harvestCandidates.createdAt, owned.createdAt),
        or(eq(harvestCandidates.status, "pending"),
          and(eq(harvestCandidates.status, "declined"), or(isNull(harvestCandidates.reason), eq(harvestCandidates.reason, "miscut"))))))
      .returning({ id: harvestCandidates.id });
    if (kept) return c.json({ id: kept.id, status: "kept" });

    const [row] = await db
      .select({ status: harvestCandidates.status, inspirationId: harvestCandidates.inspirationId, createdAt: harvestCandidates.createdAt })
      .from(harvestCandidates)
      .where(and(eq(harvestCandidates.id, id.data), eq(harvestCandidates.profileId, profileId)));
    if (!row) return c.json({ error: "Unknown candidate" }, 404);
    if (row.status === "kept" && row.inspirationId === parsed.data.inspirationId) return c.json({ id: id.data, status: "kept" });
    if (row.createdAt > owned.createdAt) return c.json({ error: "That save was made before this candidate", code: "harvest_save_older" }, 409);
    return c.json({ error: "This candidate was already decided", code: "harvest_decided", status: row.status }, 409);
  });

  /* LET GO. The words are deleted in the same write. A reason may come with
     the decline or a moment after it, because the reason is a second,
     optional thought and must never be what decides whether the first one
     landed — so a declined candidate with no reason yet accepts one, once. */
  routes.post("/:id/decline", humanSessionsOnly, async (c) => {
    const id = idSchema.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "Unknown candidate" }, 404);
    let raw: unknown = {};
    try {
      const body = await c.req.text();
      raw = body ? JSON.parse(body) : {};
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }
    const parsed = declineSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid decline", details: validationDetails(parsed.error) }, 400);
    }
    const db = getDatabase();
    const profileId = c.get("session").profile.id;
    const reason = parsed.data.reason ?? null;
    const reasonNote = parsed.data.note ?? null;

    const [declined] = await db
      .update(harvestCandidates)
      .set({ status: "declined", text: null, title: null, reason, reasonNote, decidedAt: now() })
      .where(and(eq(harvestCandidates.id, id.data), eq(harvestCandidates.profileId, profileId), eq(harvestCandidates.status, "pending")))
      .returning({ id: harvestCandidates.id });
    if (declined) return c.json({ id: declined.id, status: "declined", reason });

    if (reason) {
      const [explained] = await db
        .update(harvestCandidates)
        .set({ reason, reasonNote })
        .where(and(
          eq(harvestCandidates.id, id.data),
          eq(harvestCandidates.profileId, profileId),
          eq(harvestCandidates.status, "declined"),
          isNull(harvestCandidates.reason),
        ))
        .returning({ id: harvestCandidates.id });
      if (explained) return c.json({ id: explained.id, status: "declined", reason });
    }
    const [row] = await db
      .select({ status: harvestCandidates.status, reason: harvestCandidates.reason })
      .from(harvestCandidates)
      .where(and(eq(harvestCandidates.id, id.data), eq(harvestCandidates.profileId, profileId)));
    if (!row) return c.json({ error: "Unknown candidate" }, 404);
    if (row.status === "declined") return c.json({ id: id.data, status: "declined", reason: row.reason });
    return c.json({ error: "This candidate was already decided", code: "harvest_decided", status: row.status }, 409);
  });

  return routes;
}
