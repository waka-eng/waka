/**
 * THE WORLD'S DATA LAYER — AND IT SPEAKS THE CANON'S WORDS, NOT ITS OWN.
 *
 * `docs/data-model.md` is the vocabulary of record. This module is where the
 * three layers become the three vertical sections of the world:
 *
 *   layer 1  inspiration   → THE FIELD          one orb each, below you
 *   layer 2  signal        → THE SKY            statements still forming
 *   layer 3  top of mind   → HEADQUARTERS       what you stand in
 *
 * THIS FILE USED TO BE THE TRANSLATION, AND IT IS NOT ANY MORE. It carried a
 * second vocabulary — an inspiration was a `WorldCapture`, a signal was a
 * `WorldPattern`, the loaders were `loadField` / `loadSky` /
 * `loadHeadquarters` — so every reader had to hold two words for one thing
 * and this module was the only place they met. That is now gone: the types
 * and functions here use the canon's nouns, and one word runs from the
 * Postgres column through the route to the view model.
 *
 * `field`, `sky` and `headquarters` survive, but only as the words for WHERE
 * a layer is DRAWN. They belong in the UI and in comments like this one, and
 * never in a type name, a function name or a path — because a person standing
 * in the world sees a field, while the thing being fetched is an inspiration.
 *
 * The `World` prefix stays and is doing work: `Inspiration` is the view
 * model, `ApiInspiration` is the payload, and the two differ (see `isPublic`
 * below, which is a deliberate lossy flatten of the canon's `visibility`).
 *
 * What the canon took away, and what the world must therefore stop drawing:
 *
 *   - An inspiration has no score. There is no `resonanceScore`, no five-axis
 *     `signalScores`. Aliveness is computed from time and attention alone
 *     (see `aliveness`), which was always the honest input.
 *   - An inspiration is never shared as itself into another account beyond
 *     the rooms its author's account belongs to, and only when marked public;
 *     an orb in the field has no out-loud/held state to render any more.
 *   - An inspiration cites no group. Groups consume signals, so "where else
 *     this led" is a property of the signal above it, not the memory below.
 */

import {
  fetchInspiration,
  fetchInspirationPage,
  fetchSignal,
  fetchSignals,
  fetchTopOfMind,
  type ApiAttachmentSummary,
  type ApiInspirationKind,
  type ApiInspirationVisibility,
  type ApiInspirationSource,
  type ApiSignal,
  type ApiSignalEvidence,
  type ApiTopOfMind,
  fetchTopOfMindVersion,
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
 * ONE INSPIRATION — one orb in the field.
 *
 * `capturedMs` and `updatedMs` are milliseconds because every consumer in the
 * world is arithmetic (decay, the dial, the sort). Parsing once here keeps
 * `Date.parse` out of the frame loop, which is a standing rule.
 */
export interface Inspiration {
  id: string;
  preview: string;
  /**
   * Whether the groups this account is in can see it.
   *
   * A DELIBERATE, LOSSY TRANSLATION. The canon names this `visibility` and
   * types it as an enum (`private` | `public`) precisely so it can grow —
   * `docs/data-model.md` owns that vocabulary. The world flattens it to a
   * boolean because the field has exactly one question to ask of a memory:
   * does it leave this wall.
   *
   * The cost, stated so nobody discovers it: if the canon ever adds a third
   * value, `visibility === "public"` quietly reads it as false. That fails
   * CLOSED, which is the right direction for a privacy flag — but it fails
   * silently, so a new value means revisiting this line.
   */
  isPublic: boolean;
  kind: ApiInspirationKind | null;
  /** Whose initiative this was: the person's words, or an agent's own note. */
  source: ApiInspirationSource;
  capturedMs: number;
  updatedMs: number;
  attachments: ApiAttachmentSummary[];
  /** Saved answers attached to this inspiration; skipped prompts do not mark it reflected. */
  reflectionCount: number;
}

/** One inspiration, opened: the words in full and what was hanging off them. */
export interface InspirationDetail extends Inspiration {
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
  /* NO PICTURE COMES DOWN WITH A MEMORY, and the absence is the point.
     `imageUrl` stood here — an attached image, or the preview a linked page
     declared, which is its `og:image`. It was carried to the client so the
     field could draw it ON THE ORB, and that is what put a LinkedIn logo in
     the founder's world: a link to a company page declares the company's
     logo, and the world filled with other people's brands over the one
     channel that carries meaning.
     The drawing went on 2026-09-08 (#318). This is the pipe that fed it,
     found still connected four days later when the founder asked for the
     root cause: produced on every memory, read by nothing. A field named
     `imageUrl` sitting on every row is an invitation to draw it again, so it
     goes too. Held by `no-picture-reaches-the-field.test.ts`. */
}

/* ---------------------------------------------------------------- layer 2 */

/**
 * ONE SIGNAL — one body in the sky.
 *
 * `status` is the vertical story the founder chose: `emerging` is still
 * forming overhead, `active` is what headquarters is standing on, `retired`
 * has sunk. `confidence` is the light. `evidenceCount` is the orbit's mass,
 * and the evidence itself (with the reason it was read that way) arrives only
 * when a signal is opened — the sky never fetches what it cannot draw.
 */
export interface Signal {
  id: string;
  statement: string;
  status: ApiSignal["status"];
  confidence: number;
  evidenceCount: number;
  lastEvidenceMs: number;
  createdMs: number;
  /** A human edited the words: the server keeps feeding it but never rewrites. */
  locked: boolean;
  /** Every inspiration behind it is gone; only the lock is keeping it here. */
  unsupported: boolean;
  /** The groups this signal is shared into. Inspirations never appear in a group. */
  sharedGroupIds: string[];
}

/** What a signal rests on, and why it was read that way. */
export interface Evidence {
  /** Whose evidence this is. Carried so the field can look back UP: a memory
      learns what it is for from the signals that cite it, and needs to name
      them. */
  signalId: string;
  inspirationId: string;
  preview: string;
  /** The words that carried the reading, when the server named them. */
  quote: string | null;
  /** Whose words the quote is — the person's own ("own") or the page behind
      their link ("enrichment"). Null means the quote predates the server's
      span verification: the surface must not light it as a read span. */
  quoteSource: "own" | "enrichment" | null;
  quoteReflectionId?: string | null;
  /** "얘가 이걸 만든 이유가 이거다" — the explainability pointer, rendered
      on the orbit rather than restated as a sentence. */
  reason: string | null;
  createdMs: number;
}

export interface SignalDetail extends Signal {
  evidence: Evidence[];
}

/* ---------------------------------------------------------------- layer 3 */

/**
 * ONE STATEMENT inside the artifact. The artifact is the unit — there is
 * exactly one top of mind per profile — so headquarters shows the artifact's
 * entries, never a list of competing artifacts.
 */
export interface Entry {
  id: string;
  type: ApiTopOfMindEntryType;
  body: string;
  belief: string | null;
  prompt: string | null;
  locked: boolean;
  pinned: boolean;
  dismissed: boolean;
  sortOrder: number;
  /** The signals beneath this statement, named. This is the provenance the
      headquarters peek draws, and it points at layer 2 — not at inspirations.
      `answered` is the ground's ratified standing: the owner has spoken to it
      (a verdict, a star) — false while only the machine believes it. */
  citedSignals: Array<{ id: string; statement: string; statementRevision?: string; answered: boolean; locked: boolean; contested: boolean }>;
  createdMs: number;
  supportChanged?: boolean;
}

export interface TopOfMind {
  id: string;
  version: number;
  reason: ApiTopOfMind["reason"];
  createdMs: number;
  entries: Entry[];
  supportChanged?: boolean;
  generationRevision?: string;
  profileId?: string;
}

/* ------------------------------------------------------------- conversion */

export function toInspiration(row: {
  id: string;
  textPreview: string;
  kind: ApiInspirationKind | null;
  source: ApiInspirationSource;
  createdAt: string;
  updatedAt: string;
  visibility?: ApiInspirationVisibility;
  attachmentSummary: ApiAttachmentSummary[];
  reflectionCount: number;
}): Inspiration {
  return {
    id: row.id,
    preview: row.textPreview || row.attachmentSummary?.map(item => item.type === 'audio' ? 'Recording' : item.type === 'image' ? 'Photo' : item.label).join(' · ') || '',
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

export function toSignal(row: ApiSignal): Signal {
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

function toEvidence(signalId: string, row: ApiSignalEvidence): Evidence {
  return {
    signalId,
    inspirationId: row.inspirationId,
    preview: row.preview,
    quote: row.quote ?? null,
    quoteSource: row.quoteSource ?? null,
    quoteReflectionId: row.quoteReflectionId ?? null,
    reason: row.reason ?? null,
    createdMs: ms(row.createdAt),
  };
}

function toEntry(row: ApiTopOfMindEntry): Entry {
  return {
    supportChanged: row.supportChanged === true,
    id: row.id,
    type: row.type,
    body: row.body,
    belief: row.belief ?? null,
    prompt: row.prompt ?? null,
    locked: Boolean(row.locked),
    pinned: Boolean(row.pinned),
    dismissed: Boolean(row.dismissed),
    sortOrder: row.sortOrder ?? 0,
    /* an older payload without the standing must read as unanswered — dim is
       the honest default, never falsely lit */
    citedSignals: Array.isArray(row.citedSignals)
      ? row.citedSignals.map((c) => ({
          ...c,
          answered: Boolean(c.answered),
          /* a payload from before the server sent this reads as unlocked,
             which is the safe way round: it offers no way back rather than
             offering one that would fail */
          locked: Boolean(c.locked),
          /* same safe direction: an older payload reads as settled — a
             false calm until the next fetch, never a false dispute */
          contested: Boolean(c.contested),
        }))
      : [],
    createdMs: ms(row.createdAt),
  };
}

/* ----------------------------------------------------------------- loaders */

/** THE FIELD. Every inspiration the acting profile owns, oldest first — the
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
export interface FieldLoad {
  /** What arrived, oldest first — the order the ground lays them down in. */
  inspirations: Inspiration[];
  /**
   * How many the archive holds. Equal to `inspirations.length` on every
   * archive smaller than the ceiling, which is every archive for a long time.
   */
  total: number;
  /**
   * The walk stopped before the archive did. The one fact the world had no
   * way of knowing until the server started serving a total — and without it
   * the count under the door was the length of what had arrived, printed as
   * though it were the size of the archive.
   */
  short: boolean;
}

/**
 * The remainder: how many the archive holds that the walk never reached.
 * Zero for every archive under the ceiling, which is nearly every archive.
 */
export function beyondOf(field: FieldLoad): number {
  return Math.max(0, field.total - field.inspirations.length);
}

/** Nothing arrived, and nothing is behind it either — the shape a failed
    walk falls back to, so a caller never has to invent a total. */
export const EMPTY_FIELD: FieldLoad = { inspirations: [], total: 0, short: false };

export async function loadInspirations(profile?: string): Promise<FieldLoad> {
  const out: Inspiration[] = [];
  let cursor: string | undefined;
  let reported: number | undefined;
  for (let page = 0; page < FIELD_MAX_PAGES; page++) {
    const got = await fetchInspirationPage({ limit: FIELD_PAGE, profile, cursor });
    out.push(...got.inspirations.map(toInspiration));
    if (typeof got.total === "number") reported = got.total;
    if (!got.nextCursor || got.inspirations.length === 0) break;
    cursor = got.nextCursor;
  }
  /* `max` holds the invariant the door depends on — "N of M" with M below N
     is worse than no sentence at all — across a server too old to report a
     total, and across a capture or an erasure landing mid-walk. */
  const total = Math.max(reported ?? 0, out.length);
  return {
    inspirations: out.sort((a, b) => a.capturedMs - b.capturedMs),
    total,
    short: total > out.length,
  };
}

/** THE SKY. Patterns, brightest-first is decided by the sky's own layout;
    here they arrive as the server ranked them. Retired ones are included —
    nothing that exists pops out of existence, it sinks. */
export async function loadSignals(profile?: string): Promise<Signal[]> {
  const rows = await fetchSignals({ limit: 200, profile });
  return rows.map(toSignal);
}

/** HEADQUARTERS. Null is a real state, not an error: a profile with nothing
    synthesized yet has nothing to stand on, and the layout says so in words. */
export async function loadTopOfMind(profile?: string, signal?: AbortSignal): Promise<TopOfMind | null> {
  const row = await fetchTopOfMind({ profile }, signal);
  return row ? toTopOfMind(row) : null;
}

function toTopOfMind(row: ApiTopOfMind): TopOfMind {
  return {
    id: row.id,
    version: row.version,
    reason: row.reason,
    createdMs: ms(row.createdAt),
    entries: (row.entries ?? []).map(toEntry).filter((e) => !e.dismissed),
    supportChanged: row.supportChanged === true,
    generationRevision: row.generationRevision,
    profileId: row.profileId,
  };
}

export async function loadTopOfMindVersion(id: string, profile?: string, signal?: AbortSignal): Promise<TopOfMind> {
  return toTopOfMind(await fetchTopOfMindVersion(id, { profile }, signal));
}

/** One memory opened: the words in full, what was attached, and what the
    person said back. Enrichment comes through labelled, never as their words. */
export async function loadInspiration(id: string, profile?: string, signal?: AbortSignal): Promise<InspirationDetail> {
  const row = await fetchInspiration(id, { profile }, signal);
  if (row.id !== id || (profile && row.profileId !== profile)) throw new Error('Unexpected inspiration scope');
  return toInspirationDetail(row);
}

export function toInspirationDetail(row: Awaited<ReturnType<typeof fetchInspiration>>): InspirationDetail {
  return {
    id: row.id,
    preview: row.text || row.attachments.map(item => item.type === 'audio' ? 'Recording' : item.type === 'image' ? 'Photo' : item.name || item.url).join(' · '),
    isPublic: row.visibility === "public",
    text: row.text,
    kind: row.kind,
    source: row.source,
    capturedMs: ms(row.createdAt),
    updatedMs: ms(row.updatedAt) || ms(row.createdAt),
    attachments: (row.attachments ?? []).map((a) => ({
      id: a.id,
      type: a.type,
      label: a.name ?? (a.type === 'audio' ? 'Recording' : a.type === 'image' ? 'Photo' : a.url),
      ...(a.type === 'link' ? { url: a.url } : {}),
    })),
    reflectionCount: (row.reflections ?? []).filter((r) => !r.skipped && r.answer).length,
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
  };
}


/** One signal opened: the same statement, plus what it rests on. */
export async function loadSignal(id: string): Promise<SignalDetail> {
  const row = await fetchSignal(id);
  return { ...toSignal(row), evidence: (row.evidence ?? []).map((e) => toEvidence(row.id, e)) };
}

/* ---------------------------------------------------------------- aliveness */

/**
 * HOW ALIVE AN INSPIRATION IS, 0..1 — the only channel the world spends on it.
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
export function aliveness(c: Inspiration, now: number): number {
  const days = Math.max(0, (now - Math.max(c.updatedMs, c.capturedMs)) / 86_400_000);
  const decay = Math.pow(0.5, days / 7);
  const attention = 0.25 * Math.min(c.reflectionCount, 2) * decay;
  const hasWords = c.reflectionCount > 0 ? 0.15 : 0;
  const hasAttachment = c.attachments.length > 0 ? 0.1 : 0;
  return Math.max(0, Math.min(1, decay + attention + hasWords + hasAttachment));
}

/**
 * ONE PIECE OF EVIDENCE, AS THE WORLD SHOWS IT — with who it came from.
 *
 * Shared by the sky (a signal's orbit) and by headquarters (what a proposal
 * rests on), which is why it lives here rather than in either: two modules
 * needing one shape is exactly what this layer is for, and putting it in
 * either would make the other import it.
 */
/**
 * One memory a candidate is made of.
 *
 * A PERSONAL candidate resolves its evidence against the captures already
 * loaded and SKIPS anything that is not there — an id with nothing behind it
 * is not a memory, and inventing one would be a lie about what was saved. ROOM
 * evidence stands on its own: it arrives carrying its author and its words,
 * exactly as a room's own orbs do, so a satellite can say whose memory it is
 * without ever fetching another member's signal.
 */
export interface EvidenceRef {
  signalId: string;
  /** The room it came from, when it came from one. */
  groupId: string | null;
  authorUserId: string | null;
  authorName: string | null;
  /**
   * WHY THIS WAS WORTH KEEPING, in one short phrase — the whisper an agent's
   * satellite carries instead of an author's name. "얘가 이걸 만든 이유가
   * 이거다", rendered with the element that already exists.
   */
  why?: string | null;
  textPreview: string;
  quote: string | null;
  kind: string | null;
  createdMs: number;
  /** False when the payload named no date and `createdMs` is only a reference
      for the light — the panel then prints who, and no when. */
  dated: boolean;
  resonance: number;
}
