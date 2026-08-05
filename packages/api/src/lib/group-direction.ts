/**
 * Product-facing read/write model for a room's shared direction.
 *
 * `group-combination-reading.ts` owns generation. This module owns what people
 * can see and do around those immutable readings: current wording, one proposed
 * update, attributed shaping notes, review responses, and adopted history.
 */

import { and, asc, desc, eq, gt, inArray, notInArray, sql } from "drizzle-orm";

import {
  combinationReadings,
  combinations,
  groupDirectionContributions,
  groupDirectionResponses,
  signals,
  type CombinationReadingFacet,
  type GroupDirectionContributionKind,
  type GroupDirectionResponseValue,
} from "../db/index.js";
import { loadGroupWithMembers, truncatePreview } from "./group-top-of-mind.js";
import { requiredDirectionContributors } from "./group-direction-policy.js";
import type { WakaDb } from "./inspiration-embeddings.js";
import { normalizeSupportedLocale, type SupportedLocale } from "./locales.js";

export interface GroupDirectionEvidence {
  signalId: string;
  userId: string;
  memberName: string;
  quote: string;
  textPreview: string;
}

export interface GroupDirectionReading {
  id: string;
  versionNumber: number;
  state: "revealed" | "forming";
  ambition: string | null;
  facets: CombinationReadingFacet[];
  awayFrom: string | null;
  tension: string | null;
  nextQuestion: string | null;
  whatsMissing: string | null;
  changeSummary: string | null;
  evidence: GroupDirectionEvidence[];
  contributorCount: number;
  reconfirmedCount: number;
  evidenceSpanStart: string | null;
  evidenceSpanEnd: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GroupDirectionContributionSurface {
  id: string;
  readingId: string;
  userId: string;
  memberName: string;
  kind: GroupDirectionContributionKind;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface GroupDirectionResponseSurface {
  userId: string;
  memberName: string;
  value: GroupDirectionResponseValue;
  updatedAt: string;
}

export interface GroupDirectionSnapshot {
  current: GroupDirectionReading | null;
  proposal: GroupDirectionReading | null;
  history: GroupDirectionReading[];
  contributions: GroupDirectionContributionSurface[];
  responses: GroupDirectionResponseSurface[];
  memberCount: number;
  sharedInspirationCount: number;
  /** Current members who have at least one inspiration shared with this room. */
  sharedContributorCount: number;
  newInspirationCount: number;
  newContributorCount: number;
  contributorCount: number;
  requiredContributors: number;
  requiredResponses: number;
  viewerResponse: GroupDirectionResponseValue | null;
}

const DIRECTION_READING_COLUMNS = {
  id: combinationReadings.id,
  combinationId: combinationReadings.combinationId,
  state: combinationReadings.state,
  ambitionText: combinationReadings.ambitionText,
  facets: combinationReadings.facets,
  awayFrom: combinationReadings.awayFrom,
  tension: combinationReadings.tension,
  nextQuestion: combinationReadings.nextQuestion,
  whatsMissing: combinationReadings.whatsMissing,
  memberQuotes: combinationReadings.memberQuotes,
  reconfirmedCount: combinationReadings.reconfirmedCount,
  evidenceSignalIds: combinationReadings.evidenceSignalIds,
  evidenceSpanStart: combinationReadings.evidenceSpanStart,
  evidenceSpanEnd: combinationReadings.evidenceSpanEnd,
  changeSummary: combinationReadings.changeSummary,
  previousReadingId: combinationReadings.previousReadingId,
  lifecycleStatus: combinationReadings.lifecycleStatus,
  createdAt: combinationReadings.createdAt,
  updatedAt: combinationReadings.updatedAt,
} as const;

type DirectionReadingRow = {
  id: string;
  combinationId: string;
  state: string;
  ambitionText: string | null;
  facets: CombinationReadingFacet[];
  awayFrom: string | null;
  tension: string | null;
  nextQuestion: string | null;
  whatsMissing: string | null;
  memberQuotes: Array<{ userId: string; signalId: string; quote: string }>;
  reconfirmedCount: number;
  evidenceSignalIds: string[];
  evidenceSpanStart: Date | null;
  evidenceSpanEnd: Date | null;
  changeSummary: string | null;
  previousReadingId: string | null;
  lifecycleStatus: string;
  createdAt: Date;
  updatedAt: Date;
};

/** Majority participation, with two people as the minimum collective act. */
export function requiredDirectionResponses(memberCount: number): number {
  if (memberCount <= 1) return memberCount;
  return Math.max(2, Math.floor(memberCount / 2) + 1);
}

export { requiredDirectionContributors } from "./group-direction-policy.js";

export function directionReviewDecision(input: {
  memberCount: number;
  acceptCount: number;
  keepCurrentCount: number;
}): "adopted" | "kept_current" | "pending" {
  const required = requiredDirectionResponses(input.memberCount);
  if (input.keepCurrentCount >= required) return "kept_current";
  if (input.acceptCount >= required && input.keepCurrentCount === 0) return "adopted";
  return "pending";
}

function readingSurface(
  row: DirectionReadingRow,
  versionNumber: number,
  memberNameById: Map<string, string>,
  sharedSignalById: Map<string, { userId: string; text: string }>,
): GroupDirectionReading {
  const evidence = (row.memberQuotes ?? []).flatMap((quote) => {
    const signal = sharedSignalById.get(quote.signalId);
    const memberName = memberNameById.get(quote.userId);
    if (!signal || signal.userId !== quote.userId || !memberName) return [];
    return [{
      signalId: quote.signalId,
      userId: quote.userId,
      memberName,
      quote: quote.quote,
      textPreview: truncatePreview(signal.text),
    }];
  });
  return {
    id: row.id,
    versionNumber,
    state: row.state === "revealed" ? "revealed" : "forming",
    ambition: row.ambitionText,
    facets: row.facets ?? [],
    awayFrom: row.awayFrom,
    tension: row.tension,
    nextQuestion: row.nextQuestion,
    whatsMissing: row.whatsMissing,
    changeSummary: row.changeSummary,
    evidence,
    contributorCount: new Set(evidence.map((item) => item.userId)).size,
    reconfirmedCount: row.reconfirmedCount,
    evidenceSpanStart: row.evidenceSpanStart?.toISOString() ?? null,
    evidenceSpanEnd: row.evidenceSpanEnd?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getGroupDirection(
  db: WakaDb,
  input: { userId: string; groupId: string; preferredLocale?: SupportedLocale },
): Promise<GroupDirectionSnapshot | null> {
  const loaded = await loadGroupWithMembers(db, input);
  if (!loaded) return null;
  const locale = normalizeSupportedLocale(input.preferredLocale);
  const memberIds = loaded.members.map((member) => member.userId);
  const memberNameById = new Map(
    loaded.members.map((member) => [member.userId, member.name]),
  );

  const readingRows = (await db
    .select(DIRECTION_READING_COLUMNS)
    .from(combinationReadings)
    .innerJoin(combinations, eq(combinationReadings.combinationId, combinations.id))
    .where(
      and(
        eq(combinations.groupId, input.groupId),
        eq(combinationReadings.locale, locale),
        inArray(combinationReadings.lifecycleStatus, [
          "active",
          "replaced",
          "proposed",
        ]),
      ),
    )
    .orderBy(asc(combinationReadings.createdAt))) as DirectionReadingRow[];

  const currentRow = [...readingRows]
    .reverse()
    .find((row) => row.lifecycleStatus === "active") ?? null;
  const proposalRow = [...readingRows]
    .reverse()
    .find((row) => row.lifecycleStatus === "proposed") ?? null;
  const historyRows = readingRows.filter(
    (row) =>
      row.state === "revealed" &&
      (row.lifecycleStatus === "active" || row.lifecycleStatus === "replaced"),
  );

  /**
   * A direction page used to fetch the full text of every shared inspiration
   * in the room just to show four quotes and two counters. That made opening a
   * mature room slower in direct proportion to everything its members had ever
   * saved. Fetch text only for cited evidence; let Postgres calculate the
   * counts next to the data instead of shipping the whole collection here.
   */
  const evidenceSignalIds = Array.from(new Set(
    readingRows.flatMap((row) => (row.memberQuotes ?? []).map((quote) => quote.signalId)),
  ));
  const seenSignalIds = new Set(currentRow?.evidenceSignalIds ?? []);
  const fallbackEnd = currentRow?.evidenceSpanEnd ?? new Date(0);
  const sharedWhere = memberIds.length > 0
    ? and(inArray(signals.userId, memberIds), eq(signals.sharedToGroups, true))
    : null;
  const newWhere = sharedWhere && currentRow
    ? and(
        sharedWhere,
        seenSignalIds.size > 0
          ? notInArray(signals.id, [...seenSignalIds])
          : gt(signals.createdAt, fallbackEnd),
      )
    : sharedWhere;

  const [sharedCountRows, newCountRows, sharedSignalRows] = sharedWhere
    ? await Promise.all([
        db
          .select({
            count: sql<number>`cast(count(${signals.id}) as int)`,
            contributorCount: sql<number>`cast(count(distinct ${signals.userId}) as int)`,
          })
          .from(signals)
          .where(sharedWhere),
        db
          .select({
            count: sql<number>`cast(count(${signals.id}) as int)`,
            contributorCount: sql<number>`cast(count(distinct ${signals.userId}) as int)`,
          })
          .from(signals)
          .where(newWhere!),
        evidenceSignalIds.length > 0
          ? db
              .select({ id: signals.id, userId: signals.userId, text: signals.text })
              .from(signals)
              .where(and(sharedWhere, inArray(signals.id, evidenceSignalIds)))
          : Promise.resolve([]),
      ])
    : [[{ count: 0, contributorCount: 0 }], [{ count: 0, contributorCount: 0 }], []];
  const sharedSignalById = new Map(
    sharedSignalRows.map((signal) => [signal.id, { userId: signal.userId, text: signal.text }]),
  );

  const versionById = new Map(
    historyRows.map((row, index) => [row.id, index + 1]),
  );
  const history = historyRows
    .map((row) => readingSurface(
      row,
      versionById.get(row.id) ?? 1,
      memberNameById,
      sharedSignalById,
    ))
    .reverse();
  const current = currentRow
    ? readingSurface(
        currentRow,
        versionById.get(currentRow.id) ?? Math.max(historyRows.length, 1),
        memberNameById,
        sharedSignalById,
      )
    : null;
  const proposal = proposalRow
    ? readingSurface(
        proposalRow,
        historyRows.length + 1,
        memberNameById,
        sharedSignalById,
      )
    : null;

  const contributionWhere = currentRow && memberIds.length > 0
    ? and(
        eq(groupDirectionContributions.groupId, input.groupId),
        eq(groupDirectionContributions.readingId, currentRow.id),
        inArray(groupDirectionContributions.userId, memberIds),
      )
    : null;
  const [contributionRows, contributionCountRows] = contributionWhere
    ? await Promise.all([
        db
          .select({
            id: groupDirectionContributions.id,
            readingId: groupDirectionContributions.readingId,
            userId: groupDirectionContributions.userId,
            kind: groupDirectionContributions.kind,
            body: groupDirectionContributions.body,
            createdAt: groupDirectionContributions.createdAt,
            updatedAt: groupDirectionContributions.updatedAt,
          })
          .from(groupDirectionContributions)
          .where(contributionWhere)
          .orderBy(desc(groupDirectionContributions.createdAt))
          .limit(24),
        db
          .select({
            count: sql<number>`cast(count(distinct ${groupDirectionContributions.userId}) as int)`,
          })
          .from(groupDirectionContributions)
          .where(contributionWhere),
      ])
    : [[], [{ count: 0 }]];
  const contributions = contributionRows.flatMap((row) => {
    const memberName = memberNameById.get(row.userId);
    if (!memberName) return [];
    return [{
      ...row,
      memberName,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }];
  });

  const responseRows = proposalRow
    ? await db
        .select({
          userId: groupDirectionResponses.userId,
          value: groupDirectionResponses.value,
          updatedAt: groupDirectionResponses.updatedAt,
        })
        .from(groupDirectionResponses)
        .where(
          and(
            eq(groupDirectionResponses.groupId, input.groupId),
            eq(groupDirectionResponses.readingId, proposalRow.id),
          ),
        )
        .orderBy(asc(groupDirectionResponses.createdAt))
    : [];
  const responses = responseRows.flatMap((row) => {
    const memberName = memberNameById.get(row.userId);
    if (!memberName) return [];
    return [{
      userId: row.userId,
      memberName,
      value: row.value,
      updatedAt: row.updatedAt.toISOString(),
    }];
  });

  return {
    current,
    proposal,
    history,
    contributions,
    responses,
    memberCount: loaded.members.length,
    sharedInspirationCount: sharedCountRows[0]?.count ?? 0,
    sharedContributorCount: sharedCountRows[0]?.contributorCount ?? 0,
    newInspirationCount: newCountRows[0]?.count ?? 0,
    newContributorCount: newCountRows[0]?.contributorCount ?? 0,
    contributorCount: contributionCountRows[0]?.count ?? 0,
    requiredContributors: requiredDirectionContributors(loaded.members.length),
    requiredResponses: requiredDirectionResponses(loaded.members.length),
    viewerResponse:
      responses.find((response) => response.userId === input.userId)?.value ?? null,
  };
}

export type AddGroupDirectionContributionResult =
  | {
      ok: true;
      contribution: GroupDirectionContributionSurface;
      contributorCount: number;
      requiredContributors: number;
      updateReady: boolean;
    }
  | { ok: false; reason: "not_found" | "not_ready" };

export async function addGroupDirectionContribution(
  db: WakaDb,
  input: {
    userId: string;
    groupId: string;
    preferredLocale?: SupportedLocale;
    kind: GroupDirectionContributionKind;
    body: string;
  },
): Promise<AddGroupDirectionContributionResult> {
  const loaded = await loadGroupWithMembers(db, input);
  if (!loaded) return { ok: false, reason: "not_found" };
  const locale = normalizeSupportedLocale(input.preferredLocale);
  const [current] = await db
    .select({ id: combinationReadings.id })
    .from(combinationReadings)
    .innerJoin(combinations, eq(combinationReadings.combinationId, combinations.id))
    .where(
      and(
        eq(combinations.groupId, input.groupId),
        eq(combinationReadings.locale, locale),
        eq(combinationReadings.lifecycleStatus, "active"),
      ),
    )
    .orderBy(desc(combinationReadings.createdAt))
    .limit(1);
  // Formation is collaborative too. A shaping take can attach to the room's
  // active forming draft, then become high-intent input to the next read. The
  // old revealed-only gate made the first shared wording impossible to build
  // together and left forming rooms in a permanent dead end.
  if (!current) return { ok: false, reason: "not_ready" };

  const now = new Date();
  const [row] = await db
    .insert(groupDirectionContributions)
    .values({
      groupId: input.groupId,
      readingId: current.id,
      userId: input.userId,
      kind: input.kind,
      body: input.body.trim(),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!row) throw new Error("Failed to save room direction contribution");
  const memberIds = loaded.members.map((member) => member.userId);
  const [countRow] = await db
    .select({
      count: sql<number>`cast(count(distinct ${groupDirectionContributions.userId}) as int)`,
    })
    .from(groupDirectionContributions)
    .where(
      and(
        eq(groupDirectionContributions.groupId, input.groupId),
        eq(groupDirectionContributions.readingId, current.id),
        inArray(groupDirectionContributions.userId, memberIds),
      ),
    );
  const contributorCount = countRow?.count ?? 0;
  const requiredContributors = requiredDirectionContributors(memberIds.length);
  const memberName = loaded.members.find((member) => member.userId === input.userId)?.name ?? "Member";
  return {
    ok: true,
    contributorCount,
    requiredContributors,
    updateReady: contributorCount >= requiredContributors,
    contribution: {
      id: row.id,
      readingId: row.readingId,
      userId: row.userId,
      memberName,
      kind: row.kind,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
  };
}

export type RespondToGroupDirectionResult =
  | {
      ok: true;
      decision: "adopted" | "kept_current" | "pending";
    }
  | { ok: false; reason: "not_found" | "not_available" };

export async function respondToGroupDirectionProposal(
  db: WakaDb,
  input: {
    userId: string;
    groupId: string;
    proposalId: string;
    preferredLocale?: SupportedLocale;
    value: GroupDirectionResponseValue;
  },
): Promise<RespondToGroupDirectionResult> {
  const loaded = await loadGroupWithMembers(db, input);
  if (!loaded) return { ok: false, reason: "not_found" };
  const locale = normalizeSupportedLocale(input.preferredLocale);
  const [proposal] = await db
    .select({ id: combinationReadings.id })
    .from(combinationReadings)
    .innerJoin(combinations, eq(combinationReadings.combinationId, combinations.id))
    .where(
      and(
        eq(combinations.groupId, input.groupId),
        eq(combinationReadings.id, input.proposalId),
        eq(combinationReadings.locale, locale),
        eq(combinationReadings.lifecycleStatus, "proposed"),
      ),
    )
    .limit(1);
  if (!proposal) return { ok: false, reason: "not_available" };

  const memberIds = new Set(loaded.members.map((member) => member.userId));
  return await db.transaction(async (tx): Promise<RespondToGroupDirectionResult> => {
    /**
     * Serialize the whole review transition on the proposed reading. Without
     * this lock, two members crossing the quorum at the same instant could
     * both retire the active row; the second transaction would then retire the
     * newly adopted proposal too. A stale reviewer gets a settled-state answer
     * instead of mutating a version that has already moved on.
     */
    const [lockedProposal] = await tx
      .select({ lifecycleStatus: combinationReadings.lifecycleStatus })
      .from(combinationReadings)
      .where(eq(combinationReadings.id, proposal.id))
      .for("update")
      .limit(1);
    if (!lockedProposal) {
      return { ok: false, reason: "not_available" };
    }
    if (lockedProposal.lifecycleStatus === "active") {
      return { ok: true, decision: "adopted" };
    }
    if (lockedProposal.lifecycleStatus === "rejected") {
      return { ok: true, decision: "kept_current" };
    }
    if (lockedProposal.lifecycleStatus !== "proposed") {
      return { ok: false, reason: "not_available" };
    }

    const now = new Date();
    await tx
      .insert(groupDirectionResponses)
      .values({
        groupId: input.groupId,
        readingId: proposal.id,
        userId: input.userId,
        value: input.value,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [groupDirectionResponses.readingId, groupDirectionResponses.userId],
        set: { value: input.value, updatedAt: now },
      });

    const responseRows = await tx
      .select({ userId: groupDirectionResponses.userId, value: groupDirectionResponses.value })
      .from(groupDirectionResponses)
      .where(eq(groupDirectionResponses.readingId, proposal.id));
    const currentResponses = responseRows.filter((response) => memberIds.has(response.userId));
    const decision = directionReviewDecision({
      memberCount: memberIds.size,
      acceptCount: currentResponses.filter((response) => response.value === "accept").length,
      keepCurrentCount: currentResponses.filter((response) => response.value === "keep_current").length,
    });

    if (decision === "pending") return { ok: true, decision };

    if (decision === "kept_current") {
      await tx
        .update(combinationReadings)
        .set({ lifecycleStatus: "rejected", updatedAt: now })
        .where(
          and(
            eq(combinationReadings.id, proposal.id),
            eq(combinationReadings.lifecycleStatus, "proposed"),
          ),
        );
      return { ok: true, decision };
    }

    const activeRows = await tx
      .select({ id: combinationReadings.id })
      .from(combinationReadings)
      .innerJoin(combinations, eq(combinationReadings.combinationId, combinations.id))
      .where(
        and(
          eq(combinations.groupId, input.groupId),
          eq(combinationReadings.locale, locale),
          eq(combinationReadings.lifecycleStatus, "active"),
        ),
      );
    const replacedAt = new Date();
    if (activeRows.length > 0) {
      await tx
        .update(combinationReadings)
        .set({
          lifecycleStatus: "replaced",
          replacedAt,
          replacedByReadingId: proposal.id,
          updatedAt: replacedAt,
        })
        .where(inArray(combinationReadings.id, activeRows.map((row) => row.id)));
    }
    await tx
      .update(combinationReadings)
      .set({ lifecycleStatus: "active", updatedAt: replacedAt })
      .where(
        and(
          eq(combinationReadings.id, proposal.id),
          eq(combinationReadings.lifecycleStatus, "proposed"),
        ),
      );
    return { ok: true, decision };
  });
}
