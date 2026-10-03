/**
 * Drizzle ORM schema — background jobs.
 *
 * Postgres is the queue. There is no broker: rows are claimed with a lock
 * timestamp, retried with backoff, and swept by a cron drain plus an
 * in-process tick. Keeping the queue in the same transaction-capable store
 * as the data means a job can never reference a row that was rolled back.
 *
 * Job types map to the three-layer pipeline:
 *   - enrich_attachment  : fetch a link's body / describe an image, cache it
 *   - derive_signals     : extract → embed → match-or-mint for one inspiration
 *   - review_signal_support : existing-claim checks after a statement edit
 *   - refresh_top_of_mind: re-synthesize a profile's artifact (debounced)
 *   - refresh_group_top_of_mind : the same for a group's shared signals
 *   - reembed_signal     : re-vector a statement its owner rewrote
 *
 * The last one is not pipeline work; it is here because it is model work. The
 * edit route used to embed inline, putting one Gemini call on the shared key
 * into every PATCH — a call nothing counted, on a route anyone with an account
 * can drive at HTTP speed. Everything that spends the key belongs on this
 * table, because this table is where the per-account budget can see it.
 */

import { relations, sql } from "drizzle-orm";
import {
  boolean,
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { profiles } from "./schema-profiles";

export const backgroundJobTypeValues = [
  "enrich_attachment",
  "derive_signals",
  "review_signal_support",
  "assess_signal_support",
  "refresh_top_of_mind",
  "refresh_group_top_of_mind",
  "refresh_principles",
  "reembed_signal",
  "tend_signal_garden",
  "generate_reflection_question",
] as const;
export type BackgroundJobType = (typeof backgroundJobTypeValues)[number];
export const backgroundJobTypeEnum = pgEnum("background_job_type", backgroundJobTypeValues);

export const backgroundJobStatusValues = ["pending", "running", "succeeded", "failed"] as const;
export type BackgroundJobStatus = (typeof backgroundJobStatusValues)[number];
export const backgroundJobStatusEnum = pgEnum(
  "background_job_status",
  backgroundJobStatusValues,
);

export interface EnrichAttachmentPayload {
  attachmentId: string;
  inspirationId: string;
}

export interface DeriveSignalsPayload {
  inspirationId: string;
  /** "created" on capture, "edited" when re-derivation follows an edit. */
  reason: "created" | "edited";
  /**
   * WHERE THE SIGNALS LAND (2026-08-24). Absent — the overwhelmingly common
   * case — they land on the inspiration's own profile, exactly as always.
   * Set, they land on a ROOM'S MIND: a public keep fans out one of these
   * jobs per room its keeper is in, the job still OWNED by the keeper's
   * profile so the model budget and queue fairness bill the person whose
   * keep asked for the work, with this field carrying the destination.
   */
  deriveIntoProfileId?: string;
}

export interface ReviewSignalSupportPayload {
  inspirationId: string;
  deriveIntoProfileId?: string;
}

export interface AssessSignalSupportPayload {
  inspirationId: string;
  deriveIntoProfileId?: string;
  signalIds: string[];
  materialRevision: string;
  materialHash: string;
  membershipId: string | null;
  statements: Array<{ id: string; revision: string; hash: string }>;
}

export interface RefreshTopOfMindPayload {
  /** Why the artifact is being reconsidered — recorded on the new version. */
  reason: "signals_changed" | "manual";
}

export interface RefreshGroupTopOfMindPayload {
  groupId: string;
  reason:
    | "shares_changed"
    | "membership_changed"
    | "proposal_accepted"
    | "signals_changed"
    | "manual";
}

export interface RefreshPrinciplesPayload {
  profileId: string;
}

/**
 * Deliberately just the id. The statement is read from the row when the job
 * runs, never carried here: an edit that lands while an earlier re-embedding
 * is still pending joins that row (same idempotency key) and its payload is
 * *not* rewritten, so a carried statement would be the first edit's wording —
 * and the vector would end up describing text nobody is looking at any more.
 */
export interface ReembedSignalPayload {
  signalId: string;
}

/** The answer that grounded this ask; the result is added to this payload by the worker. */
export interface GenerateReflectionQuestionPayload {
  inspirationId: string;
  afterReflectionId: string;
  contextHash?: string;
  question?: string;
}

export type BackgroundJobPayload =
  | EnrichAttachmentPayload
  | DeriveSignalsPayload
  | ReviewSignalSupportPayload
  | AssessSignalSupportPayload
  | RefreshTopOfMindPayload
  | RefreshGroupTopOfMindPayload
  | RefreshPrinciplesPayload
  | ReembedSignalPayload
  | GenerateReflectionQuestionPayload;

/** A result is not available until the final requested pass has completed. */
export interface BackgroundJobResult {
  kind: "top_of_mind";
  topOfMindId: string | null;
  version: number;
  outcome: "changed" | "unchanged" | "empty";
}

export const backgroundJobs = pgTable(
  "background_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),

    type: backgroundJobTypeEnum("type").notNull(),
    payload: jsonb("payload").$type<BackgroundJobPayload>().notNull(),
    result: jsonb("result").$type<BackgroundJobResult>(),
    /** Queue request identity, not a source revision or artifact version. */
    requestVersion: bigint("request_version", { mode: "bigint" }).notNull().default(sql`1`),
    completedVersion: bigint("completed_version", { mode: "bigint" }).notNull().default(sql`0`),
    status: backgroundJobStatusEnum("status").notNull().default("pending"),

    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),

    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastError: text("last_error"),

    /**
     * When this job most recently began running — and, unlike `locked_at`,
     * never cleared afterwards.
     *
     * It is the meter for the per-account model budget (lib/model-budget.ts).
     * The lock timestamp cannot serve: it is cleared the moment a job settles,
     * which is precisely when the spend it represents becomes history worth
     * counting. Keeping a separate column means the budget reads a fact about
     * what happened rather than inferring one from a lock that no longer
     * exists.
     *
     * A retry overwrites it, so a job attempted three times inside one window
     * is counted once rather than three times. That undercount is bounded by
     * `max_attempts` and by the backoff between attempts, and the alternative
     * — a second table logging every start — is a whole ledger to maintain,
     * reap, and back up for a correction of at most two.
     */
    startedAt: timestamp("started_at", { withTimezone: true }),

    /** Set to collapse duplicate enqueues of the same work. */
    idempotencyKey: text("idempotency_key"),

    /**
     * A request that arrived while this job was already running. The running
     * pass read its inputs before that request existed, so absorbing it would
     * lose the newer work — an inspiration edited mid-derivation would never
     * re-derive. Instead the enqueue sets this flag, and the worker turns a
     * flagged job back to `pending` on completion rather than `succeeded`.
     */
    rerunRequested: boolean("rerun_requested").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    requestVersionCheck: check("background_jobs_request_version_check", sql`${table.requestVersion} > 0 AND ${table.completedVersion} >= 0 AND ${table.completedVersion} <= ${table.requestVersion}`),
    runnableIdx: index("background_jobs_runnable_idx")
      .on(table.runAfter, table.createdAt)
      .where(sql`${table.status} = 'pending'`),
    profileStatusIdx: index("background_jobs_profile_status_idx").on(
      table.profileId,
      table.status,
    ),
    /**
     * The per-account budget asks "how much has this account started since T"
     * on the way to every claim, so it is the one query in the drain loop that
     * runs whether or not there is work to do. Profile first because the
     * account's profiles are what scope it.
     */
    profileStartedAtIdx: index("background_jobs_profile_started_at_idx").on(
      table.profileId,
      table.startedAt,
    ),
    idempotencyUnique: uniqueIndex("background_jobs_idempotency_key_unique_idx")
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    /**
     * At most one live artifact refresh per profile: the debounce that keeps
     * a burst of captures from paying for a burst of syntheses.
     */
    activeTopOfMindRefreshUnique: uniqueIndex("background_jobs_active_top_of_mind_idx")
      .on(table.profileId, table.type)
      .where(
        sql`${table.type} = 'refresh_top_of_mind'::background_job_type AND ${table.status} IN ('pending'::background_job_status, 'running'::background_job_status)`,
      ),
  }),
);

export type BackgroundJob = typeof backgroundJobs.$inferSelect;
export type NewBackgroundJob = typeof backgroundJobs.$inferInsert;

export const backgroundJobsRelations = relations(backgroundJobs, ({ one }) => ({
  profile: one(profiles, {
    fields: [backgroundJobs.profileId],
    references: [profiles.id],
  }),
}));
