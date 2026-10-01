import { and, asc, eq } from "drizzle-orm";
import { attachments, inspirations, reflections, type InspirationEmbeddingScope } from "../db/index.js";
import { getDb } from "./db.js";
import { hashEmbeddingInput } from "./inspiration-embeddings.js";
import { quoteForEvidence } from "./salience.js";
import type { RelatedInspirationContext } from "./model-provider.js";

type Db = Pick<ReturnType<typeof getDb>, "select">;
export interface InspirationMaterialIdentity {
  scope: InspirationEmbeddingScope;
  policy: "inspiration-material-v1" | "inspiration-text-v1";
  hash: string;
  sources: Array<{ kind: "inspiration" | "reflection" | "attachment"; id: string; hash: string }>;
}
const hash = (value: unknown) => hashEmbeddingInput(JSON.stringify(value));
function identity(scope: InspirationEmbeddingScope, policy: InspirationMaterialIdentity["policy"], sources: InspirationMaterialIdentity["sources"]): InspirationMaterialIdentity {
  return { scope, policy, sources, hash: hash({ scope, policy, sources }) };
}

export function relatedMaterialIdentity(source: RelatedInspirationContext, scope: InspirationEmbeddingScope) {
  return identity(scope, "inspiration-text-v1", [{ kind: "inspiration", id: source.id, hash: hash(source) }]);
}

/** Exact source material, ordered consistently. Lock mode is for the final commit check only. */
export async function loadInspirationMaterial(db: Db, profileId: string, inspirationId: string, scope: InspirationEmbeddingScope, lock = false) {
  const parentQuery = db.select().from(inspirations)
    .where(and(eq(inspirations.profileId, profileId), eq(inspirations.id, inspirationId))).limit(1);
  const [inspiration] = await (lock ? parentQuery.for("update") : parentQuery);
  if (!inspiration) return null;
  const reflectionQuery = db.select({ id: reflections.id, question: reflections.question, answer: reflections.answer, skipped: reflections.skipped })
    .from(reflections).where(and(eq(reflections.profileId, profileId), eq(reflections.inspirationId, inspirationId)))
    .orderBy(asc(reflections.createdAt), asc(reflections.id));
  const attachmentQuery = db.select({ id: attachments.id, type: attachments.type, url: attachments.url,
    kind: attachments.enrichmentKind, text: attachments.enrichmentText, status: attachments.enrichmentStatus,
    hostname: attachments.hostname, name: attachments.name })
    .from(attachments).where(and(eq(attachments.profileId, profileId), eq(attachments.inspirationId, inspirationId)))
    .orderBy(asc(attachments.id));
  const [answers, attachmentRows] = await Promise.all([
    scope === "public" ? [] : (lock ? reflectionQuery.for("share") : reflectionQuery),
    lock ? attachmentQuery.for("share") : attachmentQuery,
  ]);
  const reflectionRows = answers.filter((row) => !row.skipped && row.answer !== null);
  const sources: InspirationMaterialIdentity["sources"] = [
    { kind: "inspiration", id: inspiration.id, hash: hash({ id: inspiration.id, text: inspiration.text,
      kind: inspiration.kind, source: inspiration.source, visibility: inspiration.visibility, createdAt: inspiration.createdAt }) },
    ...reflectionRows.map((row) => ({ kind: "reflection" as const, id: row.id, hash: hash(row) })),
    ...attachmentRows.map((row) => ({ kind: "attachment" as const, id: row.id, hash: hash(row) })),
  ];
  return { inspiration, reflectionRows, attachmentRows, identity: identity(scope, "inspiration-material-v1", sources) };
}
export type InspirationMaterial = NonNullable<Awaited<ReturnType<typeof loadInspirationMaterial>>>;

/** A source quote belongs to one real passage, not to a joined synthetic paragraph. */
export function resolveMaterialQuote(quote: string | null | undefined, material: InspirationMaterial, maxLength: number) {
  const offered = [
    { id: material.inspiration.id, kind: "inspiration", text: material.inspiration.text },
    ...material.reflectionRows.map((row) => ({ id: row.id, kind: "reflection", text: row.answer ?? "" })),
  ];
  for (const source of offered) {
    const verified = quoteForEvidence(quote, { text: source.text, enrichment: null }, maxLength);
    if (verified) return { quote: verified, quoteSource: "own" as const,
      quoteReflectionId: source.kind === "reflection" ? source.id : null,
      quoteSourceHash: material.identity.sources.find((item) => item.id === source.id)!.hash };
  }
  return { quote: null, quoteSource: null, quoteReflectionId: null, quoteSourceHash: null };
}

export async function assertMaterialCurrent(db: Db, snapshot: InspirationMaterial, related: RelatedInspirationContext[]) {
  const ids = [...new Set([snapshot.inspiration.id, ...related.map((row) => row.id)])].sort();
  // Consistent parent lock order also prevents new child FK links until commit.
  for (const id of ids) await db.select({ id: inspirations.id }).from(inspirations)
    .where(and(eq(inspirations.profileId, snapshot.inspiration.profileId), eq(inspirations.id, id))).for("update");
  const current = await loadInspirationMaterial(db, snapshot.inspiration.profileId, snapshot.inspiration.id, snapshot.identity.scope, true);
  if (!current || current.identity.hash !== snapshot.identity.hash) throw new Error("Source material changed; retry current inputs");
  for (const source of related) {
    const [row] = await db.select({ id: inspirations.id, text: inspirations.text, createdAt: inspirations.createdAt,
      visibility: inspirations.visibility }).from(inspirations)
      .where(and(eq(inspirations.profileId, snapshot.inspiration.profileId), eq(inspirations.id, source.id)));
    if (!row || row.text !== source.text || row.createdAt.getTime() !== source.createdAt.getTime() ||
      (snapshot.identity.scope === "public" && row.visibility !== "public")) {
      throw new Error("Related material changed; retry current inputs");
    }
  }
}
