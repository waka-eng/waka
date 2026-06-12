/**
 * Vault materializers.
 *
 * These helpers keep the file document and rebuildable `documents` index in
 * sync. Capture uses `writeSignalDraftToVault` before the DB insert, then
 * `materializeSignalDocument` after derived local rows are available.
 */

import { and, asc, eq, inArray } from "drizzle-orm";

import {
  attachments,
  documents,
  reflections,
  signalPackets,
  signalSparks,
  signals,
  type DocumentType,
  type Signal,
  type SignalSpark,
} from "../db/index.js";
import type { getDb } from "../lib/db.js";
import {
  buildSignalDoc,
  signalVaultPath,
  toYaml,
  type SignalExport,
} from "./serialize.js";
import type { VaultStore } from "./vault.js";

type Db = ReturnType<typeof getDb>;

export interface MaterializedDocument {
  id: string;
  path: string;
  contentHash: string;
  docType: DocumentType;
}

function signalSearchText(input: SignalExport): string {
  return [
    input.signal.text,
    ...input.sparks.map((spark) => spark.text),
    input.packet?.sparkText,
    input.packet?.artifactExcerpt,
    input.packet?.packetText,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("\n\n");
}

export async function upsertDocumentIndex(
  db: Db,
  input: {
    id: string;
    userId: string;
    docType: DocumentType;
    path: string;
    contentHash: string;
    rev: number;
    searchText?: string | null;
    cluster?: Signal["cluster"] | null;
    importanceScore?: number | null;
    wowScore?: number | null;
    createdAt?: Date | null;
  },
): Promise<void> {
  await db
    .insert(documents)
    .values({
      id: input.id,
      userId: input.userId,
      docType: input.docType,
      path: input.path,
      contentHash: input.contentHash,
      rev: input.rev,
      searchText: input.searchText ?? null,
      cluster: input.cluster ?? null,
      importanceScore: input.importanceScore ?? null,
      wowScore: input.wowScore ?? null,
      createdAt: input.createdAt ?? null,
      indexedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: documents.id,
      set: {
        path: input.path,
        contentHash: input.contentHash,
        rev: input.rev,
        searchText: input.searchText ?? null,
        cluster: input.cluster ?? null,
        importanceScore: input.importanceScore ?? null,
        wowScore: input.wowScore ?? null,
        createdAt: input.createdAt ?? null,
        indexedAt: new Date(),
      },
    });
}

export async function writeSignalDraftToVault(input: {
  vault: VaultStore;
  signal: Signal;
  sparks: SignalSpark[];
}): Promise<MaterializedDocument> {
  const path = signalVaultPath(
    input.signal.userId,
    input.signal.id,
    input.signal.createdAt,
  );
  const content = toYaml(
    buildSignalDoc({
      signal: input.signal,
      sparks: input.sparks,
      packet: null,
      reflections: [],
      attachments: [],
    }),
  );
  const { contentHash } = await input.vault.put(path, content);
  return { id: input.signal.id, path, contentHash, docType: "signal" };
}

export async function materializeSignalDocument(input: {
  db: Db;
  vault: VaultStore;
  userId: string;
  signalId: string;
}): Promise<MaterializedDocument | null> {
  const [signal] = await input.db
    .select()
    .from(signals)
    .where(eq(signals.id, input.signalId))
    .limit(1);

  if (!signal || signal.userId !== input.userId) return null;

  const [sparkRows, packetRows, reflectionRows, attachmentRows] = await Promise.all([
    input.db
      .select()
      .from(signalSparks)
      .where(eq(signalSparks.inspirationId, input.signalId))
      .orderBy(asc(signalSparks.createdAt)),
    input.db
      .select()
      .from(signalPackets)
      .where(eq(signalPackets.inspirationId, input.signalId))
      .orderBy(asc(signalPackets.updatedAt)),
    input.db
      .select()
      .from(reflections)
      .where(eq(reflections.inspirationId, input.signalId))
      .orderBy(asc(reflections.createdAt)),
    input.db
      .select()
      .from(attachments)
      .where(eq(attachments.inspirationId, input.signalId))
      .orderBy(asc(attachments.createdAt)),
  ]);

  const exportInput: SignalExport = {
    signal,
    sparks: sparkRows,
    packet: packetRows[0] ?? null,
    reflections: reflectionRows,
    attachments: attachmentRows,
  };
  const path = signalVaultPath(signal.userId, signal.id, signal.createdAt);
  const { contentHash } = await input.vault.put(
    path,
    toYaml(buildSignalDoc(exportInput)),
  );
  await upsertDocumentIndex(input.db, {
    id: signal.id,
    userId: signal.userId,
    docType: "signal",
    path,
    contentHash,
    rev: 1,
    searchText: signalSearchText(exportInput),
    cluster: signal.cluster,
    importanceScore: signal.importanceScore,
    wowScore: signal.wowScore,
    createdAt: signal.createdAt,
  });

  return { id: signal.id, path, contentHash, docType: "signal" };
}

export async function deleteSignalDocument(input: {
  db: Db;
  vault: VaultStore;
  userId: string;
  signalId: string;
}): Promise<void> {
  const rows = await input.db
    .select({ path: documents.path })
    .from(documents)
    .where(and(eq(documents.id, input.signalId), eq(documents.userId, input.userId)))
    .limit(1);

  const path = rows[0]?.path;
  if (path) await input.vault.delete(path);

  await input.db
    .delete(documents)
    .where(and(eq(documents.id, input.signalId), eq(documents.userId, input.userId)));
}

export async function deleteSignalDocuments(input: {
  db: Db;
  vault: VaultStore;
  userId: string;
  signalIds: string[];
}): Promise<void> {
  if (input.signalIds.length === 0) return;
  const rows = await input.db
    .select({ id: documents.id, path: documents.path })
    .from(documents)
    .where(and(eq(documents.userId, input.userId), inArray(documents.id, input.signalIds)));
  for (const row of rows) await input.vault.delete(row.path);
  await input.db
    .delete(documents)
    .where(and(eq(documents.userId, input.userId), inArray(documents.id, input.signalIds)));
}
