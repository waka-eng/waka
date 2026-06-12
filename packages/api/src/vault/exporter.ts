/**
 * Vault exporter — Phase 1 of the Vault & Index migration.
 *
 * Reads existing content rows (read-only — the exporter never writes to the
 * database) and materializes them as YAML documents in a VaultStore. Safe to
 * run repeatedly: output is deterministic, so re-exporting unchanged rows
 * rewrites byte-identical files.
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
  toYaml,
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

  const signalDocs: ExportedDocument[] = [];
  for (const item of await source.listSignals(userId)) {
    const path = signalVaultPath(
      userId,
      item.signal.id,
      item.signal.createdAt,
    );
    const { contentHash } = await vault.put(path, toYaml(buildSignalDoc(item)));
    signalDocs.push({ path, contentHash });
  }

  const topOfMindNoteDocs: ExportedDocument[] = [];
  for (const item of await source.listTopOfMindNotes(userId)) {
    const path = topOfMindNoteVaultPath(userId, item.note.id, item.note.createdAt);
    const { contentHash } = await vault.put(path, toYaml(buildTopOfMindNoteDoc(item)));
    topOfMindNoteDocs.push({ path, contentHash });
  }

  const contextNodeDocs: ExportedDocument[] = [];
  for (const item of await source.listContextNodes(userId)) {
    const path = contextNodeVaultPath(item.node);
    const { contentHash } = await vault.put(path, toYaml(buildContextNodeDoc(item)));
    contextNodeDocs.push({ path, contentHash });
  }

  const contextEdgeDocs: ExportedDocument[] = [];
  for (const item of await source.listContextEdges(userId)) {
    const path = contextEdgeVaultPath(item);
    const { contentHash } = await vault.put(path, toYaml(buildContextEdgeDoc(item)));
    contextEdgeDocs.push({ path, contentHash });
  }

  return {
    userId,
    signals: signalDocs,
    topOfMindNotes: topOfMindNoteDocs,
    contextNodes: contextNodeDocs,
    contextEdges: contextEdgeDocs,
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
