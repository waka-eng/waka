/**
 * `GET /api/claims` — the claims awaiting this person's word, as a queue.
 *
 * The second of the three surfaces the mobile IA is built from: you dump into
 * layer 1, you answer here, and you read layers 3 and 4. Everything this route
 * serves already existed in `/api/signals`; what did not exist was an address
 * where a claim is reachable *because it is unanswered* rather than because it
 * ranked high enough to be cited somewhere else.
 *
 * That distinction is the whole reason for the file. A claim used to be
 * reachable only as a `ground` under a top-of-mind entry, and a top of mind
 * cites only the strongest signals — so a weak claim was never selected, never
 * shown, never affirmed, and so never gained the confidence that affirming
 * grants. See `listClaimsAwaitingVerdict` for the loop written out; the short
 * version is that the claims most in need of a human's word were the only ones
 * a human could not reach.
 *
 * The verdict itself is NOT here. Answering is `POST /api/feedback` with a
 * `signal` target, which already records `true | partly | not_true`, already
 * binds the answer to the wording it was given about, and already resolves a
 * contested pair as a side effect. A second write path for the same act would
 * be a second place for those rules to drift.
 *
 * Read access is the same matrix every layer-2 read uses — `resolveProfileScope`
 * with `"read"`, so an agent may ask for a granted sibling's queue exactly as
 * it may ask for their signals. And the serve is on the record: a read of
 * someone's unanswered claims is a read of their mind, so it writes the same
 * `signals` consultation row the list route writes.
 */
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import { and, eq, inArray } from "drizzle-orm";

import { inspirations } from "../db/index.js";
import { recordConsultation } from "../lib/consultations.js";
import { getDb } from "../lib/db.js";
import { requireAuth, type AuthEnv } from "../lib/middleware.js";
import { validationDetails } from "../lib/validation.js";
import {
  listClaimsAwaitingVerdict,
  loadProfileTarget,
  resolveProfileScope,
} from "./signals.js";

/**
 * How many unanswered claims one serve returns.
 *
 * The queue is a thing you finish, so the bound is a screenful and a little
 * more rather than the whole backlog — a page that cannot reach zero is an
 * inbox people learn to ignore. `total` in the response is the honest count
 * behind the bound, so the tab badge never lies about what is waiting.
 */
const DEFAULT_CLAIM_LIMIT = 20;
const MAX_CLAIM_LIMIT = 100;

const claimsQuerySchema = z
  .object({
    limit: z
      .string()
      .regex(/^\d+$/, "limit must be an integer")
      .transform((value) => Number.parseInt(value, 10))
      .pipe(
        z
          .number()
          .int("limit must be an integer")
          .min(1, "limit must be at least 1")
          .max(MAX_CLAIM_LIMIT, `limit must be <= ${MAX_CLAIM_LIMIT}`),
      )
      .optional(),
    profile: z.string().uuid("profile must be a uuid").optional(),
  })
  .strict();

/** How many saves ride with a claim. See the note at the query. */
const EVIDENCE_PER_CLAIM = 4;

/** Enough of a save to recognise it, never the whole thing: this sits under a
    sentence a person is being asked to rule on, and a paragraph here would
    make the claim the smallest thing on screen. */
const EVIDENCE_PREVIEW_CHARS = 96;

function previewOf(text: string): string {
  const said = text.replace(/\s+/g, " ").trim();
  return said.length <= EVIDENCE_PREVIEW_CHARS ? said : `${said.slice(0, EVIDENCE_PREVIEW_CHARS - 1).trimEnd()}…`;
}

interface ClaimsRouteDependencies {
  authMiddleware?: MiddlewareHandler<AuthEnv>;
  getDatabase?: typeof getDb;
  loadProfile?: typeof loadProfileTarget;
  listClaims?: typeof listClaimsAwaitingVerdict;
}

export function createClaimsRoutes(deps: ClaimsRouteDependencies = {}): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  const loadProfile = deps.loadProfile ?? loadProfileTarget;
  const listClaims = deps.listClaims ?? listClaimsAwaitingVerdict;

  routes.use("*", deps.authMiddleware ?? requireAuth);
  /* A queue is stale the moment it is answered, and a cached one invites a
     person to rule twice on the same wording. */
  routes.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    await next();
  });

  routes.get("/", async (c) => {
    const parsed = claimsQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json(
        { error: "Invalid claims query", details: validationDetails(parsed.error) },
        400,
      );
    }

    const db = getDatabase();
    const scope = await resolveProfileScope(
      db,
      c.get("session"),
      parsed.data.profile,
      "read",
      loadProfile,
    );
    if (!scope.ok) return c.json(scope.body, scope.status);

    const limit = parsed.data.limit ?? DEFAULT_CLAIM_LIMIT;
    /* One over the bound, so "is there more than this page" is a fact rather
       than a second count query that could disagree with the first. */
    const rows = await listClaims(db, { profileId: scope.profileId, limit: limit + 1 });
    const page = rows.slice(0, limit);

    /**
     * THE SAVES EACH CLAIM WAS READ FROM, IN THE PERSON'S OWN WORDS.
     *
     * A claim arrives already carrying the ids it was derived from, and the
     * note on `listClaimsAwaitingVerdict` says why they ride along: "a claim
     * shown with no sense of where it came from is a horoscope". Ids are not
     * a sense of where it came from. Until this, the only honest thing the
     * screen could say was a NUMBER — and a number is exactly the shape a
     * horoscope takes when it wants to sound measured.
     *
     * What makes a claim falsifiable is the material. "You keep things that
     * make a decision smaller" beside the four things you actually kept is a
     * reading a person can check; the same sentence alone is a statement
     * they can only agree or disagree with on vibes. It also changes what
     * "not true" MEANS: with the saves visible, rejecting a claim is
     * correcting a misreading of evidence rather than being told who you are
     * and having to argue back.
     *
     * CAPPED AT FOUR PER CLAIM, oldest-shown-first by the order the lineage
     * recorded. Enough to show the pattern, few enough that the answer stays
     * the thing on screen rather than a reading list.
     */
    const wanted = [...new Set(page.flatMap((row) => (row.inspirationIds ?? []).slice(0, EVIDENCE_PER_CLAIM)))];
    const previews = wanted.length
      ? await db
          .select({ id: inspirations.id, text: inspirations.text })
          .from(inspirations)
          .where(
            and(
              /* Owner-scoped in the query, not filtered after it: a claim's
                 lineage is this profile's by construction, and a read that
                 trusted the lineage alone would be one bad row away from
                 serving someone else's words. */
              eq(inspirations.profileId, scope.profileId),
              inArray(inspirations.id, wanted),
            ),
          )
      : [];
    const said = new Map(previews.map((row) => [row.id, row.text]));
    const claims = page.map((row) => ({
      ...row,
      from: (row.inspirationIds ?? [])
        .slice(0, EVIDENCE_PER_CLAIM)
        .flatMap((id) => {
          const text = said.get(id);
          /* A save that has since been deleted is simply absent. The claim
             still stands on the evidence that remains, and inventing a
             placeholder for a thing a person removed would be the product
             holding on to something they threw away. */
          return text === undefined ? [] : [{ id, preview: previewOf(text) }];
        }),
    }));

    await recordConsultation(db, {
      profileId: scope.profileId,
      session: c.get("session"),
      surface: "signals",
    });

    return c.json({ claims, more: rows.length > limit }, 200);
  });

  return routes;
}
