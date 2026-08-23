/**
 * POST /api/inspirations — saving something.
 *
 * The one write on this route that can reach outside the account, and so the
 * file where the two rules that keep it inside live as named functions rather
 * than as expressions buried in the handler:
 *
 *   `sourceForCapture`      — whose initiative the content is.
 *   `visibilityForCapture`  — whether the capture may leave the account.
 *
 * Both were inline before this file existed, which meant the second one — the
 * fix for a real bug, described on `visibilityForCapture` — was a pair of
 * lines in the middle of a hundred-line handler that no test could reach. This
 * codebase already learned that lesson elsewhere: a rule nobody can execute is
 * a rule nobody has checked. Both are exported, and
 * `inspirations-capture.test.ts` runs them.
 */

import { Hono } from "hono";

import {
  decisionPrincipleCitations,
  inspirations,
  reflections,
  type InspirationSource,
  type InspirationVisibility,
} from "../db/index.js";
import { getDb } from "../lib/db.js";
import type { AuthEnv } from "../lib/middleware.js";
import type { AuthenticatedSession } from "../lib/session.js";
import { requestSignalDerivation } from "./inspirations-derivation.js";
import {
  inspirationSelection,
  reflectionSelection,
  serializeInspirationDetail,
} from "./inspirations-serialization.js";
import { resolveTargetProfile } from "./inspirations-tenancy.js";
import {
  createInspirationSchema,
  profileQuerySchema,
} from "./inspirations-validation.js";

/**
 * Whose initiative the content is.
 *
 * A human session's capture is its own initiative by definition; only an
 * agent session can be relaying someone else's. A browser cannot claim to be
 * an agent by sending a field.
 */
export function sourceForCapture(
  session: AuthenticatedSession,
  requested: InspirationSource | undefined,
): InspirationSource {
  return session.profile.type === "agent" ? requested ?? "agent" : "app";
}

/**
 * CAPTURING FOR SOMEONE IS NOT PUBLISHING FOR THEM.
 *
 * Agents legitimately hold "capture" on the human profile — relaying
 * something you said is the whole point of the tool. `visibility` is a
 * different permission wearing the same request: public means the text
 * enters the ground of every group that profile belongs to, attributed to
 * them, readable across an account boundary the canon says an inspiration
 * never crosses.
 *
 * An agent credential is reachable by prompt injection, so this was a
 * one-request path from "an agent read a poisoned page" to "a stranger's
 * sentence is published under your name in your rooms". Writing for
 * yourself is unchanged; writing for someone else falls back to the
 * column's default, which is private.
 *
 * Returning `undefined` rather than `"private"` is deliberate and is the
 * other half of the fix: the caller writes no `visibility` column at all, so
 * the database's own default decides what unset means, in one place. A
 * literal here would be a second place to keep in agreement with it.
 */
export function visibilityForCapture(
  session: AuthenticatedSession,
  targetProfileId: string,
  requested: InspirationVisibility | undefined,
): InspirationVisibility | undefined {
  const forSomeoneElse = targetProfileId !== session.profile.id;
  return forSomeoneElse ? undefined : requested;
}

/**
 * POST /api/inspirations
 *
 * The capture and its same-submit reflections land in one transaction: a
 * durable capture with the answers missing would be a worse record of the
 * moment than no capture at all.
 */
export function registerCaptureRoutes(
  routes: Hono<AuthEnv>,
  getDatabase: typeof getDb,
): void {
  routes.post("/", async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }

    const parsed = createInspirationSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        {
          error: "Invalid inspiration payload",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }

    const query = profileQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return c.json(
        { error: "Invalid query", details: query.error.flatten().fieldErrors },
        400,
      );
    }

    const session = c.get("session");
    const db = getDatabase();
    const target = await resolveTargetProfile(db, session, query.data.profile, "capture");
    if (!target.ok) return c.json(target.body, target.status);

    /* A citation without a decision is a claim with nothing deciding — the
       shape mismatch is refused, not guessed at. */
    if (
      parsed.data.citedPrincipleIds?.length &&
      parsed.data.kind !== "decision"
    ) {
      return c.json(
        { error: "Only a decision (kind=decision) may cite principles" },
        400,
      );
    }

    const source = sourceForCapture(session, parsed.data.source);
    const visibility = visibilityForCapture(
      session,
      target.profileId,
      parsed.data.visibility,
    );

    const now = new Date();
    const reflectionInputs = parsed.data.reflections ?? [];

    const persistInspiration = () =>
      db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(inspirations)
        .values({
          profileId: target.profileId,
          text: parsed.data.text,
          kind: parsed.data.kind ?? null,
          source,
          /* absent means private, and that is the column's own default rather
             than a value written here — one place decides what unset means */
          ...(visibility ? { visibility } : {}),
          createdAt: now,
          updatedAt: now,
        })
        .returning(inspirationSelection);

      if (!inserted) throw new Error("Failed to create inspiration");

      /* The write-back half of the consultation record: the decision's
         citations go through composite (profile_id, id) foreign keys, so an
         invented id — or a real principle belonging to someone else — is
         refused by Postgres itself, and the p-id citations agents are
         instructed to make stop evaporating into their own transcripts. */
      const citedPrincipleIds = parsed.data.citedPrincipleIds ?? [];
      if (citedPrincipleIds.length > 0) {
        await tx.insert(decisionPrincipleCitations).values(
          [...new Set(citedPrincipleIds)].map((principleId) => ({
            profileId: target.profileId,
            inspirationId: inserted.id,
            principleId,
          })),
        );
      }

      const insertedReflections =
        reflectionInputs.length > 0
          ? await tx
              .insert(reflections)
              .values(
                reflectionInputs.map((reflection, index) => ({
                  profileId: target.profileId,
                  inspirationId: inserted.id,
                  question: reflection.question,
                  answer: reflection.answer ?? null,
                  skipped: reflection.skipped ?? false,
                  // Preserve authored order even where the column's precision
                  // would otherwise collapse several rows onto one instant.
                  createdAt: new Date(now.getTime() + index),
                })),
              )
              .returning(reflectionSelection)
          : [];

        return { inserted, insertedReflections };
      });

    let persisted: Awaited<ReturnType<typeof persistInspiration>>;
    try {
      persisted = await persistInspiration();
    } catch (err) {
      /* The composite FK doing its job: the cited id is not a principle of
         this profile. That is a caller mistake, not a server fault. Drizzle
         wraps the postgres error, so the code may sit one level down. */
      const pgCode =
        (err as { code?: string }).code ??
        (err as { cause?: { code?: string } }).cause?.code;
      if (pgCode === "23503") {
        return c.json(
          { error: "A decision may cite only principles this profile holds" },
          400,
        );
      }
      throw err;
    }

    await requestSignalDerivation({
      profileId: target.profileId,
      inspirationId: persisted.inserted.id,
      reason: "created",
    });

    return c.json(
      {
        inspiration: serializeInspirationDetail(persisted.inserted, {
          attachments: [],
          reflections: persisted.insertedReflections,
        }),
      },
      201,
    );
  });
}
