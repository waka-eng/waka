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
  attachments,
  experiences,
  inspirations,
  inspirationConversationOrigins,
  reflections,
  type InspirationSource,
  type InspirationVisibility,
} from "../db/index.js";
import { getDb } from "../lib/db.js";
import type { AuthEnv } from "../lib/middleware.js";
import type { AuthenticatedSession } from "../lib/session.js";
import { validationDetails } from "../lib/validation.js";
import { requestSignalDerivation } from "../lib/inspiration-derivation-requests.js";
import { enqueueEnrichAttachment, wakeCommittedBackgroundJobs } from "../lib/queue.js";
import { assertAttachmentKeysUnused, prepareInspirationAttachments, InspirationAttachmentError, type AttachmentHead } from '../lib/inspiration-attachments.js';
import { attachmentSelection, serializeAttachment } from './attachments.js';
import { inspirationSaveFailure, parseInspirationSaveRequestId, runInspirationSave } from '../lib/inspiration-save-requests.js';
import { readSavedInspiration } from './inspirations-save-requests.js';
import {prepareConversationOrigin} from '../lib/conversation-capture.js';
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
 * Cross-profile capture is now the human admin's act; agents cannot capture
 * into the human's memory. `visibility` still needs its own conservative
 * treatment for a cross-profile write: public means the text
 * enters the ground of every group that profile belongs to, attributed to
 * them, readable across an account boundary the canon says an inspiration
 * never crosses.
 *
 * Before the read-only agent boundary, this guarded the one-request path
 * from poisoned context to publishing under someone else's name. Writing for
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
  attachmentHead?: AttachmentHead,
): void {
  routes.post("/", async (c) => {
    c.header('Cache-Control', 'private, no-store');
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
          details: validationDetails(parsed.error),
        },
        400,
      );
    }

    const query = profileQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return c.json(
        { error: "Invalid query", details: validationDetails(query.error) },
        400,
      );
    }

    const session = c.get("session");
    if(parsed.data.fromConversation&&(session.keyScoped||session.profile.type!=='human'))return c.json({error:'Save conversation thoughts from your personal session.'},403);
    if(parsed.data.fromConversation&&!c.req.header('Idempotency-Key'))return c.json({error:'A save identity is required.'},400);
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
    const citedPrincipleIds = [...new Set((parsed.data.citedPrincipleIds ?? []).map((id) => id.toLowerCase()))].sort();

    const persistInspiration = () =>
      runInspirationSave(db, {
        profileId: target.profileId, requestId: parseInspirationSaveRequestId(c.req.header('Idempotency-Key')), operation: 'inspiration',
        material: { text: parsed.data.text, kind: parsed.data.kind ?? null, source, visibility: visibility ?? 'private',
          ...(parsed.data.fromConversation?{fromConversation:parsed.data.fromConversation}:{}),
          ...(parsed.data.attachments ? { attachments: parsed.data.attachments } : {}),
          experience: parsed.data.experience ?? null, citedPrincipleIds,
          reflections: reflectionInputs.map((reflection) => ({ question: reflection.question, answer: reflection.answer ?? null, skipped: reflection.skipped ?? false })) },
      }, async (tx) => {
      const origin=parsed.data.fromConversation?await prepareConversationOrigin(tx,target.profileId,parsed.data.fromConversation,parsed.data.text):null;
      /* THE NAMED GROUND, found or made in the same transaction as the
         memory that stands on it. Find-or-create by name because a name is
         how the keeper (usually an agent mid-task) refers to the stretch of
         work; the upsert races safely on the (profile, name) unique. Scoped
         to the TARGET profile: a capture written for an agent files under
         the agent's own experiences, never the writer's. */
      let experienceId: string | null = null;
      if (parsed.data.experience !== undefined) {
        const [experienceRow] = await tx
          .insert(experiences)
          .values({ profileId: target.profileId, name: parsed.data.experience })
          .onConflictDoUpdate({
            target: [experiences.profileId, experiences.name],
            /* a no-op write, so RETURNING answers on the existing row too */
            set: { name: parsed.data.experience },
          })
          .returning({ id: experiences.id });
        experienceId = experienceRow?.id ?? null;
      }

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
          ...(experienceId ? { experienceId } : {}),
          createdAt: now,
          updatedAt: now,
        })
        .returning(inspirationSelection);

      if (!inserted) throw new Error("Failed to create inspiration");
      if(origin)await tx.insert(inspirationConversationOrigins).values({...origin,inspirationId:inserted.id});

      const media = parsed.data.attachments?.length ? await prepareInspirationAttachments(parsed.data.attachments,
        { uploaderProfileId: session.profile.id, profileId: target.profileId, inspirationId: inserted.id }, attachmentHead) : [];
      /* ONE STORED OBJECT, ONE ATTACHMENT — the rule the chat finalize already
         keeps. Without it a note could name an object one of the same
         person's chat messages already carries, and deleting the note would
         delete the chat's file with it. Found by the 2026-10-16 security
         review of the attachments work. */
      const keys = media.map((row) => row.s3Key).filter((key): key is string => typeof key === 'string');
      /* (The same object twice in ONE save is already refused by the input
         schema — "An attachment is included twice".) */
      await assertAttachmentKeysUnused(tx, keys);
      const insertedAttachments = media.length ? await tx.insert(attachments).values(media).returning(attachmentSelection) : [];
      for (const attachment of insertedAttachments) {
        if (attachment.enrichmentStatus === 'pending') await enqueueEnrichAttachment(target.profileId, attachment.id, inserted.id, tx);
      }

      /* The write-back half of the consultation record: the decision's
         citations go through composite (profile_id, id) foreign keys, so an
         invented id — or a real principle belonging to someone else — is
         refused by Postgres itself, and the p-id citations agents are
         instructed to make stop evaporating into their own transcripts. */
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

        const processing = await requestSignalDerivation({ profileId: target.profileId, inspirationId: inserted.id,
          reason: "created", changedSource: "inspiration" }, tx);
        const saved={inspirationId:inserted.id,reflectionId:null,processing:processing.receipt};
        return {...saved,response:origin?await readSavedInspiration(tx,target.profileId,saved):{inspiration:{...serializeInspirationDetail(inserted,{attachments:insertedAttachments.map(serializeAttachment),reflections:insertedReflections}),conversationOrigin:null},processing:processing.receipt}};
      }, (tx, saved) => readSavedInspiration(tx, target.profileId, saved));

    let persisted: Awaited<ReturnType<typeof persistInspiration>>;
    try {
      persisted = await persistInspiration();
    } catch (err) {
      if (err instanceof InspirationAttachmentError) return c.json({ error: err.message, code: err.code }, err.status);
      const failure = inspirationSaveFailure(err);
      if (failure) return c.json({ error: failure.message, code: failure.code }, failure.status);
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

    await wakeCommittedBackgroundJobs();

    return c.json({ ...persisted.response, ...(persisted.saveRequest ? { saveRequest: persisted.saveRequest } : {}) }, persisted.replayed ? 200 : 201);
  });
}
