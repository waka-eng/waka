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
  inspirationSparks,
  inspirations,
  reflections,
  users,
  wowMomentInspirations,
  wowMoments,
} from "../db/index.js";
import type { getDb } from "../lib/db.js";
import {
  buildInspirationDoc,
  buildWowMomentDoc,
  inspirationVaultPath,
  toYaml,
  wowMomentVaultPath,
  type InspirationExport,
  type WowMomentExport,
} from "./serialize.js";
import type { VaultStore } from "./vault.js";

export interface VaultExportSource {
  listUserIds(): Promise<string[]>;
  listInspirations(userId: string): Promise<InspirationExport[]>;
  listWowMoments(userId: string): Promise<WowMomentExport[]>;
}

export interface ExportedDocument {
  path: string;
  contentHash: string;
}

export interface VaultExportSummary {
  userId: string;
  inspirations: ExportedDocument[];
  wowMoments: ExportedDocument[];
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

  const inspirationDocs: ExportedDocument[] = [];
  for (const item of await source.listInspirations(userId)) {
    const path = inspirationVaultPath(
      userId,
      item.inspiration.id,
      item.inspiration.createdAt,
    );
    const { contentHash } = await vault.put(path, toYaml(buildInspirationDoc(item)));
    inspirationDocs.push({ path, contentHash });
  }

  const wowMomentDocs: ExportedDocument[] = [];
  for (const item of await source.listWowMoments(userId)) {
    const path = wowMomentVaultPath(userId, item.moment.id, item.moment.createdAt);
    const { contentHash } = await vault.put(path, toYaml(buildWowMomentDoc(item)));
    wowMomentDocs.push({ path, contentHash });
  }

  return { userId, inspirations: inspirationDocs, wowMoments: wowMomentDocs };
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

    async listInspirations(userId) {
      const rows = await db
        .select()
        .from(inspirations)
        .where(eq(inspirations.userId, userId))
        .orderBy(asc(inspirations.createdAt));
      if (rows.length === 0) return [];
      const ids = rows.map((row) => row.id);

      const [sparkRows, reflectionRows, attachmentRows] = await Promise.all([
        db
          .select()
          .from(inspirationSparks)
          .where(inArray(inspirationSparks.inspirationId, ids))
          .orderBy(asc(inspirationSparks.createdAt)),
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
      const reflectionsByInspiration = groupBy(
        reflectionRows,
        (row) => row.inspirationId,
      );
      const attachmentsByInspiration = groupBy(
        attachmentRows,
        (row) => row.inspirationId,
      );

      return rows.map((inspiration) => ({
        inspiration,
        sparks: sparksByInspiration.get(inspiration.id) ?? [],
        reflections: reflectionsByInspiration.get(inspiration.id) ?? [],
        attachments: attachmentsByInspiration.get(inspiration.id) ?? [],
      }));
    },

    async listWowMoments(userId) {
      const rows = await db
        .select()
        .from(wowMoments)
        .where(eq(wowMoments.userId, userId))
        .orderBy(asc(wowMoments.createdAt));
      if (rows.length === 0) return [];
      const ids = rows.map((row) => row.id);

      const linkRows = await db
        .select()
        .from(wowMomentInspirations)
        .where(inArray(wowMomentInspirations.wowMomentId, ids))
        .orderBy(asc(wowMomentInspirations.sortOrder));
      const linksByMoment = groupBy(linkRows, (row) => row.wowMomentId);

      return rows.map((moment) => ({
        moment,
        links: linksByMoment.get(moment.id) ?? [],
      }));
    },
  };
}
