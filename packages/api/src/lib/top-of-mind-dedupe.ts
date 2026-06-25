export type TopOfMindAvailabilityStatus = "active" | "unavailable" | string;

export interface DedupeTopOfMindNoteLike {
  id: string;
  title?: string | null;
  ambientSignal?: string | null;
  body?: string | null;
  beliefStatement?: string | null;
  why?: string | null;
  ambitionDimension?: string | null;
  kind?: string | null;
  status?: TopOfMindAvailabilityStatus | null;
  confidence?: number | null;
  wowScore?: number | null;
  isPinned?: boolean | null;
  userFeedbackValue?: string | null;
  relatedSignalIds?: string[] | null;
  relatedContextNodeIds?: string[] | null;
  createdAt?: Date | string | null;
}

const TRAILING_PUNCTUATION = /[\s\p{P}\p{S}。]+$/u;
const TOKEN_SPLIT = /[^\p{L}\p{N}]+/u;
const HIGH_TEXT_SIMILARITY = 0.82;
const MODERATE_TEXT_SIMILARITY = 0.56;
const HIGH_OVERLAP = 0.67;

export function normalizeTopOfMindDedupeText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(TRAILING_PUNCTUATION, "")
    .trim();
}

function tokens(value: string): Set<string> {
  return new Set(
    normalizeTopOfMindDedupeText(value)
      .split(TOKEN_SPLIT)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2),
  );
}

export function jaccardTextSimilarity(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const aTokens = tokens(a ?? "");
  const bTokens = tokens(b ?? "");
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

export function idOverlapRatio(
  a: readonly string[] | null | undefined,
  b: readonly string[] | null | undefined,
): number {
  const aSet = new Set(a ?? []);
  const bSet = new Set(b ?? []);
  if (aSet.size === 0 || bSet.size === 0) return 0;
  const intersection = [...aSet].filter((id) => bSet.has(id)).length;
  return intersection / Math.min(aSet.size, bSet.size);
}

function dimensionOf(note: DedupeTopOfMindNoteLike): string {
  return normalizeTopOfMindDedupeText(note.ambitionDimension ?? note.kind ?? "");
}

function combinedText(note: DedupeTopOfMindNoteLike): string {
  return [note.title, note.ambientSignal, note.body, note.beliefStatement, note.why]
    .map(normalizeTopOfMindDedupeText)
    .filter(Boolean)
    .join(" ");
}

function statusRank(note: DedupeTopOfMindNoteLike): number {
  if (note.isPinned || note.userFeedbackValue === "important") return 3;
  if (note.status === "active" || !note.status) return 2;
  if (note.status === "unavailable") return 1;
  return 0;
}

function scoreOf(note: DedupeTopOfMindNoteLike): number {
  return note.confidence ?? note.wowScore ?? 0;
}

function createdAtMs(note: DedupeTopOfMindNoteLike): number {
  if (!note.createdAt) return 0;
  const date = note.createdAt instanceof Date ? note.createdAt : new Date(note.createdAt);
  const time = date.getTime();
  return Number.isFinite(time) ? time : 0;
}

export function compareTopOfMindNoteStrength(
  a: DedupeTopOfMindNoteLike,
  b: DedupeTopOfMindNoteLike,
): number {
  const rankDelta = statusRank(a) - statusRank(b);
  if (rankDelta !== 0) return rankDelta;
  const scoreDelta = scoreOf(a) - scoreOf(b);
  if (scoreDelta !== 0) return scoreDelta;
  return createdAtMs(a) - createdAtMs(b);
}

export function areDuplicateTopOfMindNotes(
  a: DedupeTopOfMindNoteLike,
  b: DedupeTopOfMindNoteLike,
): boolean {
  const sameDimension = dimensionOf(a) === dimensionOf(b);
  const titleA = normalizeTopOfMindDedupeText(a.title);
  const titleB = normalizeTopOfMindDedupeText(b.title);
  const ambientA = normalizeTopOfMindDedupeText(a.ambientSignal ?? a.beliefStatement);
  const ambientB = normalizeTopOfMindDedupeText(b.ambientSignal ?? b.beliefStatement);
  const textSimilarity = jaccardTextSimilarity(combinedText(a), combinedText(b));
  const sourceOverlap = idOverlapRatio(a.relatedSignalIds, b.relatedSignalIds);
  const contextOverlap = idOverlapRatio(a.relatedContextNodeIds, b.relatedContextNodeIds);

  if (sameDimension && titleA && titleA === titleB) return true;
  if (sameDimension && ambientA && ambientA === ambientB) return true;
  if (sameDimension && textSimilarity >= HIGH_TEXT_SIMILARITY) return true;
  if (sourceOverlap >= HIGH_OVERLAP && textSimilarity >= MODERATE_TEXT_SIMILARITY) return true;
  if (sameDimension && contextOverlap >= HIGH_OVERLAP) return true;
  return false;
}

export function dedupeTopOfMindNotes<T extends DedupeTopOfMindNoteLike>(notes: T[]): T[] {
  const clusters: T[][] = [];
  for (const note of notes) {
    const cluster = clusters.find((existing) =>
      existing.some((clusterNote) => areDuplicateTopOfMindNotes(clusterNote, note)),
    );
    if (cluster) {
      cluster.push(note);
    } else {
      clusters.push([note]);
    }
  }

  return clusters
    .map((cluster) => ({
      orderIndex: Math.min(...cluster.map((note) => notes.indexOf(note))),
      winner: cluster.reduce((strongest, note) =>
        compareTopOfMindNoteStrength(note, strongest) > 0 ? note : strongest,
      ),
    }))
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map(({ winner }) => winner);
}

export function isNearDuplicateTopOfMindText(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const normalizedA = normalizeTopOfMindDedupeText(a);
  const normalizedB = normalizeTopOfMindDedupeText(b);
  if (!normalizedA || !normalizedB) return false;
  return normalizedA === normalizedB || jaccardTextSimilarity(normalizedA, normalizedB) >= HIGH_TEXT_SIMILARITY;
}
