/**
 * Postgres is the queue.
 *
 * There is no broker. Work is a row in `background_jobs`, claimed with an
 * atomic `UPDATE … FOR UPDATE SKIP LOCKED`, retried with exponential backoff,
 * and swept by two things: an in-process timer for the single-process case
 * (local dev, the monolith) and a cron-driven Lambda for the deployed case.
 *
 * Keeping the queue in the same transaction-capable store as the data is what
 * makes it correct: a job can never reference a row that was rolled back, and
 * an enqueue that participates in the caller's transaction is atomic with the
 * write that motivated it.
 *
 * Four mechanics carry the weight, and all four are worth keeping in mind
 * when changing anything here:
 *
 *   - **Idempotency keys.** A unique partial index on `idempotency_key`
 *     collapses duplicate enqueues of the same work into one row, so a route
 *     that fires on every save does not need to know whether it already did.
 *   - **Stale-lock reclaim.** A worker that dies mid-job leaves a `running`
 *     row locked. Anything locked longer than `STALE_LOCK_SECONDS` is
 *     claimable again — without it, one crashed Lambda strands the job.
 *   - **Backoff to a terminal state.** Attempts are counted at claim time;
 *     once they exceed `maxAttempts` the row becomes `failed` and stays put,
 *     with its sanitized error, rather than looping forever.
 *   - **A per-account model budget.** Every job type ends in a call against
 *     one shared Gemini key, and this loop used to drain strictly oldest-first
 *     regardless of whose work it was. An account past its rolling-hour budget
 *     has its due backlog pushed out by `run_after` — the same mechanism as
 *     retry backoff — and the loop moves on to somebody else's work instead of
 *     spending the key on one tenant. See lib/model-budget.ts for the rule.
 *
 * Four of the job types are the pipeline:
 *   enrich_attachment          → read what was saved (page body, image text)
 *   derive_signals             → extract → embed → match-or-mint (layer 2)
 *   refresh_top_of_mind        → re-synthesize a profile's artifact (layer 3)
 *   refresh_group_top_of_mind  → the same for a group's shared signals
 *
 * The fifth, `reembed_signal`, is here for the budget rather than for the
 * pipeline. It is the one model call a person's own request used to make
 * inline — the edit route re-embedding a rewritten statement — and a call made
 * inside a Hono handler is a call the drain never sees. The rule this file now
 * holds to is flat: if it spends the shared key, it is a row in this table.
 *
 *
 * WHAT IS WHERE
 *
 * The banner comments below are the file's table of contents, in this order:
 *
 *   Enqueue            putting work on the queue, and coalescing duplicates
 *   Drain scheduling   how something wakes up to take it
 *   Drain              the loop: peek, price the account, claim, run, settle
 *   The job router     what each of the five job types actually does
 *   Claim / complete   the SQL, including the predicate the loop depends on
 *   Small helpers      dates, backoff arithmetic, error sanitizing
 *
 *
 * WHY THIS FILE IS LONG, AND STAYS THAT WAY
 *
 * `docs/goals/a-codebase-you-can-navigate.md` asks every file over 800 lines
 * to either split or say plainly why it is one thing. This one is one thing.
 * That was measured before it was claimed, and here is the measurement.
 *
 * Enqueueing, the wake-up, the drain loop and the job router are not four
 * neighbours sharing a file. They are a closed loop: enqueueing schedules a
 * drain, the drain runs the router, and the router enqueues the next step —
 * which is what the generation pipeline *is*. A save becomes a signal becomes
 * a top of mind because each stage puts the following stage back on this
 * queue. Seven functions sit inside that loop: `enqueueKeyedJob`,
 * `enqueueDeriveSignals`, `enqueueTopOfMindRefresh`,
 * `scheduleBackgroundJobDrain`, `scheduleNextPendingBackgroundJobDrain`,
 * `drainBackgroundJobs` and `processBackgroundJob`. Any file boundary drawn
 * between them is an import cycle. That is not a style opinion; it is the
 * module graph saying the same thing this paragraph says.
 *
 * Three parts could move without a cycle — the SQL below, the payload
 * parsers, and the date and backoff helpers. Taking all three out lands this
 * file near 770 lines at the cost of a 52-line file and a 31-line file, and
 * the reason not to is the budget.
 *
 * The per-account budget is a guard, and what it guards is the claim. It
 * reads as policy in `drainBackgroundJobs` — peek the head, price the
 * account, defer or claim — but it is only *correct* because of three facts
 * that live in the SQL at the bottom of this file, and not one of the three
 * is expressed in a type:
 *
 *   1. `readBackgroundJobQueueHead` and `claimNextBackgroundJob` must choose
 *      the same row, and they do only because they share
 *      `runnableBackgroundJobPredicate` and `RUNNABLE_JOB_ORDER`. Were those
 *      to drift apart, the loop would price one account's budget and then run
 *      a different account's job, and nothing anywhere would fail.
 *   2. The meter the budget counts is `started_at`, and the only writer of it
 *      is the claim. A claim that stopped stamping it would leave every
 *      account reading zero spend forever: the cap would vanish in silence,
 *      with no compile error and no red test, because a test that substitutes
 *      the store never executes this SQL at all.
 *   3. Deferral moves `run_after`, and `run_after` is one arm of the runnable
 *      predicate. If the predicate stopped reading it, deferring would move
 *      nothing and the loop would spin on the same head forever.
 *
 * `BackgroundJobStore` looks like the seam to split on. It is not; it is a
 * test seam. Six method signatures, none of which can state any of the three
 * facts above. Putting the SQL behind it in a second file would leave the
 * guard here and the reasons it works one hop away, which is exactly how a
 * guard stops guarding without anyone noticing. This budget has already been
 * incomplete once: it shipped while `PATCH /api/signals/:id` still embedded
 * inline, one model call per request, on a route any account holder can drive
 * as fast as their connection allows — the door beside the metered one. That
 * is why `enqueueSignalReembed` exists and why
 * `routes/model-spend-stays-on-the-queue.test.ts` exists. A rule that has
 * been incomplete once is a rule to keep somewhere it can be read whole.
 *
 * One thing this file's length is NOT hiding: every database call it makes is
 * a single statement, so each is atomic on its own. The claim in particular
 * is one `UPDATE` whose `SELECT … FOR UPDATE SKIP LOCKED` is its own
 * subquery, so choosing the row, locking it, and marking it started cannot
 * come apart. The one gap that does exist is deliberate and documented at the
 * top of the drain loop: the head peek is a separate statement from the
 * claim, so two workers racing can let one over-budget job through per race.
 * Bounded, self-correcting on the next pass, and far cheaper than a lock
 * across the whole queue.
 *
 * If this file grows again, the thing to extract is the SQL — but only
 * together with the budget policy it serves, into one file that holds both.
 * Splitting the guard from the claim is the one move that must not be made.
 */

import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import {
  type BackgroundJob,
  type BackgroundJobResult,
  groupMembers,
  backgroundJobs,
  type BackgroundJobStatus,
  type DeriveSignalsPayload,
  type EnrichAttachmentPayload,
  type GenerateReflectionQuestionPayload,
  type ReembedSignalPayload,
  type RefreshGroupTopOfMindPayload,
  type RefreshTopOfMindPayload,
  profiles,
  inspirations,
  reflections,
  generationRevisions,
  attachments,
  signalEvidence,
} from "../db/index.js";
import { getDb } from "./db.js";
import { getDefaultModelProvider } from "./model-provider.js";
import {
  type AccountModelUsage,
  assessModelBudget,
  modelBudgetWindowStart,
} from "./model-budget.js";
import { enrichAttachment } from "./signal-enrichment.js";
import {
  describeSignalDerivation,
  deriveSignalsForInspiration,
  reembedSignal,
} from "./signal-derivation.js";
import { isSupportedLocale } from "./locales.js";
import { refreshPrinciplesForProfile } from "./principle-generation.js";
import { tendSignalGarden } from "./signal-gardener.js";
import {
  refreshTopOfMindForGroup,
  refreshTopOfMindForProfile,
  ShiftFloorHeldError,
} from "./top-of-mind-synthesis.js";

const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_ERROR_LENGTH = 1_000;
const STALE_LOCK_SECONDS = 15 * 60;

let drainScheduled = false;
let drainTimer: ReturnType<typeof setTimeout> | null = null;
let drainDueAt = 0;

export interface BackgroundJobSummary {
  id: string;
  type: BackgroundJob["type"];
  status: BackgroundJobStatus;
  payload: BackgroundJob["payload"];
  attempts: number;
  maxAttempts: number;
  runAfter: Date | string;
  lockedAt: Date | string | null;
  lastError: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface EnqueueResult {
  jobId: string;
  /**
   * False when an equivalent job was already waiting and this request joined
   * it. Callers surface it so a second "refresh" click can say the pass is
   * already coming rather than implying it started a new one.
   */
  created: boolean;
}

export interface DrainBackgroundJobsOptions {
  limit?: number;
  now?: Date;
  processor?: (job: BackgroundJob) => Promise<BackgroundJobResult | void>;
  /**
   * Where the loop reads and writes its rows. Defaults to Postgres; a test
   * hands it a queue it can hold in memory, which is what makes the budget
   * rule below observable at all — see `BackgroundJobStore`.
   */
  store?: BackgroundJobStore;
}

export interface DrainBackgroundJobsResult {
  claimed: number;
  succeeded: number;
  retried: number;
  failed: number;
  /**
   * Rows pushed past the head of the queue because their account had spent
   * its model budget. Deferred, never dropped: each one is still pending,
   * with a `run_after` naming the moment the window frees a slot.
   */
  deferred: number;
  /**
   * Jobs put back to sleep by a shift floor — the top of mind moves at most
   * once a day, and a refresh that arrived early sleeps until the floor
   * opens. Held, never failed: the attempt is handed back.
   */
  held: number;
}

/**
 * The head of the queue, read without claiming it.
 *
 * The budget is per account and a job is owned by a profile, so the account
 * has to be resolved before the decision can be made — and it has to be made
 * before the claim, or a job would be started (and charged) only to be put
 * back.
 */
export interface RunnableJobHead {
  jobId: string;
  accountId: string;
  /**
   * True when this head is a `running` row being reclaimed from a worker that
   * died rather than a `pending` row waiting its turn.
   *
   * The budget governs *starting* work, and a reclaim is finishing work whose
   * start was already gated and already counted. It also cannot be deferred:
   * `run_after` is not what makes a stale row claimable, so pushing it would
   * move nothing and leave the same head in place forever — one abandoned job
   * would stop the queue for every account on the deployment.
   */
  reclaimed: boolean;
}

export interface DeferAccountBacklogInput {
  accountId: string;
  /** When the budget frees a slot; becomes the rows' `run_after`. */
  until: Date;
  now: Date;
}

/**
 * Everything the drain loop asks its store for, in one place.
 *
 * This is a seam, not a portability layer: Postgres *is* the queue and there
 * will never be a second implementation in production. What it buys is a drain
 * loop that a unit test can run end to end against a queue it holds in memory.
 * The budget rule decides whether a person's work runs now or in an hour, and
 * a rule that has only ever executed against a live database is a rule nobody
 * has watched hold — the api unit suite runs on a bare checkout with no
 * database at all, so without this seam the cap would ship untested.
 */
export interface BackgroundJobStore {
  /** Whose work is next, without taking it. Null when nothing is runnable. */
  headOfQueue(now: Date): Promise<RunnableJobHead | null>;
  /** Take the next runnable job and mark it started. */
  claimNext(now: Date): Promise<BackgroundJob | null>;
  /** What this account has already started since `since`. */
  usageForAccount(accountId: string, since: Date): Promise<AccountModelUsage>;
  /** Push this account's due, unstarted work out to `until`. Returns rows moved. */
  deferAccountBacklog(input: DeferAccountBacklogInput): Promise<number>;
  markSucceeded(job: BackgroundJob, result: BackgroundJobResult | null): Promise<boolean>;
  markFailedOrPending(
    job: BackgroundJob,
    err: unknown,
    exhausted: boolean,
    now: Date,
  ): Promise<void>;
  /** Put a claimed job back to sleep until `until` — a hold, not a failure:
      the claim's attempt is handed back and no error is recorded. */
  holdJob(job: BackgroundJob, until: Date): Promise<void>;
}

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

/**
 * An idempotency key coalesces work that is *still in flight*. It does not
 * mean "this was done once, never again": a capture edited twice needs
 * distilling twice, and a job row that already succeeded is a record of the
 * previous edit, not a reason to skip the current one.
 *
 * Three cases, not two. A `pending` row is work not yet started, so a second
 * enqueue is the same work arriving twice and is absorbed — the debounce a
 * burst of saves depends on. A terminal row (`succeeded`/`failed`) means the
 * key now names new work, so it resets to pending with the fresh payload, a
 * cleared error, and a zeroed attempt count.
 *
 * A `running` row is the subtle one: the pass already read its inputs, so
 * absorbing a request that arrived after it started would lose that request
 * — the edit made mid-derivation would never re-derive. So a running row is
 * flagged `rerun_requested` instead, and the worker turns a flagged job back
 * to pending on completion. The trailing edge is kept, once, however many
 * enqueues land during the run.
 */
const TERMINAL_JOB_STATUS = sql`background_jobs.status IN ('succeeded'::background_job_status, 'failed'::background_job_status)`;
const RUNNING_JOB_STATUS = sql`background_jobs.status = 'running'::background_job_status`;

/**
 * One enqueue path for every keyed job type, so the ON CONFLICT clause and
 * the drain scheduling cannot drift between call sites.
 */
async function enqueueKeyedJob(input: {
  profileId: string;
  type:
    | "enrich_attachment"
    | "derive_signals"
    | "refresh_group_top_of_mind"
    | "refresh_principles"
    | "reembed_signal"
    | "tend_signal_garden"
    | "generate_reflection_question";
  payload:
    | EnrichAttachmentPayload
    | DeriveSignalsPayload
    | RefreshGroupTopOfMindPayload
    | { profileId: string }
    | ReembedSignalPayload
    | GenerateReflectionQuestionPayload;
  idempotencyKey: string;
}, transaction?: Pick<ReturnType<typeof getDb>, "execute">): Promise<EnqueueResult> {
  const rows = await (transaction ?? getDb()).execute(sql<{ id: string }>`
    INSERT INTO background_jobs (profile_id, type, payload, max_attempts, idempotency_key)
    VALUES (
      ${input.profileId}::uuid,
      ${input.type}::background_job_type,
      ${JSON.stringify(input.payload)}::jsonb,
      ${DEFAULT_MAX_ATTEMPTS},
      ${input.idempotencyKey}
    )
    ON CONFLICT (idempotency_key)
    WHERE idempotency_key IS NOT NULL
    DO UPDATE SET
      status = CASE
        WHEN ${TERMINAL_JOB_STATUS} THEN 'pending'::background_job_status
        ELSE background_jobs.status
      END,
      payload = CASE
        WHEN ${TERMINAL_JOB_STATUS} THEN EXCLUDED.payload
        ELSE background_jobs.payload
      END,
      attempts = CASE WHEN ${TERMINAL_JOB_STATUS} THEN 0 ELSE background_jobs.attempts END,
      run_after = CASE WHEN ${TERMINAL_JOB_STATUS} THEN now() ELSE background_jobs.run_after END,
      locked_at = CASE WHEN ${TERMINAL_JOB_STATUS} THEN NULL ELSE background_jobs.locked_at END,
      last_error = CASE WHEN ${TERMINAL_JOB_STATUS} THEN NULL ELSE background_jobs.last_error END,
      rerun_requested = CASE
        WHEN ${RUNNING_JOB_STATUS} THEN true
        WHEN ${TERMINAL_JOB_STATUS} THEN false
        ELSE background_jobs.rerun_requested
      END,
      max_attempts = GREATEST(background_jobs.max_attempts, EXCLUDED.max_attempts),
      updated_at = now()
    RETURNING id, (xmax = 0) AS created
  `);
  const [job] = rows as unknown as Array<{ id: string; created: boolean }>;
  if (!job) throw new Error(`Failed to enqueue ${input.type} job`);

  // A transaction caller persists atomically and leaves waking to the normal
  // post-commit worker tick. Never publish a wake for uncommitted job rows.
  if (!transaction) {
    if (shouldAutoDrainBackgroundJobs()) scheduleBackgroundJobDrain();
    else await wakeBackgroundWorker();
  }
  return { jobId: job.id, created: job.created };
}

/**
 * Principle generation keyed by eligible material, shared by the pipeline,
 * the page's missing-work request, and scheduled recovery. Completed keys
 * stay complete; failed keys require an explicit retry after worker retries.
 */
export async function enqueueRefreshPrinciples(
  profileId: string,
  materialKey: string,
  retry = false,
): Promise<EnqueueResult> {
  const key = `refresh_principles:${profileId}:${materialKey}`;
  const [target] = await getDb().select({ groupId: profiles.groupId }).from(profiles)
    .where(eq(profiles.id, profileId)).limit(1);
  const [member] = target?.groupId ? await getDb().select({ profileId: groupMembers.profileId })
    .from(groupMembers).where(eq(groupMembers.groupId, target.groupId))
    .orderBy(asc(groupMembers.profileId)).limit(1) : [];
  const ownerProfileId = target?.groupId ? member?.profileId : profileId;
  if (!ownerProfileId) throw new Error("No current member can request room principles");
  const rows = await getDb().execute(sql<{ id: string }>`
    INSERT INTO background_jobs (profile_id, type, payload, max_attempts, idempotency_key)
    VALUES (${ownerProfileId}::uuid, 'refresh_principles', ${JSON.stringify({ profileId })}::jsonb,
      ${DEFAULT_MAX_ATTEMPTS}, ${key})
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
    DO UPDATE SET status = 'pending', attempts = 0, locked_at = NULL,
      profile_id = EXCLUDED.profile_id,
      run_after = now(), last_error = NULL, updated_at = now()
    WHERE background_jobs.status = 'failed' AND ${retry}
    RETURNING id
  `);
  const [changed] = rows as unknown as Array<{ id: string }>;
  const [existing] = changed ? [changed] : await getDb().select({ id: backgroundJobs.id })
    .from(backgroundJobs).where(eq(backgroundJobs.idempotencyKey, key)).limit(1);
  if (!existing) throw new Error("Failed to enqueue principles");
  // Also wake an existing pending/stale job; claim-time locks bound retries.
  if (shouldAutoDrainBackgroundJobs()) scheduleBackgroundJobDrain();
  else await wakeBackgroundWorker();
  return { jobId: existing.id, created: Boolean(changed) };
}

/**
 * Read a link's page body or describe an image, so extraction can see what
 * the person saved and not only what they typed.
 *
 * Keyed on the attachment: an attachment is enriched once, and a second
 * enqueue for the same one is the same work.
 */
/**
 * The weekly garden pass for one profile — enqueued nightly beside the
 * principles cron, keyed per ISO week so six of the seven enqueues collapse
 * into the row already there.
 */
export async function enqueueTendSignalGarden(
  profileId: string,
  weekKey: string,
): Promise<EnqueueResult> {
  return enqueueKeyedJob({
    profileId,
    type: "tend_signal_garden",
    payload: { profileId },
    idempotencyKey: `tend_signal_garden:${profileId}:${weekKey}`,
  });
}

export async function enqueueEnrichAttachment(
  profileId: string,
  attachmentId: string,
  inspirationId: string,
  transaction?: Pick<ReturnType<typeof getDb>, "execute">,
): Promise<EnqueueResult> {
  return enqueueKeyedJob({
    profileId,
    type: "enrich_attachment",
    payload: { attachmentId, inspirationId },
    idempotencyKey: `enrich_attachment:${attachmentId}`,
  }, transaction);
}

/**
 * Distill one capture into signals.
 *
 * One live request per source/destination. A change arriving during work sets
 * rerun_requested, so creation and edits can coalesce without losing the tail.
 */
export async function enqueueDeriveSignals(
  profileId: string,
  inspirationId: string,
  reason: DeriveSignalsPayload["reason"],
  /** where the signals land when not on the inspiration's own profile — a
      room's mind; part of the key, or the personal pass and every room's
      pass over one capture would collapse into whichever enqueued first */
  deriveIntoProfileId?: string,
  transaction?: Pick<ReturnType<typeof getDb>, "execute">,
): Promise<EnqueueResult> {
  return enqueueKeyedJob({
    profileId,
    type: "derive_signals",
    payload: deriveIntoProfileId
      ? { inspirationId, reason, deriveIntoProfileId }
      : { inspirationId, reason },
    idempotencyKey: deriveIntoProfileId
      ? `derive_signals:${inspirationId}:${deriveIntoProfileId}`
      : `derive_signals:${inspirationId}`,
  }, transaction);
}

/**
 * Re-synthesize a profile's top of mind.
 *
 * Debounced by the database rather than by a key: a partial unique index
 * permits one pending-or-running refresh per profile, so a burst of captures
 * collapses into a single synthesis instead of paying for one per capture.
 * The conflict target below mirrors that index predicate exactly.
 */
export async function enqueueTopOfMindRefresh(
  profileId: string,
  reason: RefreshTopOfMindPayload["reason"],
  transaction?: Pick<ReturnType<typeof getDb>, "execute">,
): Promise<EnqueueResult> {
  const payload: RefreshTopOfMindPayload = { reason };
  const rows = await (transaction ?? getDb()).execute(sql<{ id: string }>`
    INSERT INTO background_jobs (profile_id, type, payload, max_attempts)
    VALUES (
      ${profileId}::uuid,
      'refresh_top_of_mind'::background_job_type,
      ${JSON.stringify(payload)}::jsonb,
      ${DEFAULT_MAX_ATTEMPTS}
    )
    ON CONFLICT (profile_id, type)
    WHERE type = 'refresh_top_of_mind'::background_job_type
      AND status IN ('pending'::background_job_status, 'running'::background_job_status)
    DO UPDATE SET
      -- Landing on a running refresh means the signals changed after it began
      -- reading them; flag a re-run so the artifact reflects the change rather
      -- than staying stale until some unrelated later event.
      rerun_requested = CASE WHEN ${RUNNING_JOB_STATUS} THEN true ELSE background_jobs.rerun_requested END,
      payload = CASE
        WHEN ${RUNNING_JOB_STATUS} AND NOT background_jobs.rerun_requested THEN EXCLUDED.payload
        WHEN EXCLUDED.payload->>'reason' = 'manual' THEN EXCLUDED.payload
        ELSE background_jobs.payload
      END,
      run_after = CASE WHEN EXCLUDED.payload->>'reason' = 'manual'
        THEN LEAST(background_jobs.run_after, now()) ELSE background_jobs.run_after END,
      result = NULL,
      updated_at = now()
    RETURNING id, (xmax = 0) AS created
  `);
  const [job] = rows as unknown as Array<{ id: string; created: boolean }>;
  if (!job) throw new Error("Failed to enqueue refresh_top_of_mind job");

  if (!transaction) {
    if (shouldAutoDrainBackgroundJobs()) scheduleBackgroundJobDrain();
    else await wakeBackgroundWorker();
  }
  return { jobId: job.id, created: job.created };
}

/**
 * Re-synthesize a group's top of mind from the signals its members share.
 *
 * Keyed on the group rather than on the group and the reason: whatever moved
 * — a new share, a member joining, an accepted proposal — the work is the
 * same single pass over that group's current shared set, and a live job for
 * it already covers a second request.
 *
 * The owning profile is the member whose action prompted the pass. It is the
 * job's tenant for audit and cleanup; the synthesis itself reads the group.
 */
export async function enqueueGroupTopOfMindRefresh(
  profileId: string,
  groupId: string,
  reason: RefreshGroupTopOfMindPayload["reason"],
  transaction?: Pick<ReturnType<typeof getDb>, "execute">,
): Promise<EnqueueResult> {
  return enqueueKeyedJob({
    profileId,
    type: "refresh_group_top_of_mind",
    payload: { groupId, reason },
    idempotencyKey: `refresh_group_top_of_mind:${groupId}`,
  }, transaction);
}

/** One generated follow-up per saved answer, even across repeated opens. */
export function reflectionQuestionJobKey(profileId: string, inspirationId: string, afterReflectionId: string): string {
  return `generate_reflection_question:${profileId}:${inspirationId}:${afterReflectionId}`;
}

export async function enqueueReflectionQuestion(
  profileId: string,
  inspirationId: string,
  afterReflectionId: string,
): Promise<EnqueueResult> {
  return enqueueKeyedJob({
    profileId,
    type: "generate_reflection_question",
    payload: { inspirationId, afterReflectionId },
    idempotencyKey: reflectionQuestionJobKey(profileId, inspirationId, afterReflectionId),
  });
}

/**
 * Re-vector a statement its owner rewrote.
 *
 * This is here because embedding costs a call on the shared key, and the edit
 * route used to make that call itself, inside the request. Everything else in
 * the pipeline was already metered by the drain's per-account budget; an edit
 * was not, so PATCHing a statement in a loop spent the key at HTTP speed while
 * the queue politely waited its turn. Enqueuing costs nothing and the drain
 * decides when — and whether this hour — the call is affordable.
 *
 * Keyed on the signal, so editing the same statement five times while the job
 * waits is one re-embedding of the final wording rather than five of the
 * intermediate ones. A signal belongs to exactly one profile, so the owner
 * this row is charged to cannot change under the conflict clause.
 */
export async function enqueueSignalReembed(
  profileId: string,
  signalId: string,
): Promise<EnqueueResult> {
  return enqueueKeyedJob({
    profileId,
    type: "reembed_signal",
    payload: { signalId },
    idempotencyKey: `reembed_signal:${signalId}`,
  });
}

// ---------------------------------------------------------------------------
// Drain scheduling
// ---------------------------------------------------------------------------

/**
 * The in-process drain is for processes that stay alive. Under vitest it
 * would leave timers running past the test that created them, and on Lambda
 * the container is frozen the moment the response is returned, so the timer
 * fires late or never — there, the worker is woken directly instead.
 */
function shouldAutoDrainBackgroundJobs(): boolean {
  if (process.env.WAKA_BACKGROUND_JOB_AUTODRAIN === "1") return true;
  if (process.env.WAKA_BACKGROUND_JOB_AUTODRAIN === "0") return false;
  return process.env.NODE_ENV !== "test" && !process.env.AWS_LAMBDA_FUNCTION_NAME;
}

/** Call only after the data/job transaction commits. Wake failure cannot
 * turn a successful save into a retry; the durable job remains recoverable. */
export async function wakeCommittedBackgroundJobs(): Promise<void> {
  if (shouldAutoDrainBackgroundJobs()) scheduleBackgroundJobDrain();
  else await wakeBackgroundWorker();
}

/**
 * True when this process *is* the background worker. The worker enqueues as
 * it goes — a finished derivation asks for a synthesis — and a worker that
 * woke itself for that would start a fresh invocation per job, chaining
 * indefinitely. Its own drain loop picks the work up instead.
 */
function isBackgroundWorkerProcess(): boolean {
  const self = process.env.AWS_LAMBDA_FUNCTION_NAME;
  const worker = process.env.WAKA_BACKGROUND_WORKER_FUNCTION;
  return Boolean(self && worker && self === worker);
}

/**
 * Wake the worker for freshly-enqueued work.
 *
 * `InvocationType: "Event"` hands the invocation to Lambda and returns; the
 * worker runs on its own clock, so a capture's response is not waiting on
 * extraction. It *is* awaited, briefly, because the calling container freezes
 * the moment it responds — an un-awaited request might never leave.
 *
 * Failure is survivable by construction: the job is already committed to
 * Postgres, so a wake-up that never lands costs latency (until the daily
 * sweep) and never work. That is why this can never throw into a user's write.
 */
async function wakeBackgroundWorker(): Promise<void> {
  const functionName = process.env.WAKA_BACKGROUND_WORKER_FUNCTION;
  if (!functionName || isBackgroundWorkerProcess()) return;

  try {
    const { InvokeCommand, LambdaClient } = await import("@aws-sdk/client-lambda");
    lambdaClient ??= new LambdaClient({});
    await lambdaClient.send(
      new InvokeCommand({ FunctionName: functionName, InvocationType: "Event" }),
    );
  } catch (err) {
    console.warn("[background-jobs] could not wake the worker; the sweep will catch it", {
      error: sanitizeError(err),
    });
  }
}

/** Reused across invocations of a warm container. */
let lambdaClient: import("@aws-sdk/client-lambda").LambdaClient | null = null;

export function scheduleBackgroundJobDrain(delayMs = 0): void {
  const normalizedDelay = Math.max(0, Math.trunc(delayMs));
  const dueAt = Date.now() + normalizedDelay;
  if (drainScheduled && drainDueAt <= dueAt) return;
  if (drainTimer) clearTimeout(drainTimer);
  drainScheduled = true;
  drainDueAt = dueAt;
  drainTimer = setTimeout(() => {
    drainScheduled = false;
    drainTimer = null;
    drainDueAt = 0;
    drainBackgroundJobs().catch((err) => {
      console.error("[background-jobs] drain tick failed", { error: sanitizeError(err) });
    });
  }, normalizedDelay);
}

/**
 * Derive the next local wake-up from Postgres rather than from the batch that
 * happened to run. That preserves both cases at once: a ready eleventh job is
 * drained immediately, while a job that just failed stays scheduled for its
 * backoff even when the batch was full.
 */
async function scheduleNextPendingBackgroundJobDrain(): Promise<void> {
  const [next] = await getDb()
    .select({ runAfter: backgroundJobs.runAfter })
    .from(backgroundJobs)
    .where(eq(backgroundJobs.status, "pending"))
    .orderBy(asc(backgroundJobs.runAfter))
    .limit(1);
  if (!next) return;
  const runAfter = coerceDate(next.runAfter);
  scheduleBackgroundJobDrain(Math.max(0, runAfter.getTime() - Date.now() + 25));
}

// ---------------------------------------------------------------------------
// Drain
// ---------------------------------------------------------------------------

/**
 * How many accounts one drain will step over before giving up.
 *
 * Each deferral moves an entire account's due backlog out of the way in one
 * statement, so the loop normally needs at most one per over-budget account
 * and then reaches somebody who can run. The ceiling is for the case that
 * cannot be reasoned about locally: another worker enqueuing while this one
 * defers, which could otherwise keep handing this loop a fresh over-budget
 * head forever. Stopping is safe — the rows are pending with a `run_after`,
 * and the next wake-up starts from a queue that has already moved.
 */
const MAX_BUDGET_DEFERRALS_PER_DRAIN = 25;

export async function drainBackgroundJobs(
  options: DrainBackgroundJobsOptions = {},
): Promise<DrainBackgroundJobsResult> {
  const limit = Math.max(0, Math.min(Math.trunc(options.limit ?? 10), 100));
  const store = options.store ?? postgresBackgroundJobStore;
  // Read the clock per step rather than once: an injected `now` pins the whole
  // drain for a test, while a live drain whose jobs each take a model call
  // must not do its stale-lock arithmetic against a clock from ten minutes ago.
  const clock = () => options.now ?? new Date();
  const result: DrainBackgroundJobsResult = {
    claimed: 0,
    held: 0,
    succeeded: 0,
    retried: 0,
    failed: 0,
    deferred: 0,
  };

  let deferrals = 0;
  let processed = 0;
  while (processed < limit) {
    const now = clock();

    /*
     * Ask whose job is next before taking it.
     *
     * The order matters. Claiming first and putting the job back if the
     * account is over budget would mean recording a start that never spent
     * anything, and the budget is measured in starts — an account would be
     * charged for the deferrals themselves and never recover. So the head is
     * read, the account decided on, and only then is the row taken.
     *
     * The read costs one indexed query per drained job on top of the claim.
     * Against a job whose body is a multi-second call to Gemini that is noise,
     * and it is what keeps the decision honest.
     *
     * Two workers racing here can each peek the same head and then claim
     * different rows, so one job belonging to an over-budget account may slip
     * through per race. It is bounded by one job per worker per iteration and
     * corrected on the next pass; the alternative is a lock across the whole
     * queue, which is the thing SKIP LOCKED exists to avoid.
     */
    const head = await store.headOfQueue(now);
    if (!head) break;

    if (!head.reclaimed) {
      const usage = await store.usageForAccount(head.accountId, modelBudgetWindowStart(now));
      const verdict = assessModelBudget(usage, now);
      if (!verdict.withinBudget) {
        if (deferrals >= MAX_BUDGET_DEFERRALS_PER_DRAIN) break;
        deferrals += 1;

        // The whole due backlog, not just the head: deferring one row at a
        // time would step through ten thousand of them before reaching the
        // next account, which is the starvation this is here to end.
        const moved = await store.deferAccountBacklog({
          accountId: head.accountId,
          until: verdict.retryAfter,
          now,
        });
        result.deferred += moved;
        console.log("[background-jobs] account is over its model budget; deferred", {
          accountId: head.accountId,
          startedInWindow: usage.startedInWindow,
          deferred: moved,
          retryAfter: verdict.retryAfter.toISOString(),
        });
        continue;
      }
    }

    const job = await store.claimNext(now);
    if (!job) break;
    processed += 1;
    result.claimed += 1;

    try {
      const completion = await (options.processor ?? processBackgroundJob)(job);
      if (await store.markSucceeded(job, completion ?? null)) result.succeeded += 1;
    } catch (err) {
      if (err instanceof ShiftFloorHeldError) {
        await store.holdJob(job, err.heldUntil);
        result.held += 1;
        console.log("[background-jobs] shift floor holds; refresh sleeps", {
          jobId: job.id,
          profileId: job.profileId,
          heldUntil: err.heldUntil.toISOString(),
        });
        continue;
      }
      const exhausted = job.attempts >= job.maxAttempts;
      await store.markFailedOrPending(job, err, exhausted, clock());
      if (exhausted) result.failed += 1;
      else result.retried += 1;
    }
  }

  if (shouldAutoDrainBackgroundJobs()) {
    await scheduleNextPendingBackgroundJobDrain();
  }

  return result;
}

/** The cron entry point. Named separately so the Lambda reads as a worker. */
export async function runBackgroundJobWorker(
  options: DrainBackgroundJobsOptions = {},
): Promise<DrainBackgroundJobsResult> {
  return drainBackgroundJobs(options);
}

// ---------------------------------------------------------------------------
// The job router
// ---------------------------------------------------------------------------

/** Settlement fencing alone is too late: a reclaimed worker must not write
 * an artifact first and only discover its lost claim when marking success. */
async function assertBackgroundJobOwnership(tx: Pick<ReturnType<typeof getDb>, "select">, job: BackgroundJob, noWait = false) {
  const lockedAt = coerceNullableDate(job.lockedAt);
  if (!lockedAt) throw new Error("Background job ownership changed before commit");
  if (noWait) {
    // Mutation triggers advance revisions before source routes enqueue work.
    // Taking the job first and then waiting for such a revision would invert
    // that order. Lock every revision this stage may write before its claim;
    // a busy human transaction wins instead of becoming a deadlock victim.
    const owners = new Set([job.profileId]);
    if (job.type === "derive_signals") {
      const destination = readString(job.payload, "deriveIntoProfileId");
      if (destination) owners.add(destination);
    }
    if (job.type === "enrich_attachment") {
      const inspirationId = readString(job.payload, "inspirationId");
      if (inspirationId) {
        const destinations = await tx.select({ profileId: signalEvidence.profileId }).from(signalEvidence)
          .where(and(eq(signalEvidence.ownerProfileId, job.profileId), eq(signalEvidence.inspirationId, inspirationId)));
        for (const row of destinations) owners.add(row.profileId);
      }
    }
    await tx.select({ id: generationRevisions.profileId }).from(generationRevisions)
      .where(inArray(generationRevisions.profileId, [...owners])).orderBy(asc(generationRevisions.profileId))
      .for("update", { noWait: true });
  }
  const [owned] = await tx.select({ id: backgroundJobs.id }).from(backgroundJobs)
    .where(and(eq(backgroundJobs.id, job.id), eq(backgroundJobs.profileId, job.profileId),
      eq(backgroundJobs.type, job.type), eq(backgroundJobs.status, "running"),
      eq(backgroundJobs.lockedAt, lockedAt), eq(backgroundJobs.attempts, job.attempts))).for("update", noWait ? { noWait: true } : {});
  if (!owned) throw new Error("Background job ownership changed before commit");
}

/** Only the context the question actually consumes. Unrelated signal/reading
 * work must not spend another model call by invalidating a good follow-up. */
async function loadReflectionQuestionContext(db: Pick<ReturnType<typeof getDb>, "select">, profileId: string, inspirationId: string) {
  const [parent, profile, recent] = await Promise.all([
    db.select({ text: inspirations.text }).from(inspirations)
      .where(and(eq(inspirations.id, inspirationId), eq(inspirations.profileId, profileId))).limit(1),
    db.select({ preferredLocale: profiles.preferredLocale }).from(profiles)
      .where(eq(profiles.id, profileId)).limit(1),
    db.select({ id: reflections.id, question: reflections.question, answer: reflections.answer })
      .from(reflections).where(and(eq(reflections.inspirationId, inspirationId),
        eq(reflections.profileId, profileId), eq(reflections.skipped, false), isNotNull(reflections.answer)))
      .orderBy(desc(reflections.createdAt), desc(reflections.id)).limit(6),
  ]);
  if (!parent[0] || !profile[0]) return null;
  return { latestId: recent[0]?.id, input: {
    preferredLocale: isSupportedLocale(profile[0].preferredLocale) ? profile[0].preferredLocale : "en-US" as const,
    inspirationText: parent[0].text,
    reflections: [...recent].reverse().map((row) => ({ question: row.question, answer: row.answer ?? "" })),
  } };
}

export async function processBackgroundJob(job: BackgroundJob): Promise<BackgroundJobResult | void> {
  switch (job.type) {
    case "generate_reflection_question": {
      const payload = parseGenerateReflectionQuestionPayload(job.payload);
      if (!payload) return dropPoisonPayload(job);
      const db = getDb();
      const context = await loadReflectionQuestionContext(db, job.profileId, payload.inspirationId);
      if (!context || context.latestId !== payload.afterReflectionId) return dropPoisonPayload(job);
      const provider = await getDefaultModelProvider();
      const result = await provider.askReflectionQuestion(context.input);
      await db.transaction(async (tx) => {
        // Source/answer/locale mutation triggers take this same row before
        // committing. Re-read after the lock under READ COMMITTED, so the
        // question is tied to one current context without locking across AI.
        const [owner] = await tx.select({ id: generationRevisions.profileId }).from(generationRevisions)
          .where(eq(generationRevisions.profileId, job.profileId)).for("update");
        if (!owner || JSON.stringify(await loadReflectionQuestionContext(tx, job.profileId, payload.inspirationId)) !== JSON.stringify(context)) {
          throw new Error("Reflection question inputs changed before commit");
        }
        // Source edits can already hold the job row while redacting its old
        // payload. Do not wait back on that human transaction and deadlock it.
        await assertBackgroundJobOwnership(tx, job, true);
        await tx.update(backgroundJobs).set({ payload: { ...payload, question: result.question } })
          .where(and(eq(backgroundJobs.id, job.id), eq(backgroundJobs.profileId, job.profileId)));
      });
      return;
    }
    case "refresh_principles": {
      const profileId = readString(job.payload, "profileId") ?? job.profileId;
      if (profileId !== job.profileId) {
        const groupId = await groupIdOfMind(profileId);
        if (!groupId) return dropPoisonPayload(job);
        const [member] = await getDb().select({ id: groupMembers.id }).from(groupMembers)
          .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.profileId, job.profileId))).limit(1);
        if (!member) throw new Error("Room principles require a current member");
      }
      await refreshPrinciplesForProfile({ profileId }, { beforeCommit: (tx) => assertBackgroundJobOwnership(tx, job) });
      return;
    }
    case "enrich_attachment": {
      const payload = parseEnrichAttachmentPayload(job.payload);
      if (!payload) return dropPoisonPayload(job);

      const [source] = await getDb().select({ id: attachments.id }).from(attachments)
        .where(and(eq(attachments.id, payload.attachmentId), eq(attachments.profileId, job.profileId),
          eq(attachments.inspirationId, payload.inspirationId))).limit(1);
      if (!source) return dropPoisonPayload(job);
      const enrichment = await enrichAttachment(payload.attachmentId, {
        beforeCommit: (tx) => assertBackgroundJobOwnership(tx, job, true),
      });

      // A login wall or an unreadable page is an ordinary outcome. Source
      // races and failed transactional handoffs throw for retry. Among
      // ordinary fetch verdicts, one is worth another attempt:
      // `failed` means the page was never reached. Throwing here is what
      // hands that case to the backoff already built into the drain — without
      // it, one timed-out fetch leaves the attachment unenriched forever and
      // the job row claims it succeeded.
      if (enrichment.status === "failed") {
        throw new Error(
          `Attachment enrichment failed for ${payload.attachmentId}: ${enrichment.reason}`,
        );
      }

      // The enrichment writer already committed scope-correct derivation
      // requests with the new cached material. Missing parents need no job.
      return;
    }

    case "derive_signals": {
      const payload = parseDeriveSignalsPayload(job.payload);
      if (!payload) return dropPoisonPayload(job);

      const [source] = await getDb().select({ id: inspirations.id }).from(inspirations)
        .where(and(eq(inspirations.id, payload.inspirationId), eq(inspirations.profileId, job.profileId))).limit(1);
      if (!source) return dropPoisonPayload(job);
      const result = await deriveSignalsForInspiration(payload, {
        beforeCommit: (tx) => assertBackgroundJobOwnership(tx, job, true),
      });
      if (result.supportReview?.retryable) {
        throw new Error("Existing support could not be fully assessed; retry current material");
      }
      console.log("[background-jobs] derived signals", {
        jobId: job.id,
        inspirationId: payload.inspirationId,
        summary: describeSignalDerivation(result),
      });

      // Changed evidence and its reading request were committed together.
      return;
    }

    case "refresh_top_of_mind": {
      const payload = parseRefreshTopOfMindPayload(job.payload);
      if (!payload) return dropPoisonPayload(job);

      const result = await refreshTopOfMindForProfile({
        profileId: job.profileId,
        reason: payload.reason,
      }, { beforeCommit: (tx) => assertBackgroundJobOwnership(tx, job) });
      console.log("[background-jobs] refreshed top of mind", {
        jobId: job.id,
        profileId: job.profileId,
        status: result.status,
        version: result.version,
        reason: result.reason,
        entryCount: result.entryCount,
      });
      await (await import("./principle-status.js")).requestPrincipleRefresh(getDb(), job.profileId);
      return {
        kind: "top_of_mind", topOfMindId: result.topOfMindId, version: result.version,
        outcome: result.entryCount === 0 ? "empty"
          : result.reason === "no_change" ? "unchanged" : "changed",
      };
    }

    case "refresh_group_top_of_mind": {
      const payload = parseRefreshGroupTopOfMindPayload(job.payload);
      if (!payload) return dropPoisonPayload(job);

      await refreshTopOfMindForGroup({
        groupId: payload.groupId,
        reason: payload.reason,
      }, { beforeCommit: (tx) => assertBackgroundJobOwnership(tx, job) });
      const [mind] = await getDb().select({ id: profiles.id }).from(profiles)
        .where(and(eq(profiles.groupId, payload.groupId), eq(profiles.type, "group"))).limit(1);
      if (mind) await (await import("./principle-status.js")).requestPrincipleRefresh(getDb(), mind.id);
      return;
    }

    case "reembed_signal": {
      const payload = parseReembedSignalPayload(job.payload);
      if (!payload) return dropPoisonPayload(job);

      // Scoped by the job's own profile, not by the payload alone: the row's
      // `profile_id` is written by the route from the resolved session scope,
      // so an id that arrived in a payload can never reach another tenant's
      // signal even if a payload were ever forged.
      await reembedSignal({ profileId: job.profileId, signalId: payload.signalId }, {
        beforeCommit: (tx) => assertBackgroundJobOwnership(tx, job, true),
      });
      return;
    }

    case "tend_signal_garden": {
      const [profileRow] = await getDb()
        .select({ preferredLocale: profiles.preferredLocale })
        .from(profiles)
        .where(eq(profiles.id, job.profileId))
        .limit(1);
      const summary = await tendSignalGarden(getDb(), {
        profileId: job.profileId,
        beforeCommit: (tx) => assertBackgroundJobOwnership(tx, job, true),
        preferredLocale: isSupportedLocale(profileRow?.preferredLocale)
          ? profileRow.preferredLocale
          : "en-US",
      });
      console.log("[background-jobs] tended the signal garden", {
        jobId: job.id,
        profileId: job.profileId,
        ...summary,
      });
      return;
    }

    default: {
      // Exhaustive over the enum: adding a job type without a branch is a
      // compile error rather than a runtime surprise on a Friday.
      const unhandled: never = job.type;
      throw new Error(`Unsupported background job type: ${String(unhandled)}`);
    }
  }
}

/**
 * A payload that cannot be parsed will not parse on retry either. Marking the
 * job succeeded stops the loop; the sanitized warning is what makes the drop
 * visible.
 */
function dropPoisonPayload(job: BackgroundJob): void {
  console.warn("[background-jobs] dropping malformed job payload", {
    jobId: job.id,
    type: job.type,
  });
}

function readString(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>)[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseEnrichAttachmentPayload(payload: unknown): EnrichAttachmentPayload | null {
  const attachmentId = readString(payload, "attachmentId");
  const inspirationId = readString(payload, "inspirationId");
  if (!attachmentId || !inspirationId) return null;
  return { attachmentId, inspirationId };
}

function parseGenerateReflectionQuestionPayload(payload: unknown): GenerateReflectionQuestionPayload | null {
  const inspirationId = readString(payload, "inspirationId");
  const afterReflectionId = readString(payload, "afterReflectionId");
  if (!inspirationId || !afterReflectionId) return null;
  return { inspirationId, afterReflectionId };
}

/**
 * Which room a mind profile belongs to. Read at most once per room-derive
 * job, to route the synthesis that follows it; null for a profile that is
 * not a mind (a poisoned payload rather than a crash).
 */
async function groupIdOfMind(profileId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ groupId: profiles.groupId })
    .from(profiles)
    .where(and(eq(profiles.id, profileId), eq(profiles.type, "group")))
    .limit(1);
  return row?.groupId ?? null;
}

function parseDeriveSignalsPayload(payload: unknown): DeriveSignalsPayload | null {
  const inspirationId = readString(payload, "inspirationId");
  const reason = readString(payload, "reason");
  if (!inspirationId) return null;
  if (reason !== "created" && reason !== "edited") return null;
  const deriveIntoProfileId = readString(payload, "deriveIntoProfileId");
  return deriveIntoProfileId
    ? { inspirationId, reason, deriveIntoProfileId }
    : { inspirationId, reason };
}

function parseRefreshTopOfMindPayload(payload: unknown): RefreshTopOfMindPayload | null {
  const reason = readString(payload, "reason");
  if (reason !== "signals_changed" && reason !== "manual") return null;
  return { reason };
}

function parseReembedSignalPayload(payload: unknown): ReembedSignalPayload | null {
  const signalId = readString(payload, "signalId");
  if (!signalId) return null;
  return { signalId };
}

function parseRefreshGroupTopOfMindPayload(
  payload: unknown,
): RefreshGroupTopOfMindPayload | null {
  const groupId = readString(payload, "groupId");
  const reason = readString(payload, "reason");
  if (!groupId) return null;
  if (
    reason !== "shares_changed" &&
    reason !== "membership_changed" &&
    reason !== "proposal_accepted" &&
    reason !== "signals_changed" &&
    reason !== "manual"
  ) {
    return null;
  }
  return { groupId, reason };
}

// ---------------------------------------------------------------------------
// Claim / complete
// ---------------------------------------------------------------------------

/**
 * What "runnable right now" means, written once.
 *
 * Two readers need it — the head peek that decides whose budget to check, and
 * the claim that takes the row — and a peek that disagreed with the claim
 * would check one account's budget and then run another account's job. Sharing
 * the fragment is what makes that impossible rather than merely unlikely. Both
 * readers alias the table `candidate` so the fragment drops into either.
 *
 * Parenthesized as a whole because it is an OR being pasted into somebody
 * else's WHERE: the day a caller adds one AND beside it, unparenthesized
 * precedence would quietly claim rows that are not runnable.
 */
function runnableBackgroundJobPredicate(nowIso: string) {
  return sql`
    (
      (
        candidate.status = 'pending'::background_job_status
        AND candidate.run_after <= ${nowIso}::timestamptz
      )
      OR (
        candidate.status = 'running'::background_job_status
        AND candidate.locked_at < ${nowIso}::timestamptz - (${STALE_LOCK_SECONDS} || ' seconds')::interval
        -- A job that crashes the worker (rather than throwing) never runs
        -- its own failure path, so only the reclaim bounds it. Without this
        -- ceiling a poison job is reclaimed every stale-lock interval
        -- forever; with it, a job that has already been attempted its full
        -- budget is left where it is rather than taking the worker down again.
        AND candidate.attempts < candidate.max_attempts
      )
    )
  `;
}

/**
 * The runnable rows, RANKED FAIRLY BY KIND — the one ordering both readers
 * share, written once for the same reason the predicate is.
 *
 * `last_started` is when a row's own (profile, kind) line last got a turn —
 * read off `started_at`, the meter the claim stamps and never clears, so
 * the fairness carries across claims instead of recomputing itself away: a
 * snapshot rank (first-of-each-kind first) looked right and was not,
 * because the moment a derivation is claimed the NEXT derivation becomes
 * first-of-its-kind again and the lone enrichment never surfaces. Ordering
 * by longest-unserved kind first is a genuine round-robin: claim a
 * derivation and that whole line steps behind the enrichment that has
 * never run. Measured live on 2026-08-23: two hundred and five bulk
 * derivations starved two enrichment jobs for the account's whole budget
 * window, indistinguishable from breakage. Within one kind, oldest due
 * first, then oldest made, exactly as before; the per-account budget's
 * totals are untouched — fairness decides only WHICH due job spends the
 * budget next.
 */
function rankedRunnableJobs(nowIso: string) {
  return sql`
    SELECT
      candidate.id,
      candidate.profile_id,
      (candidate.status = 'running'::background_job_status) AS reclaimed,
      turn.last_started,
      candidate.run_after,
      candidate.created_at
    FROM background_jobs AS candidate
    LEFT JOIN (
      SELECT prior.profile_id, prior.type, max(prior.started_at) AS last_started
      FROM background_jobs AS prior
      GROUP BY prior.profile_id, prior.type
    ) AS turn
      ON turn.profile_id = candidate.profile_id AND turn.type = candidate.type
    WHERE ${runnableBackgroundJobPredicate(nowIso)}
  `;
}

/** The same order the claim takes rows in: longest-unserved kind first
    (never-served first of all), then oldest due, then oldest made. */
const RUNNABLE_JOB_ORDER = sql`ORDER BY fair.last_started ASC NULLS FIRST, fair.run_after ASC, fair.created_at ASC`;

/**
 * Read the head of the queue and whose account owns it, taking nothing.
 *
 * The join is to `profiles` because jobs are owned by a profile and the budget
 * is per account — an account holds its human profile and its agents, and a
 * cap that counted per profile would be lifted by creating another agent.
 */
async function readBackgroundJobQueueHead(now: Date): Promise<RunnableJobHead | null> {
  const nowIso = now.toISOString();
  const rows = await getDb().execute(sql<RunnableJobHead>`
    SELECT
      fair.id AS "jobId",
      profile.account_id AS "accountId",
      fair.reclaimed AS "reclaimed"
    FROM (${rankedRunnableJobs(nowIso)}) AS fair
    JOIN profiles AS profile ON profile.id = fair.profile_id
    ${RUNNABLE_JOB_ORDER}
    LIMIT 1
  `);

  const result = rows as unknown as RunnableJobHead[];
  return result[0] ?? null;
}

/**
 * How much of the shared key this account has spent since `since`.
 *
 * Counted across every profile the account owns, and over `started_at` rather
 * than `created_at`: what costs the key is a job running, not a job being
 * asked for. A thousand enqueues that are still waiting have spent nothing.
 */
async function readAccountModelUsage(
  accountId: string,
  since: Date,
): Promise<AccountModelUsage> {
  const rows = await getDb().execute(sql<{ started: number; oldest: Date | null }>`
    SELECT
      count(*)::int AS started,
      min(job.started_at) AS oldest
    FROM background_jobs AS job
    JOIN profiles AS profile ON profile.id = job.profile_id
    WHERE profile.account_id = ${accountId}::uuid
      AND job.started_at >= ${since.toISOString()}::timestamptz
  `);

  const [row] = rows as unknown as Array<{ started: number | string; oldest: Date | string | null }>;
  if (!row) return { startedInWindow: 0, oldestStartInWindow: null };
  return {
    startedInWindow: Number(row.started ?? 0),
    oldestStartInWindow: coerceNullableDate(row.oldest),
  };
}

/**
 * Push an over-budget account's due work out to the moment its window frees.
 *
 * `run_after` is deliberately the only thing touched. It is what retry backoff
 * already moves, what the claim already orders by, and what the local
 * scheduler already wakes on, so a deferred job is not a new state anything
 * downstream has to learn — it is a pending job whose turn is later. Nothing
 * is dropped, no attempt is spent, and no error is written on a row that has
 * not failed at anything.
 *
 * The whole due backlog moves at once. One row at a time would be correct and
 * useless: an account with ten thousand due jobs would sit at the head of the
 * queue for ten thousand iterations while everybody else waited.
 */
async function deferAccountBacklogForBudget(
  input: DeferAccountBacklogInput,
): Promise<number> {
  const rows = await getDb().execute(sql<{ deferred: number }>`
    WITH moved AS (
      UPDATE background_jobs AS job
      SET run_after = ${input.until.toISOString()}::timestamptz,
          updated_at = ${input.now.toISOString()}::timestamptz
      FROM profiles AS profile
      WHERE profile.id = job.profile_id
        AND profile.account_id = ${input.accountId}::uuid
        AND job.status = 'pending'::background_job_status
        AND job.run_after <= ${input.now.toISOString()}::timestamptz
      RETURNING job.id
    )
    SELECT count(*)::int AS deferred FROM moved
  `);

  const [row] = rows as unknown as Array<{ deferred: number | string }>;
  return Number(row?.deferred ?? 0);
}

/**
 * Claim one job atomically.
 *
 * `FOR UPDATE SKIP LOCKED` is what lets several workers drain the same table
 * without coordination: each takes a different row instead of blocking on the
 * same one. The second arm of the shared predicate is the stale-lock reclaim —
 * a `running` row whose lock has aged past the ceiling belongs to a worker
 * that is not coming back.
 *
 * `started_at` is stamped here and never cleared afterwards, unlike
 * `locked_at`. It is the meter the per-account budget reads, and a meter that
 * a successful job erases measures nothing.
 */
async function claimNextBackgroundJob(now = new Date()): Promise<BackgroundJob | null> {
  const nowIso = now.toISOString();
  const rows = await getDb().execute(sql<BackgroundJob>`
    UPDATE background_jobs AS job
    SET
      status = 'running'::background_job_status,
      attempts = job.attempts + 1,
      rerun_requested = false,
      result = NULL,
      locked_at = ${nowIso}::timestamptz,
      started_at = ${nowIso}::timestamptz,
      updated_at = ${nowIso}::timestamptz
    WHERE job.id = (
      -- The aggregate that ranks fairness cannot sit in a FOR UPDATE
      -- query, so the ranking is a derived table and the lock lands on the
      -- base row it joins back to. Same snapshot, same predicate, same
      -- order as the head peek — the coherence fact the header relies on.
      SELECT locked.id
      FROM (${rankedRunnableJobs(nowIso)}) AS fair
      JOIN background_jobs AS locked ON locked.id = fair.id
      ${RUNNABLE_JOB_ORDER}
      LIMIT 1
      FOR UPDATE OF locked SKIP LOCKED
    )
    RETURNING
      job.id,
      job.profile_id AS "profileId",
      job.type,
      job.payload,
      job.result,
      job.rerun_requested AS "rerunRequested",
      job.status,
      job.attempts,
      job.max_attempts AS "maxAttempts",
      job.run_after AS "runAfter",
      job.locked_at AS "lockedAt",
      job.started_at AS "startedAt",
      job.last_error AS "lastError",
      job.idempotency_key AS "idempotencyKey",
      job.created_at AS "createdAt",
      job.updated_at AS "updatedAt"
  `);

  const result = rows as unknown as BackgroundJob[];
  return result[0] ?? null;
}

async function markJobSucceeded(job: BackgroundJob, completion: BackgroundJobResult | null): Promise<boolean> {
  // A job flagged mid-run goes back to pending, its flag cleared and its
  // attempts zeroed — the trailing edge the running pass could not see, run
  // exactly once no matter how many requests arrived while it worked. An
  // unflagged job simply succeeds.
  const rows = await getDb().execute(sql`
    UPDATE background_jobs
    SET status = CASE
          WHEN rerun_requested THEN 'pending'::background_job_status
          ELSE 'succeeded'::background_job_status
        END,
        result = CASE WHEN rerun_requested THEN NULL ELSE ${completion ? JSON.stringify(completion) : null}::jsonb END,
        rerun_requested = false,
        attempts = CASE WHEN rerun_requested THEN 0 ELSE attempts END,
        run_after = CASE WHEN rerun_requested THEN now() ELSE run_after END,
        locked_at = NULL,
        last_error = NULL,
        updated_at = now()
    WHERE id = ${job.id}::uuid AND status = 'running'
      AND locked_at = ${coerceNullableDate(job.lockedAt)?.toISOString() ?? null}::timestamptz
      AND attempts = ${job.attempts}
    RETURNING id
  `);
  return rows.length > 0;
}

/**
 * A hold is not a failure: status returns to pending, `run_after` names the
 * moment the floor opens, the claim's attempt is handed back (a job held
 * for days must not exhaust itself into `failed` without ever failing), and
 * `last_error` stays clean — there is no error to record.
 */
async function holdBackgroundJob(job: BackgroundJob, until: Date): Promise<void> {
  await getDb().execute(sql`
    UPDATE background_jobs
    SET status = 'pending'::background_job_status,
        locked_at = NULL,
        started_at = NULL,
        attempts = GREATEST(attempts - 1, 0),
        run_after = CASE WHEN payload->>'reason' = 'manual' THEN now() ELSE ${until.toISOString()}::timestamptz END,
        result = NULL,
        rerun_requested = false,
        updated_at = now()
    WHERE id = ${job.id}::uuid AND status = 'running'
      AND locked_at = ${coerceNullableDate(job.lockedAt)?.toISOString() ?? null}::timestamptz
      AND attempts = ${job.attempts}
  `);
}

async function markJobFailedOrPending(
  job: BackgroundJob,
  err: unknown,
  exhausted: boolean,
  now: Date,
): Promise<void> {
  const status: BackgroundJobStatus = exhausted ? "failed" : "pending";
  const lockedAt = exhausted ? (coerceNullableDate(job.lockedAt)?.toISOString() ?? null) : null;
  const runAfter = (
    exhausted ? coerceDate(job.runAfter) : calculateBackoffRunAfter(job.attempts, now)
  ).toISOString();
  await getDb().execute(sql`
    UPDATE background_jobs
    SET status = CASE WHEN rerun_requested THEN 'pending'::background_job_status ELSE ${status}::background_job_status END,
        locked_at = CASE WHEN rerun_requested THEN NULL ELSE ${lockedAt}::timestamptz END,
        run_after = CASE WHEN rerun_requested THEN ${now.toISOString()}::timestamptz ELSE ${runAfter}::timestamptz END,
        last_error = CASE WHEN rerun_requested THEN NULL ELSE ${sanitizeError(err)} END,
        attempts = CASE WHEN rerun_requested THEN 0 ELSE attempts END,
        rerun_requested = false,
        result = NULL,
        updated_at = ${now.toISOString()}::timestamptz
    WHERE id = ${job.id}::uuid AND status = 'running'
      AND locked_at = ${coerceNullableDate(job.lockedAt)?.toISOString() ?? null}::timestamptz
      AND attempts = ${job.attempts}
  `);
}

/**
 * The real store: Postgres, which is the queue.
 *
 * A plain object of the functions above rather than a class — there is one
 * instance, it holds no state, and the connection it uses is already a
 * process-wide singleton.
 */
export const postgresBackgroundJobStore: BackgroundJobStore = {
  headOfQueue: readBackgroundJobQueueHead,
  claimNext: claimNextBackgroundJob,
  usageForAccount: readAccountModelUsage,
  deferAccountBacklog: deferAccountBacklogForBudget,
  markSucceeded: markJobSucceeded,
  markFailedOrPending: markJobFailedOrPending,
  holdJob: holdBackgroundJob,
};

export function summarizeBackgroundJob(job: BackgroundJob): BackgroundJobSummary {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    payload: job.payload,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    runAfter: job.runAfter,
    lockedAt: job.lockedAt,
    lastError: job.lastError,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function coerceDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function coerceNullableDate(value: Date | string | null): Date | null {
  return value === null ? null : coerceDate(value);
}

/** 30s, 60s, 120s, … capped at 15 minutes. */
function calculateBackoffRunAfter(attempts: number, now: Date): Date {
  const delaySeconds = Math.min(15 * 60, 30 * 2 ** Math.max(0, attempts - 1));
  return new Date(now.getTime() + delaySeconds * 1_000);
}

/**
 * Errors are stored on the row and read by whoever is on call, so anything
 * that looks like a credential is stripped before it lands in a column that
 * outlives the incident.
 */
function sanitizeError(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return raw
    .replace(/(api[_-]?key|token|secret|password)=([^\s&]+)/gi, "$1=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .slice(0, MAX_ERROR_LENGTH);
}
