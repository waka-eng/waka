/**
 * Vault exporter — Phase 1 of the Vault & Index migration.
 *
 * Reads existing content rows (read-only — the exporter never writes to the
 * database) and materializes them as OKF markdown documents in a VaultStore.
 * Safe to run repeatedly: output is deterministic, so re-exporting unchanged
 * rows rewrites byte-identical files.
 *
 * Besides the concept documents the exporter writes the two OKF reserved
 * files at the bundle root:
 *   - index.md — progressive-disclosure listing of the bundle's layers
 *   - log.md   — the temporal stream (captures, sparks, emergences,
 *     relations) grouped by ISO date, newest first. This is the vault's
 *     inner-time-consciousness view: one file that reads as "how I changed
 *     over time".
 *
 * The DB access is hidden behind VaultExportSource so the exporter itself is
 * pure and unit-testable; createDrizzleVaultExportSource adapts the real
 * Drizzle client.
 */

import { asc, eq, inArray } from "drizzle-orm";

import {
  attachments,
  contextEdges,
  contextEvidence,
  contextNodes,
  reflections,
  signalPackets,
  signalSparks,
  signals,
  topOfMindNotes,
  topOfMindNoteSignals,
  users,
} from "../db/index.js";
import type { getDb } from "../lib/db.js";
import {
  buildContextEdgeDoc,
  buildContextNodeDoc,
  buildSignalDoc,
  buildTopOfMindNoteDoc,
  contextEdgeVaultPath,
  contextNodeVaultPath,
  signalVaultPath,
  topOfMindNoteVaultPath,
  toOkfMarkdown,
  type ContextEdgeExport,
  type ContextNodeExport,
  type SignalExport,
  type TopOfMindNoteExport,
} from "./serialize.js";
import type { VaultStore } from "./vault.js";

export interface VaultExportSource {
  listUserIds(): Promise<string[]>;
  listSignals(userId: string): Promise<SignalExport[]>;
  listTopOfMindNotes(userId: string): Promise<TopOfMindNoteExport[]>;
  listContextNodes(userId: string): Promise<ContextNodeExport[]>;
  listContextEdges(userId: string): Promise<ContextEdgeExport[]>;
}

export interface ExportedDocument {
  path: string;
  contentHash: string;
}

export interface VaultExportSummary {
  userId: string;
  signals: ExportedDocument[];
  topOfMindNotes: ExportedDocument[];
  contextNodes: ExportedDocument[];
  contextEdges: ExportedDocument[];
  /** OKF reserved bundle files: index.md and log.md at the user root. */
  bundle: ExportedDocument[];
}

// ---------------------------------------------------------------------------
// Bundle files (OKF reserved: index.md §6, log.md §7)
// ---------------------------------------------------------------------------

/**
 * Make a text safe for a markdown link label: collapse whitespace, strip
 * link-breaking characters, and truncate. Deterministic by construction.
 */
function linkLabel(text: string, maxLength = 60): string {
  const collapsed = text.replace(/[\[\]()]/g, "").replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) return collapsed || "untitled";
  return `${collapsed.slice(0, maxLength).trimEnd()}…`;
}

/** Per OKF §6 index files contain no frontmatter — sections + entries only. */
function buildBundleIndexMarkdown(): string {
  return [
    "# WAKA Vault",
    "",
    "One person's captured meaning as an Open Knowledge Format bundle.",
    "",
    "- [signals/](signals/) - Episodic memory: captured signals, partitioned by YYYY/MM (UTC).",
    "- [top-of-mind/](top-of-mind/) - Sparks: judged connections between signals, partitioned by YYYY/MM (UTC).",
    "- [context/nodes/](context/nodes/) - Long-term memory: durable claims about who the user is becoming.",
    "- [context/edges/](context/edges/) - Long-term memory: relationships between context claims.",
    "- [log.md](log.md) - The temporal stream: captures, sparks, emergences, and relations, newest day first.",
    "",
  ].join("\n");
}

interface LogEvent {
  at: Date;
  entry: string;
}

/**
 * Build the OKF §7 update log for one user's bundle. Entries are grouped by
 * ISO date (newest first); within a day they run in the order they happened.
 * Links are relative to the bundle root, where log.md lives.
 */
function buildBundleLogMarkdown(input: {
  userId: string;
  signals: SignalExport[];
  topOfMindNotes: TopOfMindNoteExport[];
  contextNodes: ContextNodeExport[];
  contextEdges: ContextEdgeExport[];
}): string {
  const relative = (path: string) => path.slice(input.userId.length + 1);
  const events: LogEvent[] = [];

  for (const { signal } of input.signals) {
    const path = relative(signalVaultPath(input.userId, signal.id, signal.createdAt));
    events.push({
      at: signal.createdAt,
      entry: `- **Capture**: [${linkLabel(signal.text)}](${path})`,
    });
  }
  for (const { note } of input.topOfMindNotes) {
    const path = relative(topOfMindNoteVaultPath(input.userId, note.id, note.createdAt));
    events.push({
      at: note.createdAt,
      entry: `- **Spark**: [${linkLabel(note.title)}](${path})`,
    });
  }
  for (const { node } of input.contextNodes) {
    const path = relative(contextNodeVaultPath(node));
    events.push({
      at: node.firstSeenAt,
      entry: `- **Emergence**: [${node.type}: ${linkLabel(node.label)}](${path})`,
    });
  }
  for (const item of input.contextEdges) {
    const path = relative(contextEdgeVaultPath(item));
    const label = `${linkLabel(item.sourceNode.label, 40)} ${item.edge.kind} ${linkLabel(item.targetNode.label, 40)}`;
    events.push({
      at: item.edge.createdAt,
      entry: `- **Relation**: [${label}](${path})`,
    });
  }

  const byDay = new Map<string, LogEvent[]>();
  for (const event of events) {
    const day = event.at.toISOString().slice(0, 10);
    const bucket = byDay.get(day);
    if (bucket) bucket.push(event);
    else byDay.set(day, [event]);
  }

  const lines = ["# Directory Update Log"];
  for (const day of [...byDay.keys()].sort().reverse()) {
    lines.push("", `## ${day}`, "");
    const dayEvents = byDay.get(day)!;
    dayEvents.sort(
      (a, b) => a.at.getTime() - b.at.getTime() || a.entry.localeCompare(b.entry),
    );
    for (const event of dayEvents) lines.push(event.entry);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Export one user's content into the vault. Returns the paths and content
 * hashes of everything written (the future `documents` index rows are
 * derived from exactly these pairs).
 */
export async function exportUserVault(options: {
  source: VaultExportSource;
  vault: VaultStore;
  userId: string;
}): Promise<VaultExportSummary> {
  const { source, vault, userId } = options;

  const signalItems = await source.listSignals(userId);
  const signalDocs: ExportedDocument[] = [];
  for (const item of signalItems) {
    const path = signalVaultPath(
      userId,
      item.signal.id,
      item.signal.createdAt,
    );
    const { contentHash } = await vault.put(path, toOkfMarkdown(buildSignalDoc(item)));
    signalDocs.push({ path, contentHash });
  }

  const noteItems = await source.listTopOfMindNotes(userId);
  const topOfMindNoteDocs: ExportedDocument[] = [];
  for (const item of noteItems) {
    const path = topOfMindNoteVaultPath(userId, item.note.id, item.note.createdAt);
    const { contentHash } = await vault.put(path, toOkfMarkdown(buildTopOfMindNoteDoc(item)));
    topOfMindNoteDocs.push({ path, contentHash });
  }

  const nodeItems = await source.listContextNodes(userId);
  const contextNodeDocs: ExportedDocument[] = [];
  for (const item of nodeItems) {
    const path = contextNodeVaultPath(item.node);
    const { contentHash } = await vault.put(path, toOkfMarkdown(buildContextNodeDoc(item)));
    contextNodeDocs.push({ path, contentHash });
  }

  const edgeItems = await source.listContextEdges(userId);
  const contextEdgeDocs: ExportedDocument[] = [];
  for (const item of edgeItems) {
    const path = contextEdgeVaultPath(item);
    const { contentHash } = await vault.put(path, toOkfMarkdown(buildContextEdgeDoc(item)));
    contextEdgeDocs.push({ path, contentHash });
  }

  const bundleDocs: ExportedDocument[] = [];
  const indexPath = `${userId}/index.md`;
  const indexResult = await vault.put(indexPath, buildBundleIndexMarkdown());
  bundleDocs.push({ path: indexPath, contentHash: indexResult.contentHash });

  const logPath = `${userId}/log.md`;
  const logResult = await vault.put(
    logPath,
    buildBundleLogMarkdown({
      userId,
      signals: signalItems,
      topOfMindNotes: noteItems,
      contextNodes: nodeItems,
      contextEdges: edgeItems,
    }),
  );
  bundleDocs.push({ path: logPath, contentHash: logResult.contentHash });

  return {
    userId,
    signals: signalDocs,
    topOfMindNotes: topOfMindNoteDocs,
    contextNodes: contextNodeDocs,
    contextEdges: contextEdgeDocs,
    bundle: bundleDocs,
  };
}

type Db = ReturnType<typeof getDb>;

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = map.get(k);
    if (bucket) bucket.push(row);
    else map.set(k, [row]);
  }
  return map;
}

/**
 * Adapt the live Drizzle client. Child rows are fetched per user with a
 * single `inArray` query per table and grouped in memory — fine for a
 * backfill tool, and it keeps the row shape identical to the schema types
 * the serializers expect.
 */
export function createDrizzleVaultExportSource(db: Db): VaultExportSource {
  return {
    async listUserIds() {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .orderBy(asc(users.createdAt));
      return rows.map((row) => row.id);
    },

    async listSignals(userId) {
      const rows = await db
        .select()
        .from(signals)
        .where(eq(signals.userId, userId))
        .orderBy(asc(signals.createdAt));
      if (rows.length === 0) return [];
      const ids = rows.map((row) => row.id);

      const [sparkRows, packetRows, reflectionRows, attachmentRows] = await Promise.all([
        db
          .select()
          .from(signalSparks)
          .where(inArray(signalSparks.inspirationId, ids))
          .orderBy(asc(signalSparks.createdAt)),
        db
          .select()
          .from(signalPackets)
          .where(inArray(signalPackets.inspirationId, ids))
          .orderBy(asc(signalPackets.updatedAt)),
        db
          .select()
          .from(reflections)
          .where(inArray(reflections.inspirationId, ids))
          .orderBy(asc(reflections.createdAt)),
        db
          .select()
          .from(attachments)
          .where(inArray(attachments.inspirationId, ids))
          .orderBy(asc(attachments.createdAt)),
      ]);

      const sparksByInspiration = groupBy(sparkRows, (row) => row.inspirationId);
      const packetsByInspiration = new Map(
        packetRows.map((row) => [row.inspirationId, row]),
      );
      const reflectionsByInspiration = groupBy(
        reflectionRows,
        (row) => row.inspirationId,
      );
      const attachmentsByInspiration = groupBy(
        attachmentRows,
        (row) => row.inspirationId,
      );

      return rows.map((signal) => ({
        signal,
        sparks: sparksByInspiration.get(signal.id) ?? [],
        packet: packetsByInspiration.get(signal.id) ?? null,
        reflections: reflectionsByInspiration.get(signal.id) ?? [],
        attachments: attachmentsByInspiration.get(signal.id) ?? [],
      }));
    },

    async listTopOfMindNotes(userId) {
      const rows = await db
        .select()
        .from(topOfMindNotes)
        .where(eq(topOfMindNotes.userId, userId))
        .orderBy(asc(topOfMindNotes.createdAt));
      if (rows.length === 0) return [];
      const ids = rows.map((row) => row.id);

      const linkRows = await db
        .select()
        .from(topOfMindNoteSignals)
        .where(inArray(topOfMindNoteSignals.wowMomentId, ids))
        .orderBy(asc(topOfMindNoteSignals.sortOrder));
      const linksByMoment = groupBy(linkRows, (row) => row.wowMomentId);

      return rows.map((note) => ({
        note,
        links: linksByMoment.get(note.id) ?? [],
      }));
    },

    async listContextNodes(userId) {
      const rows = await db
        .select()
        .from(contextNodes)
        .where(eq(contextNodes.userId, userId))
        .orderBy(asc(contextNodes.type), asc(contextNodes.label));
      if (rows.length === 0) return [];
      const ids = rows.map((row) => row.id);

      const evidenceRows = await db
        .select()
        .from(contextEvidence)
        .where(inArray(contextEvidence.meaningNodeId, ids))
        .orderBy(asc(contextEvidence.createdAt));
      const evidenceByNode = groupBy(evidenceRows, (row) => row.meaningNodeId);

      return rows.map((node) => ({
        node,
        evidence: evidenceByNode.get(node.id) ?? [],
      }));
    },

    async listContextEdges(userId) {
      const rows = await db
        .select()
        .from(contextEdges)
        .where(eq(contextEdges.userId, userId))
        .orderBy(asc(contextEdges.kind), asc(contextEdges.createdAt));
      if (rows.length === 0) return [];

      const nodeIds = [
        ...new Set(rows.flatMap((row) => [row.sourceNodeId, row.targetNodeId])),
      ];
      const nodeRows = await db
        .select()
        .from(contextNodes)
        .where(inArray(contextNodes.id, nodeIds));
      const nodeById = new Map(nodeRows.map((node) => [node.id, node]));

      return rows.flatMap((edge) => {
        const sourceNode = nodeById.get(edge.sourceNodeId);
        const targetNode = nodeById.get(edge.targetNodeId);
        if (!sourceNode || !targetNode) return [];
        return [{ edge, sourceNode, targetNode }];
      });
    },
  };
}
