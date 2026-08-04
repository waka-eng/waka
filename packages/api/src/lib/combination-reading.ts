/**
 * What a combination wants.
 *
 * The notes layer says what several collections have in common that is
 * non-obvious. That is an observation. This layer asks the question the notes
 * never ask: **what is this combination after?**
 *
 * It reads the *accepted notes and their evidence*, never raw signals. The
 * integrity layer (two owners, no restatement, the judge's refusals) has
 * already decided what is a real combination; this stage speaks about what
 * survived, so it can never smuggle a combination past those gates.
 *
 * Three rules shape the output.
 *
 * **One statement, not three.** `ambition` is a single dissolved sentence. The
 * facets are optional, name their own dimension, and stay empty when the
 * evidence does not speak to one — a reading given a fixed set of facets pads
 * whichever it cannot see, the stacking failure the personal board corrected.
 *
 * **In their words.** Quotes are required, drawn from members' own saves, and
 * traced back with signal ids. An ambition nobody can trace to a heartbeat is
 * an LLM being fluent.
 *
 * **Forming is an answer.** When hearts have not yet said enough together, the
 * reader says so and names what is thin. That is a truer empty state than
 * silence, and it is the one the product most often needs.
 */

import { createHash } from "node:crypto";

import { z } from "zod";

import {
  buildGeminiJsonHeaders,
  buildGeminiModelEndpoint,
  formatSafeGeminiError,
  safeGeminiErrorDetails,
} from "./gemini-http.js";
import type {
  CombinationMemberQuote,
  CombinationPulseProfile,
  CombinationReadingFacet,
} from "../db/schema-combinations.js";
import { normalizeSupportedLocale, type SupportedLocale } from "./locales.js";

const GEMINI_MODEL = "gemini-3.1-flash-lite";
export const COMBINATION_READER_PROMPT_VERSION = "combination_reader_v1";
const MAX_OUTPUT_TOKENS = 1400;
/** Long enough for a real want; short enough that it cannot become a summary. */
const MAX_AMBITION_CHARS = 240;
const MAX_FACET_CHARS = 180;
/**
 * `whatsMissing` is explanatory prose, not a claim with a length rule.
 *
 * It was capped at the facet length and threw when the model went over, which
 * discarded an otherwise valid reading — the same mistake the ambition cap
 * made. Naming what is thin about a six-note board honestly takes more room
 * than a facet, and over-long prose is trimmed rather than treated as failure.
 */
const MAX_WHATS_MISSING_CHARS = 400;
/** A facet names its own dimension: "the pace", "who it is for", "the material". */
const MAX_DIMENSION_CHARS = 40;
/** Three is a reading with dimensions; more is the stack this layer forbids. */
const MAX_FACETS = 3;
const MAX_QUOTE_CHARS = 220;
/**
 * The longest run of characters an ambition may share verbatim with a save
 * before it counts as quoting rather than speaking their language.
 *
 * Vocabulary overlap is wanted — an ambition should sound like the people it
 * belongs to. Lifted spans are not: they are the seams of the evidence showing
 * through a sentence that was supposed to dissolve it.
 */
const MAX_BORROWED_SPAN_CHARS = 24;

/**
 * A save fast enough to be a reaction rather than a composition.
 *
 * `captureElapsedMs` is composer-open→save. Under a minute, the hand moved
 * before the argument did; past that, the person was writing rather than
 * reacting. Crude on purpose — it orders, it does not measure.
 */
const REACTION_THRESHOLD_MS = 60_000;

export interface CombinationReaderEvidence {
  signalId: string;
  userId: string;
  /**
   * How differently this save reads beside this room versus alone, 0–100,
   * when the divergence pass has scored it.
   *
   * This is the sharpest evidence a combination-only reading can have: a
   * signal that means something else here than it does on its owner's wall is
   * the founder's claim happening in one row. Ranked first, and told to the
   * model, so the reading is built from where the combination actually
   * changed something.
   */
  divergenceScore?: number | null;
  /** Anonymous, stable label — "member A". Names never reach the model. */
  memberLabel: string;
  text: string;
  createdAt: Date;
  /** Composer-open→save duration, when the save recorded one. */
  captureElapsedMs?: number | null;
}

export interface CombinationReaderNote {
  id: string;
  title: string;
  why: string;
  /** Signal ids this note rests on. */
  evidenceSignalIds: string[];
}

export interface CombinationReaderInput {
  notes: CombinationReaderNote[];
  /**
   * Every save the reader may speak from — not only the ones grounding a note.
   *
   * Notes remain the integrity gate: they decide which combinations are real.
   * But a note is already an abstraction ("Deployment as the new product
   * frontier"), and a reading built only from notes is a summary of summaries,
   * which is why the first real run came back at domain level instead of at
   * the level the people actually live at. The specific, strange material —
   * the one about a spa versus a hospital, the one about context being a moat
   * — is where a want is audible, so it reaches the reader too.
   */
  evidence: CombinationReaderEvidence[];
  /** Member labels present in this combination, e.g. ["member A", "member B"]. */
  memberLabels: string[];
  locale?: SupportedLocale;
}

export type CombinationReading =
  | {
      state: "revealed";
      ambition: string;
      /**
       * Whatever dimensions this want actually has, named by the reading.
       *
       * This used to be three fixed columns — impact, people, place — which
       * asserted that a want is the kind of thing with an effect, a who and a
       * where. Plenty are not: a combination can be after a standard of craft,
       * a pace, a material, an audience, a question nobody is asking. Given
       * only three boxes the reader stayed silent about everything else, and
       * that silence read as "the evidence is thin" when the truth was that
       * the schema had guessed wrong about what wants are made of.
       */
      facets: CombinationReadingFacet[];
      awayFrom: string | null;
      tension: string | null;
      nextQuestion: string | null;
      quotes: CombinationMemberQuote[];
      groundedNoteIds: string[];
      whatsMissing: string | null;
    }
  | {
      state: "forming";
      whatsMissing: string;
    };

/** Reaction/composition mix of the evidence a reading rests on. */
export function summarizePulse(
  evidence: Pick<CombinationReaderEvidence, "captureElapsedMs">[],
): CombinationPulseProfile {
  const known = evidence
    .map((item) => item.captureElapsedMs)
    .filter((ms): ms is number => typeof ms === "number" && Number.isFinite(ms));
  const sorted = [...known].sort((a, b) => a - b);
  const median =
    sorted.length === 0
      ? null
      : sorted.length % 2 === 1
        ? sorted[(sorted.length - 1) / 2]!
        : Math.round((sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2);
  return {
    reactionCount: known.filter((ms) => ms <= REACTION_THRESHOLD_MS).length,
    compositionCount: known.filter((ms) => ms > REACTION_THRESHOLD_MS).length,
    unknownCount: evidence.length - known.length,
    medianElapsedMs: median,
  };
}

/** Earliest and latest save a reading rests on. */
export function evidenceSpan(
  evidence: Pick<CombinationReaderEvidence, "createdAt">[],
): { start: Date | null; end: Date | null } {
  if (evidence.length === 0) return { start: null, end: null };
  const times = evidence.map((item) => item.createdAt.getTime());
  return { start: new Date(Math.min(...times)), end: new Date(Math.max(...times)) };
}

/**
 * Identity of the material a reading was made from.
 *
 * Changes when the notes or their evidence change, so a stored reading can be
 * told apart from one made before members saved more — the provenance lesson
 * from this project's own history of comparing runs that differed in more than
 * one way.
 */
export function signalSetHash(input: CombinationReaderInput): string {
  const noteIds = input.notes.map((note) => note.id).sort();
  const signalIds = input.evidence.map((item) => item.signalId).sort();
  return createHash("sha256")
    .update(`${COMBINATION_READER_PROMPT_VERSION}|${noteIds.join(",")}|${signalIds.join(",")}`)
    .digest("hex");
}

const SYSTEM_INSTRUCTION = `You read what a combination of people is AFTER.

You are given notes that have already been judged as genuine cross-member
readings and the signals each note rests on, plus "alsoSaved" — other things
these people saved that no note has claimed yet. Each signal carries an
anonymous member label, whether it was saved as a fast REACTION or a slower
COMPOSITION, and "readsDifferentlyHere": 0-100 for how differently that signal
reads beside THIS group versus alone.

The notes tell you which combinations are real. The signals tell you how these
people actually talk. Build the want from the signals; use the notes only to
know which ground is solid.

Your task is not to summarise the notes. It is to say what this particular
combination of people WANTS. State it once, in one sentence, in the people's
own vocabulary.

Rules:
- ONE ambition sentence. Never a list of themes, never a stack of the notes.
- Speak in the members' OWN VOCABULARY — their terms, their register — but do
  NOT quote them. The ambition must contain no quotation marks and no borrowed
  phrases lifted word for word. Write the want as they would say it plainly to
  a friend, not as a sentence built out of citations.
- Separately, in the quotes field, list the real lines the ambition rests on: at least
  one per member you are claiming it from, covering at least two members. That
  is where the evidence lives. The sentence itself stays clean.
- facets are OPTIONAL: zero to three. A facet is one dimension this want
  actually has, and YOU name the dimension from the evidence — it might be the
  pace, the material, the standard of craft, who it is for, what it refuses,
  where it has to happen, who they want to build it with. Do not reach for any
  fixed set of dimensions; most wants have one or two, and some have none.
  Each facet must be as concrete as the ambition. Omit rather than invent, and
  say what is missing instead.
- awayFrom / tension / nextQuestion are OPTIONAL too. Omit any the evidence
  does not genuinely speak to.
- If the signals do not yet say enough together to name a want, return
  state "forming" and describe plainly what is thin. That is a correct answer,
  not a failure.
- Reactions carry more weight than compositions: a fast save is a pulse before
  the reasons arrived.
- A high "readsDifferentlyHere" is the strongest evidence you have. A signal
  that means something else beside these people than it does alone is the
  combination doing its work — build the want from those first.
- Be CONCRETE. These people save specific, strange, particular things. A want
  pitched at the level of an industry trend ("building physical AI products")
  has failed even if it is accurate. Name the thing they would recognise as
  theirs.
- "alsoSaved" signals may not create a claim on their own, but they are how a
  member whose saves ground no note still has a voice in what this group wants.
- Never mention member labels in the ambition text itself. Speak about the
  want, not about the mechanics of who saved what.
- Write EVERY field in the language named by "locale" in the payload, whatever
  language the signals themselves are in. A board that answers in a different
  language on each refresh is not the same board.`;

/**
 * Order evidence by where the combination did the most work.
 *
 * Divergence first — a save that reads differently here than alone is the
 * claim itself. Then reactions over compositions, because a fast save is a
 * pulse before the reasons arrived. Ties by id, so a pass stays reproducible.
 */
function rankEvidence(evidence: CombinationReaderEvidence[]): CombinationReaderEvidence[] {
  return [...evidence].sort((a, b) => {
    const divergence = (b.divergenceScore ?? -1) - (a.divergenceScore ?? -1);
    if (divergence !== 0) return divergence;
    const pulse = (a.captureElapsedMs ?? Number.MAX_SAFE_INTEGER) -
      (b.captureElapsedMs ?? Number.MAX_SAFE_INTEGER);
    if (pulse !== 0) return pulse;
    return a.signalId.localeCompare(b.signalId);
  });
}

/** Evidence the notes rest on, plus the sharpest of the rest. */
const MAX_UNGROUNDED_EVIDENCE = 24;

function buildUserPayload(input: CombinationReaderInput) {
  const byId = new Map(input.evidence.map((item) => [item.signalId, item]));
  const groundedIds = new Set(input.notes.flatMap((note) => note.evidenceSignalIds));
  const alsoSaved = rankEvidence(
    input.evidence.filter((item) => !groundedIds.has(item.signalId)),
  ).slice(0, MAX_UNGROUNDED_EVIDENCE);
  return {
    promptVersion: COMBINATION_READER_PROMPT_VERSION,
    locale: normalizeSupportedLocale(input.locale),
    members: input.memberLabels,
    /**
     * Saves that ground no note yet. They cannot create a combination — the
     * notes above already decided that — but they are how a member who
     * grounds nothing still has a voice in what the room wants.
     */
    alsoSaved: alsoSaved.map((item) => ({
      signalId: item.signalId,
      savedBy: item.memberLabel,
      readsDifferentlyHere: item.divergenceScore ?? null,
      text: item.text.slice(0, 800),
    })),
    notes: input.notes.map((note) => ({
      id: note.id,
      title: note.title,
      why: note.why,
      evidence: note.evidenceSignalIds
        .map((id) => byId.get(id))
        .filter((item): item is CombinationReaderEvidence => Boolean(item))
        .map((item) => ({
          signalId: item.signalId,
          savedBy: item.memberLabel,
          readsDifferentlyHere: item.divergenceScore ?? null,
          pulse:
            typeof item.captureElapsedMs === "number"
              ? item.captureElapsedMs <= REACTION_THRESHOLD_MS
                ? "reaction"
                : "composition"
              : "unknown",
          text: item.text.slice(0, 1200),
        })),
    })),
  };
}

/** Keep explanatory prose to a readable length without discarding a reading. */
function trimProse(value: string): string {
  const text = value.trim();
  if (text.length <= MAX_WHATS_MISSING_CHARS) return text;
  // Cut at a sentence end when one is near the limit, so the trim does not
  // leave a dangling clause on screen.
  const window = text.slice(0, MAX_WHATS_MISSING_CHARS);
  const lastStop = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "));
  return lastStop > MAX_WHATS_MISSING_CHARS * 0.6
    ? window.slice(0, lastStop + 1)
    : `${window.trimEnd()}…`;
}

const readingResponseSchema = z.union([
  z
    .object({
      state: z.literal("revealed"),
      // Accepted generously here; the length rule is a quality guard below,
      // not a parse error. Throwing on it discards a reading we could judge.
      ambition: z.string().trim().min(1).max(MAX_AMBITION_CHARS * 4),
      facets: z
        .array(
          z.object({
            dimension: z.string().trim().min(1).max(MAX_DIMENSION_CHARS),
            text: z.string().trim().min(1).max(MAX_FACET_CHARS),
          }),
        )
        .max(MAX_FACETS)
        .nullish(),
      awayFrom: z.string().trim().max(MAX_FACET_CHARS).nullish(),
      tension: z.string().trim().max(MAX_FACET_CHARS).nullish(),
      nextQuestion: z.string().trim().max(MAX_FACET_CHARS).nullish(),
      whatsMissing: z.string().trim().max(MAX_WHATS_MISSING_CHARS * 4).nullish(),
      quotes: z
        .array(
          z.object({
            savedBy: z.string().trim().min(1),
            signalId: z.string().trim().min(1),
            quote: z.string().trim().min(1).max(MAX_QUOTE_CHARS),
          }),
        )
        .min(1),
      // Optional: derived from the verified quotes when the model omits it.
      groundedNoteIds: z.array(z.string().trim().min(1)).optional(),
    })
    .passthrough(),
  z
    .object({
      state: z.literal("forming"),
      whatsMissing: z.string().trim().min(1).max(MAX_WHATS_MISSING_CHARS * 4),
    })
    .passthrough(),
]);

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    state: { type: "STRING", enum: ["revealed", "forming"] },
    ambition: { type: "STRING" },
    facets: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { dimension: { type: "STRING" }, text: { type: "STRING" } },
        required: ["dimension", "text"],
      },
    },
    awayFrom: { type: "STRING" },
    tension: { type: "STRING" },
    nextQuestion: { type: "STRING" },
    whatsMissing: { type: "STRING" },
    quotes: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          savedBy: { type: "STRING" },
          signalId: { type: "STRING" },
          quote: { type: "STRING" },
        },
        required: ["savedBy", "signalId", "quote"],
      },
    },
    groundedNoteIds: { type: "ARRAY", items: { type: "STRING" } },
  },
  // `state` alone is required because `forming` legitimately carries nothing
  // else. Everything the revealed branch needs is either validated below or
  // derived from the input.
  required: ["state"],
};

export function buildCombinationReaderRequest(input: CombinationReaderInput) {
  return {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [
      { role: "user", parts: [{ text: JSON.stringify(buildUserPayload(input), null, 2) }] },
    ],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 0 },
      responseSchema: RESPONSE_SCHEMA,
    },
  };
}

/**
 * Words the reading claims are the members'. Only quotes that actually appear
 * in a cited signal survive — a reading that invents a line is a reading that
 * has stopped being about anyone's heartbeat.
 */
export function verifyQuotes(
  quotes: Array<{ savedBy: string; signalId: string; quote: string }>,
  evidence: CombinationReaderEvidence[],
): CombinationMemberQuote[] {
  const byId = new Map(evidence.map((item) => [item.signalId, item]));
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
  const kept: CombinationMemberQuote[] = [];
  for (const quote of quotes) {
    const source = byId.get(quote.signalId);
    if (!source) continue;
    if (!normalize(source.text).includes(normalize(quote.quote))) continue;
    kept.push({ userId: source.userId, signalId: source.signalId, quote: quote.quote.trim() });
  }
  return kept;
}

/**
 * Does the ambition dissolve the notes, or restate one?
 *
 * The top-of-mind voice rule, applied one layer up: a reading that repeats a
 * note's title in different words has summarised rather than revealed. The bar
 * is deliberately generous — only near-restatement trips it.
 */
export function restatesANote(ambition: string, notes: CombinationReaderNote[]): boolean {
  const tokens = (value: string) =>
    new Set(
      value
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter((token) => token.length > 2),
    );
  const left = tokens(ambition);
  if (left.size === 0) return false;
  for (const note of notes) {
    const right = tokens(note.title);
    let shared = 0;
    for (const token of left) if (right.has(token)) shared += 1;
    if (shared / left.size >= 0.8) return true;
  }
  return false;
}

/** Quotation marks of the scripts this product actually sees. */
const QUOTE_MARKS = /["'“”„«»「」『』]/u;

/**
 * Does the ambition quote a save rather than speak its language?
 *
 * Two signals, both cheap. Quotation marks at all — a want stated plainly to a
 * friend does not carry them. And any verbatim run longer than a phrase, found
 * by sliding a window over the evidence, which catches lifting that dropped the
 * punctuation on the way.
 */
export function borrowsVerbatim(
  ambition: string,
  evidence: Pick<CombinationReaderEvidence, "text">[],
): boolean {
  if (QUOTE_MARKS.test(ambition)) return true;
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
  const haystack = evidence.map((item) => normalize(item.text));
  const needle = normalize(ambition);
  for (let i = 0; i + MAX_BORROWED_SPAN_CHARS <= needle.length; i += 1) {
    const span = needle.slice(i, i + MAX_BORROWED_SPAN_CHARS);
    if (haystack.some((text) => text.includes(span))) return true;
  }
  return false;
}

export interface CombinationReaderClient {
  read(input: CombinationReaderInput): Promise<CombinationReading>;
}

function getGeminiApiKey(): string {
  const fromEnv = process.env.GEMINI_API_KEY;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  const sstLink = process.env.SST_RESOURCE_GeminiApiKey;
  if (sstLink) {
    try {
      const parsed = JSON.parse(sstLink) as { value?: string };
      if (parsed?.value) return parsed.value;
    } catch {
      // fall through
    }
  }
  throw new Error("Gemini API key is not configured (GEMINI_API_KEY).");
}

export class GeminiCombinationReader implements CombinationReaderClient {
  readonly model = GEMINI_MODEL;
  private readonly fetchFn: typeof fetch;
  private readonly apiKey?: string;

  constructor(options: { apiKey?: string; fetchFn?: typeof fetch } = {}) {
    this.apiKey = options.apiKey;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async read(input: CombinationReaderInput): Promise<CombinationReading> {
    const apiKey = this.apiKey ?? getGeminiApiKey();
    const response = await this.fetchFn(
      buildGeminiModelEndpoint(GEMINI_MODEL, "generateContent"),
      {
        method: "POST",
        headers: buildGeminiJsonHeaders(apiKey),
        body: JSON.stringify(buildCombinationReaderRequest(input)),
      },
    );
    if (!response.ok) {
      throw new Error(
        formatSafeGeminiError(
          "Combination reader failed",
          await safeGeminiErrorDetails(response),
        ),
      );
    }

    const raw = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = raw.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      // A reply we cannot read is not an answer — same lesson as the judge.
      // The caller retries; it must not be recorded as "nothing to say".
      throw new Error("Combination reader returned unparseable JSON");
    }

    const parsed = readingResponseSchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new Error(`Combination reader response failed validation: ${parsed.error.message}`);
    }
    if (parsed.data.state === "forming") {
      return { state: "forming", whatsMissing: trimProse(parsed.data.whatsMissing) };
    }

    const data = parsed.data;
    const quotes = verifyQuotes(data.quotes, input.evidence);
    const distinctQuoted = new Set(quotes.map((quote) => quote.userId));
    /**
     * Grounding is derivable, so do not depend on the model to state it.
     *
     * A note is grounding when the reading quoted evidence that note rests on
     * — that relationship is already in the input. Asking the model for it a
     * second time only adds a way for a good reading to be thrown away over
     * an omitted field, which is what happened on the first real run.
     */
    const quotedSignalIds = new Set(quotes.map((quote) => quote.signalId));
    const derivedNoteIds = input.notes
      .filter((note) => note.evidenceSignalIds.some((id) => quotedSignalIds.has(id)))
      .map((note) => note.id);
    const claimed = (data.groundedNoteIds ?? []).filter((id) =>
      input.notes.some((note) => note.id === id),
    );
    const groundedNoteIds = [...new Set([...claimed, ...derivedNoteIds])];

    // The integrity conditions, enforced here rather than trusted from the
    // model: real traceable words, from at least two hearts, saying something
    // the notes did not already say.
    if (quotes.length === 0 || distinctQuoted.size < 2) {
      return {
        state: "forming",
        whatsMissing:
          "A want was proposed but could not be traced to at least two members' own words.",
      };
    }
    if (groundedNoteIds.length === 0) {
      return {
        state: "forming",
        whatsMissing: "A want was proposed but not grounded in any accepted reading.",
      };
    }
    if (data.ambition.length > MAX_AMBITION_CHARS) {
      /**
       * Too long is not a transport failure — it is the model stacking the
       * notes instead of dissolving them. A want a person could say out loud
       * fits in a sentence; past that it has become a summary of the board,
       * which is the thing this layer exists not to be.
       */
      return {
        state: "forming",
        whatsMissing:
          "The reading ran to a summary of the board rather than one thing the combination wants.",
      };
    }
    if (borrowsVerbatim(data.ambition, input.evidence)) {
      return {
        state: "forming",
        whatsMissing:
          "The reading quoted saves verbatim instead of saying the want in the group's own plain words.",
      };
    }
    if (restatesANote(data.ambition, input.notes)) {
      return {
        state: "forming",
        whatsMissing:
          "The reading restated a single note rather than naming what the combination wants.",
      };
    }

    return {
      state: "revealed",
      ambition: data.ambition,
      facets: (data.facets ?? []).map((facet) => ({
        dimension: facet.dimension,
        text: facet.text,
      })),
      awayFrom: data.awayFrom ?? null,
      tension: data.tension ?? null,
      nextQuestion: data.nextQuestion ?? null,
      whatsMissing: data.whatsMissing ? trimProse(data.whatsMissing) : null,
      quotes,
      groundedNoteIds,
    };
  }
}
