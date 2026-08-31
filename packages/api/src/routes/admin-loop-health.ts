/**
 * `GET /api/admin/loop-health` — the derivation funnel, counted.
 *
 * Every threshold in the pipeline (the cosine bands, promotion at three, the
 * confidence half-life) was set by judgment, and until now there was nothing
 * to judge a retuning against: the per-job summaries were logged and gone.
 * This door aggregates what the domain tables already hold into the funnel —
 * kept → minted/attached → refused → promoted — per day over a window, plus
 * the queue's own health and the live threshold values, so a number sits
 * next to every knob before anyone turns it.
 *
 * Counts only. No statement text, no capture text, no per-profile splits —
 * an operator surface reads the loop's mechanics, never anyone's memory.
 *
 * Gated twice, like the background-jobs door beside it: the routes must be
 * enabled by env, and the session's account must be on the admin allowlist.
 *
 * HONEST GAPS, stated rather than faked: candidate counts and judge-verdict
 * splits are not stored anywhere (only logged at derive time), so the funnel
 * starts at "minted or attached"; and signals carry no promotion timestamp,
 * so promotion is reported as the standing emerging/active split, not a
 * per-day series.
 */
import { gte, sql } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";

import {
  backgroundJobs,
  consultations,
  inspirations,
  signalEvidence,
  signals,
  suppressions,
  topOfMinds,
} from "../db/index.js";
import { requireAdminUser } from "../lib/admin-auth.js";
import { getDb } from "../lib/db.js";
import { requireAuth, type AuthEnv } from "../lib/middleware.js";
import {
  CONFIDENCE_RECENCY_HALF_LIFE_DAYS,
  SIGNAL_BATCH_DEDUPE_MIN_COSINE,
  SIGNAL_MATCH_MIN_COSINE,
  SIGNAL_MERGE_JUDGE_MIN_COSINE,
  SIGNAL_PROMOTION_MIN_EVIDENCE,
  SIGNAL_SUPPRESSION_MIN_COSINE,
} from "../lib/signal-derivation-thresholds.js";
import { isAdminBackgroundJobsEnabled } from "./admin-background-jobs.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 14;
const MAX_WINDOW_DAYS = 90;

export interface LoopHealthDay {
  /** ISO date, UTC */
  date: string;
  kept: number;
  minted: number;
  /** evidence rows written beyond each mint's own first row */
  attached: number;
  refused: number;
  consulted: number;
  tomVersions: number;
}

export interface LoopHealth {
  windowDays: number;
  days: LoopHealthDay[];
  standing: {
    signalsEmerging: number;
    signalsActive: number;
    signalsRetired: number;
  };
  jobs: {
    /** derive_signals outcomes inside the window */
    deriveSucceeded: number;
    /** the alarm column: a failed derive is a capture the loop has not read */
    deriveFailed: number;
    refreshSucceeded: number;
    refreshFailed: number;
  };
  tomReasons: Record<string, number>;
  thresholds: Record<string, number>;
}

export const requireAdminLoopHealthEnabled: MiddlewareHandler<AuthEnv> = async (c, next) => {
  if (!isAdminBackgroundJobsEnabled()) return c.notFound();
  await next();
};

interface LoopHealthRouteDependencies {
  authMiddleware?: MiddlewareHandler<AuthEnv>;
  adminGate?: MiddlewareHandler<AuthEnv>;
  adminAuthorization?: MiddlewareHandler<AuthEnv>;
  getDatabase?: typeof getDb;
}

export function createAdminLoopHealthRoute(
  deps: LoopHealthRouteDependencies = {},
): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  routes.use("*", deps.adminGate ?? requireAdminLoopHealthEnabled);
  routes.use("*", deps.authMiddleware ?? requireAuth);
  routes.use("*", deps.adminAuthorization ?? requireAdminUser);

  routes.get("/", async (c) => {
    const raw = Number.parseInt(c.req.query("days") ?? "", 10);
    const windowDays = Number.isFinite(raw)
      ? Math.min(Math.max(raw, 1), MAX_WINDOW_DAYS)
      : DEFAULT_WINDOW_DAYS;
    const db = getDatabase();
    const now = new Date();
    const since = new Date(now.getTime() - windowDays * MS_PER_DAY);

    /* each family's own event column, spoken by name — suppressions are
       stamped when they refuse, consultations when they serve */
    const dayOfCol = (col: string) =>
      sql<string>`to_char(date_trunc('day', ${sql.raw(col)} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`;
    const dayOf = dayOfCol("created_at");

    const [kept, minted, evidence, refused, consulted, toms, standing, jobRows, reasons] =
      await Promise.all([
        db
          .select({ day: dayOf, n: sql<number>`count(*)::int` })
          .from(inspirations)
          .where(gte(inspirations.createdAt, since))
          .groupBy(sql`1`),
        db
          .select({ day: dayOf, n: sql<number>`count(*)::int` })
          .from(signals)
          .where(gte(signals.createdAt, since))
          .groupBy(sql`1`),
        db
          .select({ day: dayOf, n: sql<number>`count(*)::int` })
          .from(signalEvidence)
          .where(gte(signalEvidence.createdAt, since))
          .groupBy(sql`1`),
        db
          .select({ day: dayOfCol("suppressed_at"), n: sql<number>`count(*)::int` })
          .from(suppressions)
          .where(gte(suppressions.suppressedAt, since))
          .groupBy(sql`1`),
        db
          .select({ day: dayOfCol("served_at"), n: sql<number>`count(*)::int` })
          .from(consultations)
          .where(gte(consultations.servedAt, since))
          .groupBy(sql`1`),
        db
          .select({ day: dayOf, n: sql<number>`count(*)::int` })
          .from(topOfMinds)
          .where(gte(topOfMinds.createdAt, since))
          .groupBy(sql`1`),
        db
          .select({ status: signals.status, n: sql<number>`count(*)::int` })
          .from(signals)
          .groupBy(signals.status),
        db
          .select({
            type: backgroundJobs.type,
            status: backgroundJobs.status,
            n: sql<number>`count(*)::int`,
          })
          .from(backgroundJobs)
          .where(gte(backgroundJobs.updatedAt, since))
          .groupBy(backgroundJobs.type, backgroundJobs.status),
        db
          .select({ reason: topOfMinds.reason, n: sql<number>`count(*)::int` })
          .from(topOfMinds)
          .where(gte(topOfMinds.createdAt, since))
          .groupBy(topOfMinds.reason),
      ]);

    const byDay = new Map<string, LoopHealthDay>();
    const dayRow = (date: string): LoopHealthDay => {
      const existing = byDay.get(date);
      if (existing) return existing;
      const fresh: LoopHealthDay = {
        date,
        kept: 0,
        minted: 0,
        attached: 0,
        refused: 0,
        consulted: 0,
        tomVersions: 0,
      };
      byDay.set(date, fresh);
      return fresh;
    };
    for (const r of kept) dayRow(r.day).kept = r.n;
    for (const r of minted) dayRow(r.day).minted = r.n;
    for (const r of evidence) dayRow(r.day).attached = r.n;
    for (const r of refused) dayRow(r.day).refused = r.n;
    for (const r of consulted) dayRow(r.day).consulted = r.n;
    for (const r of toms) dayRow(r.day).tomVersions = r.n;
    /* each mint writes its own first evidence row; what is left is attachment */
    for (const row of byDay.values()) row.attached = Math.max(0, row.attached - row.minted);

    const standingOf = (status: string) => standing.find((r) => r.status === status)?.n ?? 0;
    const jobOf = (type: string, status: string) =>
      jobRows.find((r) => r.type === type && r.status === status)?.n ?? 0;

    const body: LoopHealth = {
      windowDays,
      days: [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
      standing: {
        signalsEmerging: standingOf("emerging"),
        signalsActive: standingOf("active"),
        signalsRetired: standingOf("retired"),
      },
      jobs: {
        deriveSucceeded: jobOf("derive_signals", "succeeded"),
        deriveFailed: jobOf("derive_signals", "failed"),
        refreshSucceeded: jobOf("refresh_top_of_mind", "succeeded"),
        refreshFailed: jobOf("refresh_top_of_mind", "failed"),
      },
      tomReasons: Object.fromEntries(reasons.map((r) => [r.reason, r.n])),
      thresholds: {
        SIGNAL_MERGE_JUDGE_MIN_COSINE,
        SIGNAL_MATCH_MIN_COSINE,
        SIGNAL_BATCH_DEDUPE_MIN_COSINE,
        SIGNAL_SUPPRESSION_MIN_COSINE,
        SIGNAL_PROMOTION_MIN_EVIDENCE,
        CONFIDENCE_RECENCY_HALF_LIFE_DAYS,
      },
    };
    return c.json({ loopHealth: body }, 200);
  });

  return routes;
}
