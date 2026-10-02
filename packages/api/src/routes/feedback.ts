/**
 * `/api/feedback` — a reader's verdict on something WAKA generated.
 *
 * Deliberately narrow: does this signal ring true, does this top-of-mind entry
 * land. That is the part that is genuinely a reaction, and it is what the next
 * regeneration reads back.
 *
 * Pin, dismiss and lock are **not** feedback. They are state on the entry, set
 * through the entry's own endpoints, because the generator has to read them on
 * every pass and "is this pinned?" must never require replaying a history of
 * reactions. A request that asks for one of them here is answered with that
 * redirection rather than a bare validation error: the caller is not
 * malformed, it is aimed at the wrong door.
 *
 * A target must belong to the acting profile. A group entry is not a valid
 * target: what a group says about itself changes through proposals, so a
 * private verdict on a shared entry would be a vote nobody else can see.
 */

import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import {
  feedback,
  principles,
  feedbackTargetTypeValues,
  feedbackValueValues,
  groupMembers,
  profiles,
  signalShares,
  signals,
  topOfMindEntries,
  topOfMinds,
  type Feedback,
  type FeedbackTargetType,
  type FeedbackValue,
} from "../db/index.js";
import { resolveContestedPairs } from "../lib/contested-pairs.js";
import { getDb } from "../lib/db.js";
import { enqueueGroupTopOfMindRefresh } from "../lib/queue.js";
import { requireAuth, type AuthEnv } from "../lib/middleware.js";
import { enqueueTopOfMindRefresh, wakeCommittedBackgroundJobs } from "../lib/queue.js";
import { validationDetails } from "../lib/validation.js";

type WakaDb = ReturnType<typeof getDb>;
type WakaTx = Parameters<Parameters<WakaDb['transaction']>[0]>[0];

export class FeedbackTargetChangedError extends Error {
  constructor() { super('This wording changed. Read it again before responding.'); }
}

const DEFAULT_FEEDBACK_LIMIT = 50;
const MAX_FEEDBACK_LIMIT = 100;
const MAX_CORRECTION_TEXT_LENGTH = 2000;

/** Words that mean entry state. Listed so the refusal can say where they go. */
const ENTRY_STATE_VALUES = [
  "important",
  "not_important",
  "pin",
  "pinned",
  "dismiss",
  "dismissed",
] as const;

const ENTRY_STATE_MESSAGE =
  "Pinning and dismissing are entry state, not feedback. Use the top-of-mind entry's pin/dismiss endpoints; feedback records whether a claim rings true.";

const createFeedbackRequestSchema = z
  .object({
    targetType: z.enum(feedbackTargetTypeValues),
    targetId: z.string().uuid("targetId must be a uuid"),
    value: z.enum(feedbackValueValues),
    targetRevision: z.string().regex(/^[1-9]\d{0,18}$/).refine((value) => BigInt(value) <= 9223372036854775807n).optional(),
    correctionText: z
      .string()
      .trim()
      .min(1, "correctionText cannot be empty")
      .max(
        MAX_CORRECTION_TEXT_LENGTH,
        `correctionText must be <= ${MAX_CORRECTION_TEXT_LENGTH} characters`,
      )
      .optional(),
  })
  .strict();

const listFeedbackQuerySchema = z
  .object({
    targetType: z.enum(feedbackTargetTypeValues).optional(),
    targetId: z.string().uuid("targetId must be a uuid").optional(),
    limit: z
      .string()
      .regex(/^\d+$/, "limit must be an integer")
      .transform((value) => Number.parseInt(value, 10))
      .pipe(
        z
          .number()
          .int("limit must be an integer")
          .min(1, "limit must be at least 1")
          .max(MAX_FEEDBACK_LIMIT, `limit must be <= ${MAX_FEEDBACK_LIMIT}`),
      )
      .optional(),
  })
  .strict();

export interface FeedbackRecord {
  id: string;
  profileId: string;
  targetType: FeedbackTargetType;
  targetId: string;
  value: FeedbackValue;
  correctionText: string | null;
  createdAt: string;
  targetRevision?: string | null;
}

export interface CreateFeedbackInput {
  profileId: string;
  targetType: FeedbackTargetType;
  targetId: string;
  value: FeedbackValue;
  correctionText?: string;
  targetRevision?: string;
}

export interface ListFeedbackInput {
  profileId: string;
  targetType?: FeedbackTargetType;
  targetId?: string;
  limit: number;
}

export interface FeedbackRouteDependencies {
  getDatabase?: typeof getDb;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
  createFeedback?: (db: WakaDb, input: CreateFeedbackInput) => Promise<FeedbackRecord | null>;
  listFeedback?: (db: WakaDb, input: ListFeedbackInput) => Promise<FeedbackRecord[]>;
}

function serializeFeedback(row: Feedback): FeedbackRecord {
  return {
    id: row.id,
    profileId: row.profileId,
    targetType: row.targetType,
    targetId: row.targetId,
    value: row.value,
    correctionText: row.correctionText,
    createdAt: row.createdAt.toISOString(),
    targetRevision: row.targetRevision?.toString() ?? null,
  };
}

/**
 * Is this target the acting profile's to judge?
 *
 * `feedback.target_id` is not a foreign key — it points at two tables — so
 * this is the check that keeps it honest. Without it, feedback could be filed
 * against any id at all, and regeneration would read a stranger's verdict as
 * the owner's.
 */
/**
 * MAY THIS PROFILE ANSWER THIS SIGNAL? The rule alone, so it can be executed.
 *
 * Widening feedback from "signals you own" to "signals shared into your rooms"
 * changed who may write about whose statement, and nothing executed it — the
 * route tests inject a mock. Two facts decide it, and both must be supplied by
 * a caller that read them from the database under the acting profile's
 * identity: never trust either from a request.
 */
export function mayAnswerSignal(input: {
  ownsIt: boolean;
  sharedIntoARoomYouAreIn: boolean;
}): boolean {
  return input.ownsIt || input.sharedIntoARoomYouAreIn;
}

async function targetBelongsToProfile(
  db: WakaDb | WakaTx,
  input: { profileId: string; targetType: FeedbackTargetType; targetId: string },
): Promise<boolean> {
  if (input.targetType === "signal") {
    const [own] = await db
      .select({ id: signals.id })
      .from(signals)
      .where(and(eq(signals.id, input.targetId), eq(signals.profileId, input.profileId)))
      .limit(1);
    const ownsIt = Boolean(own);
    if (ownsIt) return true;

    /**
     * A STATEMENT SOMEBODY SHARED WITH YOU CAN BE ANSWERED.
     *
     * Feedback used to require that you owned the signal, which meant a room
     * was a place where claims were posted and nobody could reply — and the
     * affirmations a room's synthesis is supposed to read had no way to
     * accumulate.
     *
     * So: a signal is answerable if its owner shared it into a group you are
     * currently in. Both halves are checked here, and membership is read now
     * rather than trusted from earlier — leaving a room ends your standing to
     * answer what was said in it.
     *
     * WHAT THIS DOES NOT GRANT. Reacting to a statement gives no access to
     * anything beneath it. The evidence rows naming the exact spans of the
     * author's memories stay where they are; sharing a statement has never
     * shipped its grounds and does not start now.
     */
    /**
     * STANDING MIRRORS THE WALL, EXACTLY. The wall withholds a share whose
     * owner has left (leaving withdraws it) and drops retired signals — so
     * answerability must too, or a member could keep filing verdicts against
     * a statement the room can no longer see. Three joins, three facts: you
     * are in the room now, its owner is in the room now, and the signal
     * still stands.
     */
    const ownerSeat = alias(groupMembers, "owner_seat");
    const [shared] = await db
      .select({ id: signalShares.id })
      .from(signalShares)
      .innerJoin(
        signals,
        and(eq(signals.id, signalShares.signalId), ne(signals.status, "retired")),
      )
      .innerJoin(
        groupMembers,
        and(
          eq(groupMembers.groupId, signalShares.groupId),
          eq(groupMembers.profileId, input.profileId),
        ),
      )
      .innerJoin(
        ownerSeat,
        and(
          eq(ownerSeat.groupId, signalShares.groupId),
          eq(ownerSeat.profileId, signalShares.profileId),
        ),
      )
      .where(eq(signalShares.signalId, input.targetId))
      .for('key share', { of: [signalShares, groupMembers, ownerSeat] })
      .limit(1);

    /**
     * A STATEMENT YOUR ROOM GREW CAN BE ANSWERED (2026-08-24). A room-grown
     * signal belongs to the room's mind, so the share join above never sees
     * it — its standing rule is simpler: you are a current member of the
     * room whose mind holds it, and it still stands. Two joins, two facts.
     * The two-voices serve gate is a WALL rule, deliberately not repeated
     * here: a member who saw a statement on the wall a moment ago may still
     * answer it while a co-contributor's departure has it below the bar —
     * a stance filed on something the room genuinely grew is never invalid.
     */
    const [grown] = await db
      .select({ id: signals.id })
      .from(signals)
      .innerJoin(
        profiles,
        and(eq(profiles.id, signals.profileId), eq(profiles.type, "group")),
      )
      .innerJoin(
        groupMembers,
        and(
          eq(groupMembers.groupId, profiles.groupId),
          eq(groupMembers.profileId, input.profileId),
        ),
      )
      .where(
        and(
          eq(signals.id, input.targetId),
          ne(signals.status, "retired"),
          /* AND NOT SET ASIDE. The wall refuses to serve a dismissed
             statement, so a member cannot be looking at one; accepting a
             stance on it would file an answer to something the room has
             already put down, and nothing would ever show it back. The
             two-voices gate is deliberately NOT repeated here (see above) —
             that one is about a statement drifting below the bar while
             somebody had it on screen, which is a race worth forgiving.
             A dismissal is a decision, and there is nothing to forgive. */
          isNull(signals.dismissedAt),
        ),
      )
      .for('key share', { of: groupMembers })
      .limit(1);

    return mayAnswerSignal({
      ownsIt,
      sharedIntoARoomYouAreIn: Boolean(shared) || Boolean(grown),
    });
  }

  if (input.targetType === "principle") {
    const [row] = await db
      .select({ id: principles.id })
      .from(principles)
      .where(and(eq(principles.id, input.targetId), eq(principles.profileId, input.profileId)))
      .limit(1);
    return Boolean(row);
  }

  const [row] = await db
    .select({ id: topOfMindEntries.id })
    .from(topOfMindEntries)
    .innerJoin(topOfMinds, eq(topOfMinds.id, topOfMindEntries.topOfMindId))
    .where(
      and(
        eq(topOfMindEntries.id, input.targetId),
        eq(topOfMinds.profileId, input.profileId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function createFeedbackForProfile(
  db: WakaDb,
  input: CreateFeedbackInput,
): Promise<FeedbackRecord | null> {
  const result = await db.transaction((tx) => persistFeedback(tx, input));
  if (result) await wakeCommittedBackgroundJobs();
  return result;
}

async function persistFeedback(tx: WakaTx, input: CreateFeedbackInput): Promise<FeedbackRecord | null> {
  // No model call spans this lock. A busy writer fails promptly instead of
  // allowing a verdict to settle on different words while waiting.
  await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
  if (!await targetBelongsToProfile(tx, input)) return null;
  const [target] = input.targetType === 'signal'
    ? await tx.select({ revision: signals.statementRevision, profileId: signals.profileId }).from(signals)
      .where(eq(signals.id, input.targetId)).for('no key update', { noWait: true }).limit(1)
    : input.targetType === 'principle'
      ? await tx.select({ revision: principles.statementRevision, profileId: principles.profileId }).from(principles)
        .where(eq(principles.id, input.targetId)).for('no key update', { noWait: true }).limit(1)
      : await tx.select({ revision: topOfMindEntries.bodyRevision, profileId: topOfMinds.profileId }).from(topOfMindEntries)
        .innerJoin(topOfMinds, eq(topOfMinds.id, topOfMindEntries.topOfMindId))
        .where(eq(topOfMindEntries.id, input.targetId)).for('no key update', { of: topOfMindEntries, noWait: true }).limit(1);
  if (!target?.profileId) return null;
  if (!await targetBelongsToProfile(tx, input)) return null;
  if (input.targetRevision && input.targetRevision !== target.revision.toString()) throw new FeedbackTargetChangedError();

  const [row] = await tx
    .insert(feedback)
    .values({
      profileId: input.profileId,
      targetType: input.targetType,
      targetId: input.targetId,
      targetRevision: target.revision,
      value: input.value,
      correctionText: input.correctionText ?? null,
    })
    .returning();

  // A verdict on the owner's OWN signal arbitrates any contested pair it
  // stands in: true → the other side yields, not_true → this side yields,
  // partly → nothing (an invitation to sharpen, not an arbitration). Owner
  // only — a room member answering a shared statement judges the statement,
  // not the owner's disputes, so the ownership check is explicit here.
  if (
    row &&
    input.targetType === "signal" &&
    (input.value === "true" || input.value === "not_true")
  ) {
    const [ownSignal] = await tx
      .select({ id: signals.id })
      .from(signals)
      .where(and(eq(signals.id, input.targetId), eq(signals.profileId, input.profileId)))
      .limit(1);
    if (ownSignal) {
      await resolveContestedPairs(tx, {
        profileId: input.profileId,
        signalId: input.targetId,
        act: input.value === "true" ? "affirm" : "deny",
      });
    }
  }

  // The owner's dispute marks the principle contested at feedback time —
  // immediate state maintenance, deliberately outside the nightly cadence:
  // waiting a day to stop asserting something already refuted would be
  // dishonesty, not thrift.
  if (row && input.targetType === "principle" && input.value === "not_true") {
    await tx
      .update(principles)
      .set({ state: "contested", updatedAt: new Date() })
      .where(
        and(eq(principles.id, input.targetId), eq(principles.profileId, input.profileId)),
      );
  }
  /**
   * AGREEING WITH A ROOM'S STATEMENT ASKS THE ROOM TO THINK AGAIN.
   *
   * A room used to wait for a person to write a proposal. Under the goal it
   * should draft when enough shared, affirmed material has accumulated — so
   * the moment somebody agrees with a statement said in a room, that room is
   * asked to re-synthesise.
   *
   * WHERE THE THRESHOLD LIVES. Not here. `enqueueGroupTopOfMindRefresh` is
   * keyed on the group, so repeat agreements coalesce into one pending job
   * rather than one per click, and synthesis itself decides whether there is
   * enough to say — which is the layer that already knows, and the layer that
   * refuses to speak from thin evidence. Putting a count in this function
   * would be a second opinion about the same question, in the wrong place.
   *
   * Every deliberate reaction changes the room's standing input. Queue one
   * coalesced pass for each currently accessible room, including room-grown
   * signals; this never injects the reaction into a personal prompt.
   */
  if (row && input.targetType === "signal") {
    const ownerSeat = alias(groupMembers, 'feedback_owner_seat');
    const sharedInto = await tx
      .select({ groupId: signalShares.groupId })
      .from(signalShares)
      .innerJoin(groupMembers, eq(groupMembers.groupId, signalShares.groupId))
      .innerJoin(ownerSeat, and(eq(ownerSeat.groupId, signalShares.groupId), eq(ownerSeat.profileId, signalShares.profileId)))
      .where(
        and(
          eq(signalShares.signalId, input.targetId),
          eq(groupMembers.profileId, input.profileId),
        ),
      ).for('key share', { of: [signalShares, groupMembers, ownerSeat] });
    const grownInto = await tx.select({ groupId: profiles.groupId }).from(profiles)
      .innerJoin(groupMembers, and(eq(groupMembers.groupId, profiles.groupId), eq(groupMembers.profileId, input.profileId)))
      .where(and(eq(profiles.id, target.profileId), eq(profiles.type, 'group')))
      .for('key share', { of: groupMembers });
    const groups = new Set([...sharedInto.map((group) => group.groupId), ...grownInto.flatMap((group) => group.groupId ? [group.groupId] : [])]);
    for (const groupId of groups) {
      await enqueueGroupTopOfMindRefresh(input.profileId, groupId, "shares_changed", tx);
    }
  }

  if (row && target.profileId === input.profileId) await enqueueTopOfMindRefresh(input.profileId, 'manual', tx);
  return row ? serializeFeedback(row) : null;
}

export async function listFeedbackForProfile(
  db: WakaDb,
  input: ListFeedbackInput,
): Promise<FeedbackRecord[]> {
  const filters = [eq(feedback.profileId, input.profileId)];
  if (input.targetType) filters.push(eq(feedback.targetType, input.targetType));
  if (input.targetId) filters.push(eq(feedback.targetId, input.targetId));

  const rows = await db
    .select()
    .from(feedback)
    .where(and(...filters))
    .orderBy(desc(feedback.createdAt))
    .limit(input.limit);

  return rows.map(serializeFeedback);
}

/** Is the caller asking for entry state rather than filing a verdict? */
function asksForEntryState(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const value = (body as { value?: unknown }).value;
  return (
    typeof value === "string" && (ENTRY_STATE_VALUES as readonly string[]).includes(value)
  );
}

export function createFeedbackRoutes(
  deps: FeedbackRouteDependencies = {},
): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  const createFeedback = deps.createFeedback ?? createFeedbackForProfile;
  const listFeedback = deps.listFeedback ?? listFeedbackForProfile;

  routes.use("*", deps.authMiddleware ?? requireAuth);

  routes.post("/", async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }

    if (asksForEntryState(rawBody)) {
      return c.json({ error: ENTRY_STATE_MESSAGE }, 400);
    }

    const parsed = createFeedbackRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        {
          error: "Invalid feedback payload",
          details: validationDetails(parsed.error),
        },
        400,
      );
    }

    const session = c.get("session");
    let row: FeedbackRecord | null;
    try { row = await createFeedback(getDatabase(), {
      profileId: session.profile.id,
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId,
      value: parsed.data.value,
      ...(parsed.data.targetRevision ? { targetRevision: parsed.data.targetRevision } : {}),
      ...(parsed.data.correctionText
        ? { correctionText: parsed.data.correctionText }
        : {}),
    }); } catch (error) {
      const code = (error as { code?: string; cause?: { code?: string } }).code
        ?? (error as { cause?: { code?: string } }).cause?.code;
      if (error instanceof FeedbackTargetChangedError || code === '55P03' || code === '40P01') {
        return c.json({ error: 'This wording changed or is being updated. Read it again before responding.', code: 'feedback_target_changed' }, 409);
      }
      throw error;
    }

    if (!row) {
      return c.json({ error: "Feedback target not found" }, 404);
    }

    return c.json({ feedback: row }, 201);
  });

  routes.get("/", async (c) => {
    const parsedQuery = listFeedbackQuerySchema.safeParse(c.req.query());
    if (!parsedQuery.success) {
      return c.json(
        {
          error: "Invalid feedback query",
          details: validationDetails(parsedQuery.error),
        },
        400,
      );
    }

    const session = c.get("session");
    const rows = await listFeedback(getDatabase(), {
      profileId: session.profile.id,
      ...(parsedQuery.data.targetType ? { targetType: parsedQuery.data.targetType } : {}),
      ...(parsedQuery.data.targetId ? { targetId: parsedQuery.data.targetId } : {}),
      limit: parsedQuery.data.limit ?? DEFAULT_FEEDBACK_LIMIT,
    });

    return c.json({ feedback: rows });
  });

  return routes;
}

export const feedbackRoutes = createFeedbackRoutes();
