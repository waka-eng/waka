/**
 * THE WORLD'S DATA LAYER, IN THE CANON'S WORDS.
 *
 * `docs/data-model.md` is the vocabulary of record. This module is where the
 * three layers become the three vertical sections of the world, and nowhere
 * else translates:
 *
 *   layer 1  inspiration   a capture          → THE FIELD    one orb each
 *   layer 2  signal        a pattern, cited   → THE SKY      bodies forming
 *   layer 3  top of mind   the one artifact   → HEADQUARTERS what you stand in
 *
 * The old surface called layer 1 "signals" — the exact inversion the canon
 * was written to end ("The vocabulary is inverted, and it already shipped a
 * bug"). So the world does not shim the old names back into place. A capture
 * is a capture here, a signal is a pattern, and the view models below carry
 * only what the canon actually returns.
 *
 * What the canon took away, and what the world must therefore stop drawing:
 *
 *   - A capture has no score. There is no `resonanceScore`, no five-axis
 *     `signalScores`. Aliveness is computed from time and attention alone
 *     (see `aliveness`), which was always the honest input.
 *   - A capture is never shared. Sharing moved to the signal layer precisely
 *     so raw captures never cross an account boundary; an orb in the field
 *     has no out-loud/held state to render any more.
 *   - A capture cites no room. Rooms consume signals, so "where else this
 *     led" is a property of the pattern above it, not the memory below.
 */

import {
  fetchInspiration,
  fetchInspirationPage,
  fetchSignal,
  fetchSignals,
  fetchTopOfMind,
  type ApiAttachment,
  type ApiAttachmentSummary,
  type ApiInspirationKind,
  type ApiInspirationVisibility,
  type ApiInspirationSource,
  type ApiSignal,
  type ApiSignalEvidence,
  type ApiTopOfMind,
  type ApiTopOfMindEntry,
  type ApiTopOfMindEntryType,
} from "./api";

const ms = (iso: string | null | undefined): number => {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
};

/* ---------------------------------------------------------------- layer 1 */

/**
 * ONE CAPTURE — one orb in the field.
 *
 * `capturedMs` and `updatedMs` are milliseconds because every consumer in the
 * world is arithmetic (decay, the dial, the sort). Parsing once here keeps
 * `Date.parse` out of the frame loop, which is a standing rule.
 */
export interface WorldCapture {
  id: string;
  preview: string;
  /** Whether the rooms this account is in can see it. */
  isPublic: boolean;
  kind: ApiInspirationKind | null;
  /** Whose initiative this was: the person's words, or an agent's own note. */
  source: ApiInspirationSource;
  capturedMs: number;
  updatedMs: number;
  attachments: ApiAttachmentSummary[];
  /** The second beat, counted. Answered and skipped are not distinguished
      by the archive endpoint; the detail carries the difference. */
  reflectionCount: number;
}

/** One capture, opened: the words in full and what was hanging off them. */
export interface WorldCaptureDetail extends WorldCapture {
  text: string;
  reflections: Array<{
    id: string;
    question: string;
    answer: string | null;
    skipped: boolean;
    createdMs: number;
  }>;
  /** Enrichment is machine-derived and is never printed as the person's
      words — the panel labels it, or does not show it. */
  enrichment: Array<{ attachmentId: string; kind: string | null; text: string }>;
  /** The one image this memory can show: an attached image, or the preview a
      linked page declared. Null when it has nothing to show, which is most. */
  imageUrl: string | null;
}

/* ---------------------------------------------------------------- layer 2 */

/**
 * ONE PATTERN — one body in the sky.
 *
 * `status` is the vertical story the founder chose: `emerging` is still
 * forming overhead, `active` is what headquarters is standing on, `retired`
 * has sunk. `confidence` is the light. `evidenceCount` is the orbit's mass,
 * and the evidence itself (with the reason it was read that way) arrives only
 * when a pattern is opened — the sky never fetches what it cannot draw.
 */
export interface WorldPattern {
  id: string;
  statement: string;
  status: ApiSignal["status"];
  confidence: number;
  evidenceCount: number;
  lastEvidenceMs: number;
  createdMs: number;
  /** A human edited the words: the server keeps feeding it but never rewrites. */
  locked: boolean;
  /** Every capture behind it is gone; only the lock is keeping it here. */
  unsupported: boolean;
  /** The rooms this pattern is out loud in. Captures never appear in a room. */
  sharedGroupIds: string[];
}

/** What a pattern rests on, and why it was read that way. */
export interface WorldEvidence {
  /** Whose evidence this is. Carried so the field can look back UP: a memory
      learns what it is for from the patterns that cite it, and needs to name
      them. */
  patternId: string;
  captureId: string;
  preview: string;
  /** The words that carried the reading, when the server named them. */
  quote: string | null;
  /** "얘가 이걸 만든 이유가 이거다" — the explainability pointer, rendered
      on the orbit rather than restated as a sentence. */
  reason: string | null;
  createdMs: number;
}

export interface WorldPatternDetail extends WorldPattern {
  evidence: WorldEvidence[];
}

/* ---------------------------------------------------------------- layer 3 */

/**
 * ONE STATEMENT inside the artifact. The artifact is the unit — there is
 * exactly one top of mind per profile — so headquarters shows the artifact's
 * entries, never a list of competing artifacts.
 */
export interface WorldEntry {
  id: string;
  type: ApiTopOfMindEntryType;
  body: string;
  belief: string | null;
  prompt: string | null;
  locked: boolean;
  pinned: boolean;
  dismissed: boolean;
  sortOrder: number;
  /** The patterns beneath this statement, named. This is the provenance the
      headquarters peek draws, and it points at layer 2 — not at captures. */
  citedPatterns: Array<{ id: string; statement: string }>;
  createdMs: number;
}

export interface WorldTopOfMind {
  id: string;
  version: number;
  reason: ApiTopOfMind["reason"];
  createdMs: number;
  entries: WorldEntry[];
}

/* ------------------------------------------------------------- conversion */

export function toCapture(row: {
  id: string;
  textPreview: string;
  kind: ApiInspirationKind | null;
  source: ApiInspirationSource;
  createdAt: string;
  updatedAt: string;
  visibility?: ApiInspirationVisibility;
  attachmentSummary: ApiAttachmentSummary[];
  reflectionCount: number;
}): WorldCapture {
  return {
    id: row.id,
    preview: row.textPreview,
    /* absent means private: an older payload must never read as published */
    isPublic: row.visibility === "public",
    kind: row.kind,
    source: row.source,
    capturedMs: ms(row.createdAt),
    updatedMs: ms(row.updatedAt) || ms(row.createdAt),
    attachments: Array.isArray(row.attachmentSummary) ? row.attachmentSummary : [],
    reflectionCount: row.reflectionCount ?? 0,
  };
}

export function toPattern(row: ApiSignal): WorldPattern {
  return {
    id: row.id,
    statement: row.statement,
    status: row.status,
    confidence: typeof row.confidence === "number" ? row.confidence : 0,
    evidenceCount: row.evidenceCount ?? 0,
    lastEvidenceMs: ms(row.lastEvidenceAt),
    createdMs: ms(row.createdAt),
    locked: Boolean(row.locked),
    unsupported: Boolean(row.unsupported),
    sharedGroupIds: Array.isArray(row.sharedGroupIds) ? row.sharedGroupIds : [],
  };
}

function toEvidence(patternId: string, row: ApiSignalEvidence): WorldEvidence {
  return {
    patternId,
    captureId: row.inspirationId,
    preview: row.preview,
    quote: row.quote ?? null,
    reason: row.reason ?? null,
    createdMs: ms(row.createdAt),
  };
}

function toEntry(row: ApiTopOfMindEntry): WorldEntry {
  return {
    id: row.id,
    type: row.type,
    body: row.body,
    belief: row.belief ?? null,
    prompt: row.prompt ?? null,
    locked: Boolean(row.locked),
    pinned: Boolean(row.pinned),
    dismissed: Boolean(row.dismissed),
    sortOrder: row.sortOrder ?? 0,
    citedPatterns: Array.isArray(row.citedSignals) ? row.citedSignals : [],
    createdMs: ms(row.createdAt),
  };
}

/* ----------------------------------------------------------------- loaders */

/** THE FIELD. Every capture the acting profile owns, oldest first — the
    order the field lays them down in, so the sort never moves after paint. */
/**
 * The server caps `limit` at 200 and parses the query `.strict()`, so asking
 * for more is not clamped — it is a 400. This asked for 500, which means the
 * field has never loaded for a signed-in account: every real session got
 * "Waka could not be poured" while the walls, groups and profiles beside it
 * resolved fine. It only ever worked in the dev fixture, which does not go
 * through this call at all.
 *
 * 200 is the ceiling for one page. `fetchInspirations` does not surface the
 * cursor yet, so a field past 200 memories is silently short — noted here
 * rather than left to be discovered, and the reason paging is the next thing
 * this function needs.
 */
const FIELD_PAGE = 200;

/**
 * A ceiling on the ceiling. Following the cursor forever would let one very
 * old account stall the world's first paint, so the walk stops here and the
 * field is honestly short rather than slow. Ten pages is two thousand
 * memories, which is far past what the ground lays out legibly anyway.
 */
const FIELD_MAX_PAGES = 10;

/**
 * THE WHOLE FIELD, NOT THE FIRST PAGE OF IT.
 *
 * The server caps `limit` at 200 and parses the query `.strict()`, so asking
 * for more is a 400, not a clamp — this once asked for 500, which meant the
 * field never loaded for a signed-in account at all. Fixed to 200, which
 * loaded but silently stopped there: a person with three hundred memories saw
 * two hundred of them and was told nothing, which is the worse bug of the two
 * because it looks like it worked.
 *
 * So it follows the cursor. Sequential rather than parallel because each page
 * is defined by the one before it, and the first page is what the world needs
 * to paint — the rest arrive behind it.
 */
export async function loadField(profile?: string): Promise<WorldCapture[]> {
  const out: WorldCapture[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < FIELD_MAX_PAGES; page++) {
    const got = await fetchInspirationPage({ limit: FIELD_PAGE, profile, cursor });
    out.push(...got.inspirations.map(toCapture));
    if (!got.nextCursor || got.inspirations.length === 0) break;
    cursor = got.nextCursor;
  }
  return out.sort((a, b) => a.capturedMs - b.capturedMs);
}

/** THE SKY. Patterns, brightest-first is decided by the sky's own layout;
    here they arrive as the server ranked them. Retired ones are included —
    nothing that exists pops out of existence, it sinks. */
export async function loadSky(profile?: string): Promise<WorldPattern[]> {
  const rows = await fetchSignals({ limit: 200, profile });
  return rows.map(toPattern);
}

/** HEADQUARTERS. Null is a real state, not an error: a profile with nothing
    synthesized yet has nothing to stand on, and the world says so in words. */
export async function loadHeadquarters(profile?: string): Promise<WorldTopOfMind | null> {
  const row = await fetchTopOfMind({ profile });
  if (!row) return null;
  return {
    id: row.id,
    version: row.version,
    reason: row.reason,
    createdMs: ms(row.createdAt),
    entries: (row.entries ?? []).map(toEntry).filter((e) => !e.dismissed),
  };
}

/** One memory opened: the words in full, what was attached, and what the
    person said back. Enrichment comes through labelled, never as their words. */
export async function loadCapture(id: string): Promise<WorldCaptureDetail> {
  const row = await fetchInspiration(id);
  return {
    id: row.id,
    preview: row.text,
    isPublic: row.visibility === "public",
    text: row.text,
    kind: row.kind,
    source: row.source,
    capturedMs: ms(row.createdAt),
    updatedMs: ms(row.updatedAt) || ms(row.createdAt),
    attachments: (row.attachments ?? []).map((a) => ({
      id: a.id,
      type: a.type,
      label: a.name ?? a.url,
    })),
    reflectionCount: (row.reflections ?? []).length,
    reflections: (row.reflections ?? []).map((r) => ({
      id: r.id,
      question: r.question,
      answer: r.answer,
      skipped: r.skipped,
      createdMs: ms(r.createdAt),
    })),
    enrichment: (row.attachments ?? [])
      .filter((a) => a.enrichment?.status === "ready" && a.enrichment.text)
      .map((a) => ({
        attachmentId: a.id,
        kind: a.enrichment.kind,
        text: a.enrichment.text as string,
      })),
    imageUrl: firstImage(row.attachments ?? []),
  };
}

/** The one image a memory can show: an attached image, or the preview a
    linked page declared. Null when it has nothing to show, which is most. */
function firstImage(attachments: ApiAttachment[]): string | null {
  for (const a of attachments) {
    const url = a.type === "image" ? a.url : a.enrichment?.link?.previewImageUrl ?? null;
    if (url) return url;
  }
  return null;
}

/** One pattern opened: the same statement, plus what it rests on. */
export async function loadPattern(id: string): Promise<WorldPatternDetail> {
  const row = await fetchSignal(id);
  return { ...toPattern(row), evidence: (row.evidence ?? []).map((e) => toEvidence(row.id, e)) };
}

/* ---------------------------------------------------------------- aliveness */

/**
 * HOW ALIVE A CAPTURE IS, 0..1 — the only channel the world spends on it.
 *
 * Unchanged in shape from the founder's formula; changed in inputs only where
 * the canon removed one. The half-life is a week on the later of captured and
 * updated, attention adds on top of that decay, and the two flat terms are
 * unmultiplied so a memory with words attached never reads as fully dark.
 *
 * `resonanceScore` is gone from the canon and is NOT reintroduced by guessing:
 * a machine score the person never saw was never a good input to how alive
 * their own memory looks.
 */
export function aliveness(c: WorldCapture, now: number): number {
  const days = Math.max(0, (now - Math.max(c.updatedMs, c.capturedMs)) / 86_400_000);
  const decay = Math.pow(0.5, days / 7);
  const attention = 0.25 * Math.min(c.reflectionCount, 2) * decay;
  const hasWords = c.reflectionCount > 0 ? 0.15 : 0;
  const hasAttachment = c.attachments.length > 0 ? 0.1 : 0;
  return Math.max(0, Math.min(1, decay + attention + hasWords + hasAttachment));
}
