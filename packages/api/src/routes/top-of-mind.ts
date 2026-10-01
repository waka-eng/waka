/**
 * `/api/top-of-mind` — layer 3: the profile's single synthesized artifact.
 *
 * One artifact per profile, one live version at a time, a linear chain behind
 * it. Regeneration never mutates: it writes a new version and points the old
 * one forward, which is why the read here is always "the live row" and the
 * history is a separate endpoint rather than a diff someone has to reconstruct.
 *
 * Reads may cross profiles under the permission matrix — an agent-bound
 * session reading its human's top of mind is the conditioning case. Edits may
 * not, beyond what the matrix already allows, and every edit **locks** the
 * entry: from that point the generator may keep the entry's citations current
 * but never rewrites its words.
 *
 * Refresh is asynchronous on purpose. A synthesis is a model call over the
 * whole artifact; making a reader wait for one would put a multi-second
 * provider round-trip in the middle of a page load, and the debounce in the
 * queue means a burst of captures still costs one synthesis.
 */

import { recordConsultation } from "../lib/consultations.js";
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import {
  feedback,
  signals,
  topOfMindEntries,
  topOfMindEntrySignals,
  topOfMinds,
  type TopOfMindEntryType,
  type TopOfMindRevisionReason,
  type TopOfMindStatus,
  signalContradictions,
} from "../db/index.js";
import { getDb } from "../lib/db.js";
import { requireAuth, type AuthEnv } from "../lib/middleware.js";
import { enqueueTopOfMindRefresh } from "../lib/queue.js";
import { loadTopOfMindRefreshStatus } from "../lib/top-of-mind-refresh-status.js";
import { projectPersonalEntries } from "../lib/personal-output.js";
import { readGenerationRevision } from "../lib/generation-revision.js";
import { acquireTopOfMindArtifactLock } from "../lib/top-of-mind-family-lock.js";
import { validationDetails } from "../lib/validation.js";
import { loadProfileTarget, resolveProfileScope } from "./signals.js";

type WakaDb = ReturnType<typeof getDb>;
type WakaTx = Parameters<Parameters<WakaDb["transaction"]>[0]>[0];

const MAX_ENTRY_BODY_LENGTH = 1_000;
const DEFAULT_VERSION_LIMIT = 20;
const MAX_VERSION_LIMIT = 100;

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

const booleanFlagSchema = z.enum(["true", "false"]).transform((value) => value === "true");

const readArtifactQuerySchema = z
  .object({
    profile: z.string().uuid("profile must be a uuid").optional(),
    includeDismissed: booleanFlagSchema.optional(),
  })
  .strict();

const versionsQuerySchema = z
  .object({
    profile: z.string().uuid("profile must be a uuid").optional(),
    limit: z
      .string()
      .regex(/^\d+$/, "limit must be an integer")
      .transform((value) => Number.parseInt(value, 10))
      .pipe(z.number().int().min(1).max(MAX_VERSION_LIMIT))
      .optional(),
  })
  .strict();

const scopeQuerySchema = z
  .object({ profile: z.string().uuid("profile must be a uuid").optional() })
  .strict();

const entryParamsSchema = z.object({
  entryId: z.string().uuid("entryId must be a uuid"),
});

const updateEntryBodySchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(1, "body cannot be empty")
      .max(MAX_ENTRY_BODY_LENGTH, `body must be <= ${MAX_ENTRY_BODY_LENGTH} characters`),
  })
  .strict();

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export interface TopOfMindEntryView {
  id: string;
  type: TopOfMindEntryType;
  body: string;
  belief: string | null;
  prompt: string | null;
  /** The owner edited this entry; regeneration will not rewrite it. */
  locked: boolean;
  pinned: boolean;
  dismissed: boolean;
  sortOrder: number;
  /** What the entry rests on. Every id here is a signal the profile holds.
      `answered` is the RATIFIED standing of that ground: true when the owner
      has spoken to it — a verdict (any feedback on the signal) or a star
      (their own locked words) — false while only the machine believes it.
      Computed from the feedback and lock records at serve time, never
      stored: the light must move the moment the person answers
      (goals/the-legible-loop.md Phase 4). */
  citedSignals: Array<{ id: string; statement: string; answered: boolean; locked: boolean; contested: boolean }>;
  createdAt: string;
  supportChanged?: boolean;
}

export interface TopOfMindView {
  id: string;
  version: number;
  reason: TopOfMindRevisionReason;
  createdAt: string;
  entries: TopOfMindEntryView[];
  supportChanged?: boolean;
  /** Orders private read snapshots; not the artifact's version or completion. */
  generationRevision?: string;
  profileId?: string;
}

export interface TopOfMindVersionView {
  id: string;
  version: number;
  status: TopOfMindStatus;
  reason: TopOfMindRevisionReason;
  entryCount: number;
  replacedById: string | null;
  replacedAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

async function loadEntries(
  db: WakaDb | WakaTx,
  profileId: string,
  topOfMindId: string,
  includeDismissed: boolean,
  includeWithheld = false,
): Promise<{ entries: TopOfMindEntryView[]; supportChanged: boolean }> {
  const entryRows = await db
    .select()
    .from(topOfMindEntries)
    .where(eq(topOfMindEntries.topOfMindId, topOfMindId))
    .orderBy(asc(topOfMindEntries.sortOrder));

  const selected = includeDismissed
    ? entryRows
    : entryRows.filter((row) => row.dismissedAt === null);
  const projected = await projectPersonalEntries(db, profileId, selected, includeWithheld);
  const visible = projected.entries;
  if (visible.length === 0) return { entries: [], supportChanged: projected.supportChanged };

  const citationRows = await db
    .select({
      entryId: topOfMindEntrySignals.entryId,
      signalId: topOfMindEntrySignals.signalId,
      statement: signals.statement,
      // The star half of the ratified standing rides the join it needs no
      // extra query for: the owner's locked words are their answer.
      lockedAt: signals.lockedAt,
    })
    .from(topOfMindEntrySignals)
    .innerJoin(signals, eq(signals.id, topOfMindEntrySignals.signalId))
    .where(
      inArray(
        topOfMindEntrySignals.entryId,
        visible.map((row) => row.id),
      ),
    );

  // The verdict half: which of these grounds the owner has answered. Read
  // from the feedback rows at serve time — computed, never stored — so a
  // verdict given a second ago already moves the light on this serve. Any
  // verdict counts, not_true included: ratified means "we have spoken about
  // this", not "it is true".
  const citedIds = [
    ...new Set(
      citationRows
        .map((row) => row.signalId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const answeredIds = new Set<string>();
  if (citedIds.length > 0) {
    const verdictRows = await db
      .selectDistinct({ targetId: feedback.targetId })
      .from(feedback)
      .where(
        and(
          eq(feedback.profileId, profileId),
          eq(feedback.targetType, "signal"),
          inArray(feedback.targetId, citedIds),
        ),
      );
    for (const row of verdictRows) answeredIds.add(row.targetId);
  }

  /* CONTESTED, CARRIED TO THE LIGHT. A signal standing in an open pair the
     owner has not arbitrated must not render like a settled one — the world
     is where the owner learns there is anything to arbitrate, and the
     verdict gesture on this very row is what resolves the pair. Open pairs
     only; a resolved row is the record of an arbitration, not a state. */
  const contestedIds = new Set<string>();
  if (citedIds.length > 0) {
    const pairRows = await db
      .select({
        aSignalId: signalContradictions.aSignalId,
        bSignalId: signalContradictions.bSignalId,
      })
      .from(signalContradictions)
      .where(
        and(
          eq(signalContradictions.profileId, profileId),
          isNull(signalContradictions.resolvedAt),
          or(
            inArray(signalContradictions.aSignalId, citedIds),
            inArray(signalContradictions.bSignalId, citedIds),
          ),
        ),
      );
    for (const pair of pairRows) {
      contestedIds.add(pair.aSignalId);
      contestedIds.add(pair.bSignalId);
    }
  }

  const citationsByEntry = new Map<
    string,
    Array<{ id: string; statement: string; answered: boolean; locked: boolean; contested: boolean }>
  >();
  for (const row of citationRows) {
    // The inner join already excludes citations whose signal was deleted;
    // this narrows the type to match.
    if (row.signalId === null) continue;
    if (!projected.citationsByEntry.get(row.entryId)?.includes(row.signalId)) continue;
    const cited = {
      id: row.signalId,
      statement: row.statement,
      answered: row.lockedAt !== null || answeredIds.has(row.signalId),
      /* `answered` CONFLATES TWO DIFFERENT THINGS, deliberately — a verdict and
         a rewrite both mean the person has dealt with this sentence, and the
         poster only asks about the ones they have not. But the WORLD needs to
         tell them apart: rewriting a signal locks its words against
         regeneration, and only a locked one has anything to hand back. Sent
         separately so the client can offer the way out of a door it was
         letting people walk through in one direction. The value is already in
         hand a line above; nothing extra is read for it. */
      locked: row.lockedAt !== null,
      contested: contestedIds.has(row.signalId),
    };
    const bucket = citationsByEntry.get(row.entryId);
    if (bucket) bucket.push(cited);
    else citationsByEntry.set(row.entryId, [cited]);
  }

  return { supportChanged: projected.supportChanged, entries: visible.map((row) => ({
    id: row.id,
    type: row.type,
    body: row.body,
    belief: row.belief,
    prompt: row.prompt,
    locked: row.lockedAt !== null,
    pinned: row.pinnedAt !== null,
    dismissed: row.dismissedAt !== null,
    sortOrder: row.sortOrder,
    citedSignals: citationsByEntry.get(row.id) ?? [],
    createdAt: row.createdAt.toISOString(),
    supportChanged: row.supportChanged,
  })) };
}

export async function getLiveTopOfMind(
  db: WakaDb,
  input: { profileId: string; includeDismissed?: boolean },
): Promise<TopOfMindView | null> {
  return readProfileArtifact(db, input);
}

export async function getTopOfMindVersion(db: WakaDb, input: { profileId: string; artifactId: string }): Promise<TopOfMindView | null> {
  return readProfileArtifact(db, input);
}

async function readProfileArtifact(db: WakaDb, input: { profileId: string; artifactId?: string; includeDismissed?: boolean }): Promise<TopOfMindView | null> {
  // The token and its projected data must come from one snapshot. Stamping
  // an old projection with a newer token would defeat client stale-read guards.
  return db.transaction(async (tx) => {
  const revision = await readGenerationRevision(tx, { profileId: input.profileId });
  if (!revision) return null;
  const [artifact] = await tx
    .select()
    .from(topOfMinds)
    .where(and(eq(topOfMinds.profileId, input.profileId), input.artifactId
      ? eq(topOfMinds.id, input.artifactId) : eq(topOfMinds.status, "live")))
    .limit(1);
  if (!artifact) return null;

  return {
    id: artifact.id,
    version: artifact.version,
    reason: artifact.reason,
    createdAt: artifact.createdAt.toISOString(),
    profileId: input.profileId,
    generationRevision: revision.revision.toString(),
    ...await loadEntries(tx, input.profileId, artifact.id, input.includeDismissed === true),
  };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function listTopOfMindVersions(
  db: WakaDb,
  input: { profileId: string; limit: number },
): Promise<TopOfMindVersionView[]> {
  const rows = await db
    .select()
    .from(topOfMinds)
    .where(eq(topOfMinds.profileId, input.profileId))
    .orderBy(desc(topOfMinds.version))
    .limit(input.limit);
  if (rows.length === 0) return [];

  const entryRows = await db
    .select({ id: topOfMindEntries.id, topOfMindId: topOfMindEntries.topOfMindId })
    .from(topOfMindEntries)
    .where(
      inArray(
        topOfMindEntries.topOfMindId,
        rows.map((row) => row.id),
      ),
    );

  const countByArtifact = new Map<string, number>();
  for (const row of entryRows) {
    countByArtifact.set(row.topOfMindId, (countByArtifact.get(row.topOfMindId) ?? 0) + 1);
  }

  return rows.map((row) => ({
    id: row.id,
    version: row.version,
    status: row.status,
    reason: row.reason,
    entryCount: countByArtifact.get(row.id) ?? 0,
    replacedById: row.replacedById,
    replacedAt: toIso(row.replacedAt),
    createdAt: row.createdAt.toISOString(),
  }));
}

/**
 * Entry state changes apply to the live version only. An older version is the
 * record of what the artifact said then; editing it would rewrite history and
 * leave the chain describing something that never happened.
 */
export async function updateLiveEntry(
  db: WakaDb,
  input: {
    profileId: string;
    entryId: string;
    patch: Partial<
      Pick<typeof topOfMindEntries.$inferInsert, "body" | "lockedAt" | "pinnedAt" | "dismissedAt">
    >;
  },
): Promise<TopOfMindEntryView | null> {
  // Under the artifact lock, and resolving the live entry *inside* the lock.
  // A synthesis holds the same lock while it reads entries and writes the next
  // version, so without this an edit could land on the row of a version being
  // superseded — the person's own words silently dropped from the new live
  // artifact. Taking the lock makes the edit wait for any in-flight synthesis,
  // then apply to whatever version is live once it does.
  const topOfMindId = await db.transaction(async (tx) => {
    await acquireTopOfMindArtifactLock(tx, { profileId: input.profileId });

    const [entry] = await tx
      .select({ id: topOfMindEntries.id, topOfMindId: topOfMindEntries.topOfMindId })
      .from(topOfMindEntries)
      .innerJoin(topOfMinds, eq(topOfMinds.id, topOfMindEntries.topOfMindId))
      .where(
        and(
          eq(topOfMindEntries.id, input.entryId),
          eq(topOfMinds.profileId, input.profileId),
          eq(topOfMinds.status, "live"),
        ),
      )
      .limit(1);

    const target = entry ?? (await resolveSupersededEntry(tx, input));
    if (!target) return null;

    await tx
      .update(topOfMindEntries)
      .set({ ...input.patch, updatedAt: new Date() })
      .where(eq(topOfMindEntries.id, target.id));
    return { topOfMindId: target.topOfMindId, entryId: target.id };
  });

  if (topOfMindId === null) return null;
  // The owner may release/dismiss a now-withheld entry. Returning its mutation
  // receipt is not the same as serving it as a current generated conclusion.
  const { entries } = await loadEntries(db, input.profileId, topOfMindId.topOfMindId, true, true);
  return entries.find((row) => row.id === topOfMindId.entryId) ?? null;
}

/**
 * Follow an entry id forward into the live version.
 *
 * Every regeneration writes new entry rows, so an id goes stale the moment a
 * synthesis lands — and synthesis lands within seconds of a capture. A reader
 * looking at their board, who dismisses a line while a regeneration completes
 * underneath them, would otherwise have their own click answered with "no such
 * entry". The entry is right there on their screen.
 *
 * Identity across versions is the text, which is exactly what carry-forward
 * preserves byte-for-byte. If the live version no longer says it, the entry
 * genuinely went away and a 404 is the honest answer — so this resolves only
 * within the same profile's own artifact family, and only to a line that is
 * still there.
 */
async function resolveSupersededEntry(
  tx: WakaTx,
  input: { profileId: string; entryId: string },
): Promise<{ id: string; topOfMindId: string } | null> {
  const [stale] = await tx
    .select({ body: topOfMindEntries.body })
    .from(topOfMindEntries)
    .innerJoin(topOfMinds, eq(topOfMinds.id, topOfMindEntries.topOfMindId))
    .where(
      and(
        eq(topOfMindEntries.id, input.entryId),
        eq(topOfMinds.profileId, input.profileId),
      ),
    )
    .limit(1);
  if (!stale) return null;

  const [live] = await tx
    .select({ id: topOfMindEntries.id, topOfMindId: topOfMindEntries.topOfMindId })
    .from(topOfMindEntries)
    .innerJoin(topOfMinds, eq(topOfMinds.id, topOfMindEntries.topOfMindId))
    .where(
      and(
        eq(topOfMinds.profileId, input.profileId),
        eq(topOfMinds.status, "live"),
        eq(topOfMindEntries.body, stale.body),
      ),
    )
    .orderBy(asc(topOfMindEntries.sortOrder))
    .limit(1);
  return live ?? null;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export interface TopOfMindRouteDependencies {
  getDatabase?: typeof getDb;
  getTopOfMind?: typeof getLiveTopOfMind;
  getVersion?: typeof getTopOfMindVersion;
  listVersions?: typeof listTopOfMindVersions;
  updateEntry?: typeof updateLiveEntry;
  requestRefresh?: typeof enqueueTopOfMindRefresh;
  loadRefreshStatus?: typeof loadTopOfMindRefreshStatus;
  loadProfile?: typeof loadProfileTarget;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
}

export function createTopOfMindRoutes(
  deps: TopOfMindRouteDependencies = {},
): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  const getTopOfMind = deps.getTopOfMind ?? getLiveTopOfMind;
  const listVersions = deps.listVersions ?? listTopOfMindVersions;
  const updateEntry = deps.updateEntry ?? updateLiveEntry;
  const requestRefresh = deps.requestRefresh ?? enqueueTopOfMindRefresh;
  const loadProfile = deps.loadProfile ?? loadProfileTarget;

  routes.use("*", deps.authMiddleware ?? requireAuth);

  routes.get("/", async (c) => {
    const parsedQuery = readArtifactQuerySchema.safeParse(c.req.query());
    if (!parsedQuery.success) {
      return c.json(
        {
          error: "Invalid top of mind query",
          details: validationDetails(parsedQuery.error),
        },
        400,
      );
    }

    const db = getDatabase();
    const scope = await resolveProfileScope(
      db,
      c.get("session"),
      parsedQuery.data.profile,
      "read",
      loadProfile,
    );
    if (!scope.ok) return c.json(scope.body, scope.status);

    const topOfMind = await getTopOfMind(db, {
      profileId: scope.profileId,
      includeDismissed: parsedQuery.data.includeDismissed === true,
    });
    /* the read side answers for itself — the version served is the receipt,
       and "nothing synthesized yet" is a serve worth recording too */
    await recordConsultation(db, {
      profileId: scope.profileId,
      session: c.get("session"),
      surface: "top_of_mind",
      artifactVersion: topOfMind?.version ?? null,
    });
    // Null rather than an empty artifact: "nothing has been synthesized yet"
    // is a different state from "the synthesis found nothing to say", and a
    // reader deserves to be able to tell them apart.
    return c.json({ topOfMind }, 200);
  });

  routes.get("/versions", async (c) => {
    const parsedQuery = versionsQuerySchema.safeParse(c.req.query());
    if (!parsedQuery.success) {
      return c.json(
        { error: "Invalid version query", details: validationDetails(parsedQuery.error) },
        400,
      );
    }

    const db = getDatabase();
    const scope = await resolveProfileScope(
      db,
      c.get("session"),
      parsedQuery.data.profile,
      "read",
      loadProfile,
    );
    if (!scope.ok) return c.json(scope.body, scope.status);

    const versions = await listVersions(db, {
      profileId: scope.profileId,
      limit: parsedQuery.data.limit ?? DEFAULT_VERSION_LIMIT,
    });
    return c.json({ versions }, 200);
  });

  routes.get("/versions/:artifactId", async (c) => {
    const id = z.string().uuid().safeParse(c.req.param("artifactId"));
    const query = scopeQuerySchema.safeParse(c.req.query());
    if (!id.success || !query.success) return c.json({ error: "Invalid reading version request" }, 400);
    const db = getDatabase();
    const scope = await resolveProfileScope(db, c.get("session"), query.data.profile, "read", loadProfile);
    if (!scope.ok) return c.json(scope.body, scope.status);
    const topOfMind = await (deps.getVersion ?? getTopOfMindVersion)(db, { profileId: scope.profileId, artifactId: id.data });
    if (!topOfMind) return c.json({ error: "Reading version not found" }, 404);
    return c.json({ topOfMind });
  });

  routes.post("/refresh", async (c) => {
    const parsedQuery = scopeQuerySchema.safeParse(c.req.query());
    if (!parsedQuery.success) {
      return c.json(
        { error: "Invalid refresh query", details: validationDetails(parsedQuery.error) },
        400,
      );
    }

    const scope = await resolveProfileScope(
      getDatabase(),
      c.get("session"),
      parsedQuery.data.profile,
      "write",
      loadProfile,
    );
    if (!scope.ok) return c.json(scope.body, scope.status);

    const { jobId } = await requestRefresh(scope.profileId, "manual");
    // 202: the artifact a caller reads back now is still the current version.
    // The queue collapses concurrent requests into one synthesis.
    return c.json({ status: "queued", jobId }, 202);
  });

  routes.get("/refresh/:jobId", async (c) => {
    const jobId = z.string().uuid().safeParse(c.req.param("jobId"));
    const query = scopeQuerySchema.safeParse(c.req.query());
    if (!jobId.success || !query.success) return c.json({ error: "Invalid refresh status request" }, 400);
    const db = getDatabase();
    const scope = await resolveProfileScope(db, c.get("session"), query.data.profile, "read", loadProfile);
    if (!scope.ok) return c.json(scope.body, scope.status);
    const status = await (deps.loadRefreshStatus ?? loadTopOfMindRefreshStatus)(db, scope.profileId, jobId.data);
    if (!status) return c.json({ error: "Reading request not found" }, 404);
    return c.json(status);
  });

  routes.patch("/entries/:entryId", async (c) => {
    const parsedParams = entryParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) {
      return c.json(
        { error: "Invalid entry id", details: validationDetails(parsedParams.error) },
        400,
      );
    }
    const parsedQuery = scopeQuerySchema.safeParse(c.req.query());
    if (!parsedQuery.success) {
      return c.json(
        { error: "Invalid entry query", details: validationDetails(parsedQuery.error) },
        400,
      );
    }

    const rawBody = await c.req.json().catch(() => null);
    const parsedBody = updateEntryBodySchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return c.json(
        { error: "Invalid entry update", details: validationDetails(parsedBody.error) },
        400,
      );
    }

    const db = getDatabase();
    const scope = await resolveProfileScope(
      db,
      c.get("session"),
      parsedQuery.data.profile,
      "write",
      loadProfile,
    );
    if (!scope.ok) return c.json(scope.body, scope.status);

    // Body and lock move together. An edit that left the entry unlocked for
    // even one refresh would be an edit the next synthesis silently undid.
    const entry = await updateEntry(db, {
      profileId: scope.profileId,
      entryId: parsedParams.data.entryId,
      patch: { body: parsedBody.data.body, lockedAt: new Date() },
    });
    if (!entry) return c.json({ error: "Entry not found" }, 404);
    return c.json({ entry }, 200);
  });

  const entryStateRoute = (
    path: "/entries/:entryId/pin" | "/entries/:entryId/dismiss" | "/entries/:entryId/restore" | "/entries/:entryId/release",
    patch: () => Parameters<typeof updateLiveEntry>[1]["patch"],
  ) => {
    routes.post(path, async (c) => {
      const parsedParams = entryParamsSchema.safeParse(c.req.param());
      if (!parsedParams.success) {
        return c.json(
          { error: "Invalid entry id", details: validationDetails(parsedParams.error) },
          400,
        );
      }
      const parsedQuery = scopeQuerySchema.safeParse(c.req.query());
      if (!parsedQuery.success) {
        return c.json(
          { error: "Invalid entry query", details: validationDetails(parsedQuery.error) },
          400,
        );
      }

      const db = getDatabase();
      const scope = await resolveProfileScope(
        db,
        c.get("session"),
        parsedQuery.data.profile,
        "write",
        loadProfile,
      );
      if (!scope.ok) return c.json(scope.body, scope.status);

      const entry = await updateEntry(db, {
        profileId: scope.profileId,
        entryId: parsedParams.data.entryId,
        patch: patch(),
      });
      if (!entry) return c.json({ error: "Entry not found" }, 404);
      return c.json({ entry }, 200);
    });
  };

  // Pin, dismiss, and restore are entry state rather than feedback: the
  // generator reads them on every pass, and carries them into the version it
  // writes, which is what makes any of the three survive a regeneration.
  entryStateRoute("/entries/:entryId/pin", () => ({ pinnedAt: new Date() }));
  entryStateRoute("/entries/:entryId/dismiss", () => ({ dismissedAt: new Date() }));
  entryStateRoute("/entries/:entryId/restore", () => ({ dismissedAt: null }));
  // Release is the unlock the canon promised ("unlocking is an explicit human
  // act"): the words stay exactly as the person left them, and from the next
  // synthesis on the generator may reword or retire them like any generated
  // entry. The act is the owner handing the sentence back — nothing is
  // rewritten at release time.
  entryStateRoute("/entries/:entryId/release", () => ({ lockedAt: null }));

  return routes;
}

export const topOfMindRoutes = createTopOfMindRoutes();
