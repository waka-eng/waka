import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import {
  attachments,
  feedback,
  groupMembers,
  groupTopOfMindNoteSignals,
  groupTopOfMindNotes,
  groups,
  inspirationSparks,
  inspirations,
  meaningEvidence,
  meaningNodes,
  meaningPackets,
  wowMomentInspirations,
  wowMoments,
} from "../db/index.js";
import { normalizeContextNodeType } from "../lib/context-node-types.js";
import { getDb } from "../lib/db.js";
import { calculateDisplayedInspirationScore } from "../lib/inspiration-scores.js";
import { type AuthEnv, requireAuth } from "../lib/middleware.js";
import { withSignalLayer } from "../lib/signals.js";
import { topOfMindNoteTypeFromWowMoment } from "../lib/top-of-mind-notes.js";

const DEFAULT_SIGNAL_ARCHIVE_LIMIT = 80;
const MAX_SIGNAL_ARCHIVE_LIMIT = 200;
const MAX_PREVIEW_LENGTH = 220;

const signalArchiveQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    filter: z
      .enum([
        "all",
        "highlighted",
        "high_resonance",
        "tensions",
        "questions",
        "people_places",
        "recently_resurfaced",
      ])
      .optional(),
    sort: z.enum(["recent", "resonance", "revisited"]).optional(),
    limit: z
      .string()
      .regex(/^\d+$/, "limit must be an integer")
      .transform((value) => Number.parseInt(value, 10))
      .pipe(z.number().int().min(1).max(MAX_SIGNAL_ARCHIVE_LIMIT))
      .optional(),
  })
  .strict();

const signalParamsSchema = z.object({
  signalId: z.string().uuid("signalId must be a uuid"),
});

type WakaDb = ReturnType<typeof getDb>;

export type SignalArchiveFilter = NonNullable<z.infer<typeof signalArchiveQuerySchema>["filter"]>;
export type SignalArchiveSort = NonNullable<z.infer<typeof signalArchiveQuerySchema>["sort"]>;

export interface SignalArchiveListInput {
  userId: string;
  query?: string;
  filter: SignalArchiveFilter;
  sort: SignalArchiveSort;
  limit: number;
}

export interface SavedSignalSearchResult {
  id: string;
  userId: string;
  textPreview: string;
  kind: string | null;
  capturedAt: string;
  updatedAt: string;
  /**
   * Whether the rooms this person is in may read this save.
   *
   * On the list so the archive can show and change it in place. Without it the
   * only way to find out was to open a save one at a time, which made a
   * privacy setting something you could not audit.
   */
  shared: boolean;
  resonanceScore: number;
  signalScores: Record<string, number>;
  highlightedSnippets: Array<{
    id: string;
    text: string;
    source: string;
    confidence: number;
    isPrimary: boolean;
  }>;
  matchingSnippets: string[];
  relatedContextTerms: string[];
  relatedTopOfMindNoteTitles: string[];
  /** Group boards this signal fed, newest first: where else it led. */
  relatedGroupNotes: Array<{ groupId: string; groupName: string; noteTitle: string }>;
  attachmentSummary: Array<{
    id: string;
    type: "link" | "image" | "file";
    label: string;
  }>;
  relevanceReasons: string[];
}

export interface SavedSignalDetail extends SavedSignalSearchResult {
  rawText: string;
  attachments: Array<{
    id: string;
    type: "link" | "image" | "file";
    url?: string;
    label: string;
    contentType: string | null;
    size: number | null;
  }>;
  resonanceFeedback: Array<{
    id: string;
    value: string;
    emotionLabel: string | null;
    correctionText: string | null;
    createdAt: string;
  }>;
  signalPacket: {
    id: string;
    text: string;
    primarySpark: string;
    artifactExcerpt: string;
    updatedAt: string;
  } | null;
  relatedContextNodes: Array<{
    id: string;
    type: string;
    label: string;
    description: string;
    confidence: number;
    evidenceReason: string;
  }>;
  relatedTopOfMindNotes: Array<{
    id: string;
    title: string;
    type: string;
    body: string;
    confidence: number;
    status: "active";
  }>;
}

export interface SignalArchiveRoutesDependencies {
  getDatabase?: typeof getDb;
  listSignals?: (db: WakaDb, input: SignalArchiveListInput) => Promise<SavedSignalSearchResult[]>;
  getSignal?: (db: WakaDb, input: { userId: string; signalId: string }) => Promise<SavedSignalDetail | null>;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
}

function truncatePreview(value: string, maxLength = MAX_PREVIEW_LENGTH): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function includesQuery(values: string[], query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return values.some((value) => value.toLowerCase().includes(normalized));
}

function attachmentLabel(row: {
  type: "link" | "image" | "file";
  url: string;
  name: string | null;
  hostname: string | null;
  title: string | null;
}): string {
  if (row.type === "link") return row.title || row.hostname || row.name || row.url;
  return row.name || row.type;
}

function matchSnippet(values: string[], query?: string): string[] {
  const normalized = query?.trim().toLowerCase();
  if (!normalized) return [];
  const hit = values.find((value) => value.toLowerCase().includes(normalized));
  return hit ? [truncatePreview(hit, 160)] : [];
}

type BaseSignalRow = {
  id: string;
  userId: string;
  text: string;
  kind: string | null;
  category: number | null;
  importanceScore: number;
  wowScore: number;
  cluster: any;
  classifiedAt: Date | null;
  sharedToGroups: boolean;
  createdAt: Date;
  updatedAt: Date;
};

async function fetchArchiveRows(db: WakaDb, userId: string, limit: number) {
  const rows = await db
    .select({
      id: inspirations.id,
      userId: inspirations.userId,
      text: inspirations.text,
      kind: inspirations.kind,
      category: inspirations.category,
      importanceScore: inspirations.importanceScore,
      wowScore: inspirations.wowScore,
      cluster: inspirations.cluster,
      classifiedAt: inspirations.classifiedAt,
      sharedToGroups: inspirations.sharedToGroups,
      createdAt: inspirations.createdAt,
      updatedAt: inspirations.updatedAt,
    })
    .from(inspirations)
    .where(eq(inspirations.userId, userId))
    .orderBy(desc(inspirations.createdAt))
    .limit(Math.min(MAX_SIGNAL_ARCHIVE_LIMIT, Math.max(limit * 3, limit)));
  return rows as BaseSignalRow[];
}

async function buildSignalResultMaps(db: WakaDb, userId: string, signalIds: string[]) {
  if (signalIds.length === 0) {
    return {
      sparksBySignal: new Map<string, any[]>(),
      contextBySignal: new Map<string, any[]>(),
      topNotesBySignal: new Map<string, any[]>(),
      groupNotesBySignal: new Map<string, any[]>(),
      attachmentsBySignal: new Map<string, any[]>(),
    };
  }

  const [sparkRows, contextRows, topNoteRows, groupNoteRows, attachmentRows] =
    await Promise.all([
    db
      .select({
        id: inspirationSparks.id,
        inspirationId: inspirationSparks.inspirationId,
        text: inspirationSparks.text,
        source: inspirationSparks.source,
        confidence: inspirationSparks.confidence,
        isPrimary: inspirationSparks.isPrimary,
      })
      .from(inspirationSparks)
      .where(and(eq(inspirationSparks.userId, userId), inArray(inspirationSparks.inspirationId, signalIds))),
    db
      .select({
        inspirationId: meaningEvidence.inspirationId,
        nodeId: meaningNodes.id,
        type: meaningNodes.type,
        label: meaningNodes.label,
        description: meaningNodes.description,
        confidence: meaningNodes.confidence,
        reason: meaningEvidence.reason,
      })
      .from(meaningEvidence)
      .innerJoin(meaningNodes, and(eq(meaningNodes.id, meaningEvidence.meaningNodeId), eq(meaningNodes.userId, userId)))
      .where(and(eq(meaningEvidence.userId, userId), inArray(meaningEvidence.inspirationId, signalIds))),
    db
      .select({
        inspirationId: wowMomentInspirations.inspirationId,
        id: wowMoments.id,
        title: wowMoments.title,
        kind: wowMoments.kind,
        why: wowMoments.why,
        confidence: wowMoments.wowScore,
      })
      .from(wowMomentInspirations)
      .innerJoin(wowMoments, and(eq(wowMoments.id, wowMomentInspirations.wowMomentId), eq(wowMoments.userId, userId)))
      .where(and(eq(wowMomentInspirations.userId, userId), inArray(wowMomentInspirations.inspirationId, signalIds))),
    /**
     * Which group boards this signal fed, and what they made of it.
     *
     * The same fact as the solo query beside it, on the other side of the
     * product's claim: a save can produce one reading alone and another
     * beside other people. Scoped to rooms the viewer is still in, and to
     * readings those rooms currently hold, so a departed room or a retired
     * note stops being claimed.
     */
    db
      .select({
        inspirationId: groupTopOfMindNoteSignals.signalId,
        id: groupTopOfMindNotes.id,
        title: groupTopOfMindNotes.title,
        groupId: groups.id,
        groupName: groups.name,
      })
      .from(groupTopOfMindNoteSignals)
      .innerJoin(
        groupTopOfMindNotes,
        eq(groupTopOfMindNoteSignals.groupTopOfMindNoteId, groupTopOfMindNotes.id),
      )
      .innerJoin(groups, eq(groupTopOfMindNotes.groupId, groups.id))
      .innerJoin(
        groupMembers,
        and(eq(groupMembers.groupId, groups.id), eq(groupMembers.userId, userId)),
      )
      .where(
        and(
          inArray(groupTopOfMindNoteSignals.signalId, signalIds),
          eq(groupTopOfMindNoteSignals.ownerUserId, userId),
          eq(groupTopOfMindNotes.lifecycleStatus, "active"),
        ),
      ),
    db
      .select({
        id: attachments.id,
        inspirationId: attachments.inspirationId,
        type: attachments.type,
        url: attachments.url,
        name: attachments.name,
        contentType: attachments.contentType,
        size: attachments.size,
        hostname: attachments.hostname,
        title: attachments.title,
      })
      .from(attachments)
      .where(inArray(attachments.inspirationId, signalIds)),
  ]);

  const group = <T extends { inspirationId: string }>(rows: T[]) => {
    const out = new Map<string, T[]>();
    for (const row of rows) {
      const bucket = out.get(row.inspirationId) ?? [];
      bucket.push(row);
      out.set(row.inspirationId, bucket);
    }
    return out;
  };

  return {
    sparksBySignal: group(sparkRows),
    contextBySignal: group(contextRows),
    topNotesBySignal: group(topNoteRows),
    groupNotesBySignal: group(groupNoteRows),
    attachmentsBySignal: group(attachmentRows),
  };
}

function serializeSearchResult(
  row: BaseSignalRow,
  maps: Awaited<ReturnType<typeof buildSignalResultMaps>>,
  query?: string,
): SavedSignalSearchResult {
  const signal = withSignalLayer({
    ...row,
    wowScore: calculateDisplayedInspirationScore({
      coreWowScore: row.wowScore,
      createdAt: row.createdAt,
    }),
  });
  const sparks = maps.sparksBySignal.get(row.id) ?? [];
  const context = maps.contextBySignal.get(row.id) ?? [];
  const topNotes = maps.topNotesBySignal.get(row.id) ?? [];
  const attachmentRows = maps.attachmentsBySignal.get(row.id) ?? [];
  const contextTerms = [...new Set(context.map((node) => node.label))].slice(0, 6);
  const topNoteTitles = [...new Set(topNotes.map((note) => note.title))].slice(0, 4);
  const groupNotes = (maps.groupNotesBySignal.get(row.id) ?? [])
    .map((note: any) => ({
      groupId: note.groupId as string,
      groupName: note.groupName as string,
      noteTitle: note.title as string,
    }))
    .slice(0, 4);
  const haystack = [
    row.text,
    ...sparks.map((spark) => spark.text),
    ...context.map((node) => `${node.label} ${node.description}`),
    ...topNotes.map((note) => `${note.title} ${note.why}`),
  ];
  const reasons = new Set<string>();
  if (query && includesQuery([row.text], query)) reasons.add("raw text match");
  if (query && includesQuery(sparks.map((spark) => spark.text), query)) reasons.add("highlight match");
  if (query && includesQuery(contextTerms, query)) reasons.add("context match");
  if (signal.signalScores.resonance >= 70) reasons.add("high resonance");
  if (sparks.length > 0) reasons.add("has highlighted snippets");
  if (topNotes.length > 0) reasons.add("influenced top-of-mind notes");

  return {
    id: row.id,
    userId: row.userId,
    textPreview: truncatePreview(row.text),
    kind: row.kind,
    capturedAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    shared: row.sharedToGroups,
    resonanceScore: signal.signalScores.resonance,
    signalScores: signal.signalScores,
    highlightedSnippets: sparks.slice(0, 4).map((spark) => ({
      id: spark.id,
      text: spark.text,
      source: spark.source,
      confidence: spark.confidence,
      isPrimary: spark.isPrimary,
    })),
    matchingSnippets: matchSnippet(haystack, query),
    relatedContextTerms: contextTerms,
    relatedTopOfMindNoteTitles: topNoteTitles,
    relatedGroupNotes: groupNotes,
    attachmentSummary: attachmentRows.slice(0, 3).map((attachment) => ({
      id: attachment.id,
      type: attachment.type,
      label: attachmentLabel(attachment),
      ...(attachment.type === "link" && attachment.url ? { url: attachment.url } : {}),
    })),
    relevanceReasons: [...reasons].slice(0, 4),
  };
}

function passesFilter(result: SavedSignalSearchResult, filter: SignalArchiveFilter): boolean {
  if (filter === "all") return true;
  if (filter === "highlighted") return result.highlightedSnippets.length > 0;
  if (filter === "high_resonance") return result.resonanceScore >= 70;
  if (filter === "tensions") {
    return result.relatedContextTerms.some((term) => term.toLowerCase().includes("tension"));
  }
  if (filter === "questions") {
    return result.relatedContextTerms.some((term) => term.includes("?") || term.toLowerCase().includes("question"));
  }
  if (filter === "people_places") {
    return result.relatedContextTerms.some((term) => /person|people|place|room|environment/i.test(term));
  }
  return (
    result.relatedTopOfMindNoteTitles.length > 0 ||
    result.relatedGroupNotes.length > 0
  );
}

function sortResults(results: SavedSignalSearchResult[], sort: SignalArchiveSort): SavedSignalSearchResult[] {
  return [...results].sort((a, b) => {
    if (sort === "resonance") return b.resonanceScore - a.resonanceScore;
    if (sort === "revisited") {
      return (
        b.relatedTopOfMindNoteTitles.length +
        b.relatedGroupNotes.length -
        (a.relatedTopOfMindNoteTitles.length + a.relatedGroupNotes.length)
      );
    }
    return new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime();
  });
}

export async function listSavedSignals(
  db: WakaDb,
  input: SignalArchiveListInput,
): Promise<SavedSignalSearchResult[]> {
  const rows = await fetchArchiveRows(db, input.userId, input.limit);
  const maps = await buildSignalResultMaps(db, input.userId, rows.map((row) => row.id));
  const query = input.query?.trim();
  const results = rows
    .map((row) => serializeSearchResult(row, maps, query))
    .filter((result) => {
      if (query) {
        const values = [
          result.textPreview,
          ...result.highlightedSnippets.map((snippet) => snippet.text),
          ...result.relatedContextTerms,
          ...result.relatedTopOfMindNoteTitles,
          ...result.relatedGroupNotes.map((note) => `${note.groupName} ${note.noteTitle}`),
        ];
        if (!includesQuery(values, query)) return false;
      }
      return passesFilter(result, input.filter);
    });
  return sortResults(results, input.sort).slice(0, input.limit);
}

export async function getSavedSignal(
  db: WakaDb,
  input: { userId: string; signalId: string },
): Promise<SavedSignalDetail | null> {
  const [row] = await db
    .select({
      id: inspirations.id,
      userId: inspirations.userId,
      text: inspirations.text,
      kind: inspirations.kind,
      category: inspirations.category,
      importanceScore: inspirations.importanceScore,
      wowScore: inspirations.wowScore,
      cluster: inspirations.cluster,
      classifiedAt: inspirations.classifiedAt,
      sharedToGroups: inspirations.sharedToGroups,
      createdAt: inspirations.createdAt,
      updatedAt: inspirations.updatedAt,
    })
    .from(inspirations)
    .where(and(eq(inspirations.userId, input.userId), eq(inspirations.id, input.signalId)))
    .limit(1);

  if (!row) return null;
  const maps = await buildSignalResultMaps(db, input.userId, [input.signalId]);
  const base = serializeSearchResult(row as BaseSignalRow, maps);
  const [packet] = await db
    .select({
      id: meaningPackets.id,
      packetText: meaningPackets.packetText,
      sparkText: meaningPackets.sparkText,
      artifactExcerpt: meaningPackets.artifactExcerpt,
      updatedAt: meaningPackets.updatedAt,
    })
    .from(meaningPackets)
    .where(and(eq(meaningPackets.userId, input.userId), eq(meaningPackets.inspirationId, input.signalId)))
    .limit(1);
  const feedbackRows = await db
    .select({
      id: feedback.id,
      value: feedback.value,
      emotionLabel: feedback.emotionLabel,
      correctionText: feedback.correctionText,
      createdAt: feedback.createdAt,
    })
    .from(feedback)
    .where(and(eq(feedback.userId, input.userId), eq(feedback.targetType, "signal"), eq(feedback.targetId, input.signalId)))
    .orderBy(desc(feedback.createdAt));

  return {
    ...base,
    rawText: row.text,
    attachments: (maps.attachmentsBySignal.get(input.signalId) ?? []).map((attachment) => ({
      id: attachment.id,
      type: attachment.type,
      ...(attachment.type === "link" ? { url: attachment.url } : {}),
      label: attachmentLabel(attachment),
      contentType: attachment.contentType,
      size: attachment.size,
    })),
    resonanceFeedback: feedbackRows.map((item) => ({
      id: item.id,
      value: item.value,
      emotionLabel: item.emotionLabel,
      correctionText: item.correctionText,
      createdAt: item.createdAt.toISOString(),
    })),
    signalPacket: packet
      ? {
          id: packet.id,
          text: packet.packetText,
          primarySpark: packet.sparkText,
          artifactExcerpt: packet.artifactExcerpt,
          updatedAt: packet.updatedAt.toISOString(),
        }
      : null,
    relatedContextNodes: (maps.contextBySignal.get(input.signalId) ?? []).map((node) => ({
      id: node.nodeId,
      type: normalizeContextNodeType(node.type),
      label: node.label,
      description: node.description,
      confidence: node.confidence,
      evidenceReason: node.reason,
    })),
    relatedTopOfMindNotes: (maps.topNotesBySignal.get(input.signalId) ?? []).map((note) => ({
      id: note.id,
      title: note.title,
      type: topOfMindNoteTypeFromWowMoment({ kind: note.kind }),
      body: note.why,
      confidence: note.confidence,
      status: "active" as const,
    })),
  };
}

export function createSignalArchiveRoutes(
  deps: SignalArchiveRoutesDependencies = {},
): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  const listSignals = deps.listSignals ?? listSavedSignals;
  const getSignal = deps.getSignal ?? getSavedSignal;

  routes.use("*", deps.authMiddleware ?? requireAuth);

  routes.get("/", async (c) => {
    const parsedQuery = signalArchiveQuerySchema.safeParse(c.req.query());
    if (!parsedQuery.success) {
      return c.json(
        {
          error: "Invalid signal archive query",
          details: parsedQuery.error.flatten().fieldErrors,
        },
        400,
      );
    }
    const input = {
      userId: c.get("user").id,
      query: parsedQuery.data.q,
      filter: parsedQuery.data.filter ?? "all",
      sort: parsedQuery.data.sort ?? "recent",
      limit: parsedQuery.data.limit ?? DEFAULT_SIGNAL_ARCHIVE_LIMIT,
    } satisfies SignalArchiveListInput;
    const signals = await listSignals(getDatabase(), input);
    return c.json({ signals }, 200);
  });

  routes.get("/:signalId", async (c) => {
    const parsedParams = signalParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) {
      return c.json(
        {
          error: "Invalid signal id",
          details: parsedParams.error.flatten().fieldErrors,
        },
        400,
      );
    }
    const signal = await getSignal(getDatabase(), {
      userId: c.get("user").id,
      signalId: parsedParams.data.signalId,
    });
    if (!signal) return c.json({ error: "Signal not found" }, 404);
    return c.json({ signal }, 200);
  });

  return routes;
}

export const signalArchiveRoutes = createSignalArchiveRoutes();
