/**
 * The seam between WAKA's generation pipeline and whichever model runs it.
 *
 * Two calls, one per generated layer:
 *
 *   extractSignalCandidates — layer 2, per inspiration. Reads one capture
 *     (its text, its reflections, its attachment enrichment) and proposes at
 *     most a handful of distilled statements, each grounded in a span it can
 *     quote. Matching, minting, and lifecycle are pure code downstream; the
 *     model's only job is to say what pattern this capture is evidence of.
 *
 *   synthesizeTopOfMind — layer 3, per refresh. Reads the profile's selected
 *     signals and returns the WHOLE artifact. The artifact is the unit: a
 *     model asked to patch entries has to reason about diffs it cannot see,
 *     and every incremental variant of this call in practice drifted into
 *     appending. It may also answer "nothing changed", which is a decision
 *     the caller records as a version rather than a silent no-op.
 *
 * Everything below the interface is deliberately shallow. Selection, ranking,
 * validation, versioning, and the lock rule live in lib/signal-match-or-mint.ts
 * and the lib/top-of-mind-* stage modules, where they are testable without a
 * model.
 */

import type { PrincipleType, TopOfMindEntryType } from "../db/index.js";
import type { SupportedLocale } from "./locales.js";

// ---------------------------------------------------------------------------
// Layer 2 — signal candidate extraction
// ---------------------------------------------------------------------------

/** Machine-derived context about something the human saved, not typed. */
export interface AttachmentEnrichmentContext {
  kind: "page_body" | "image_description";
  /** For a link, its hostname; for an image, its file name when known. */
  label: string | null;
  text: string;
}

/**
 * An earlier capture of the same profile, offered to extraction because its
 * vector sits near the current capture's. Context the model may CITE, never
 * material it may derive from alone: every statement must be grounded in the
 * current capture first, and a citation survives only with a verbatim quote
 * from this capture's own text, verified in code downstream.
 */
export interface RelatedInspirationContext {
  id: string;
  text: string;
  createdAt: Date;
}

export interface SignalCandidateExtractionInput {
  profileId: string;
  /** Statements come back in the profile owner's language, not the prompt's. */
  preferredLocale: SupportedLocale;
  inspiration: {
    id: string;
    text: string;
    /** "app" when the words are the human's, "agent" when an agent observed. */
    source: "app" | "agent";
    createdAt: Date;
  };
  /** The human's own answers — the strongest context a capture carries. */
  reflections: Array<{ question: string; answer: string }>;
  attachments: AttachmentEnrichmentContext[];
  /**
   * Statements the profile already holds. Passed so the model can phrase a
   * candidate the same way it phrased the pattern before; the actual
   * match-or-mint decision is made by cosine distance, not by the model.
   */
  existingStatements: Array<{ id: string; statement: string }>;
  /** Nearest earlier captures by embedding, strongest first. Often empty. */
  relatedInspirations: RelatedInspirationContext[];
}

export interface SignalCandidate {
  statement: string;
  /** Why this capture is evidence of that pattern. */
  reason?: string;
  /** A verbatim span. Absent is honest; invented is not. */
  quote?: string;
  /**
   * Earlier captures that independently witness this same pattern — each an
   * id from `relatedInspirations` plus a verbatim span of THAT capture's text.
   * Code validates both halves: unknown ids are dropped, and a quote that is
   * not genuinely in the cited capture drops the citation with it.
   */
  relatedEvidence?: Array<{ inspirationId: string; quote: string }>;
}

export interface SignalCandidateExtractionResult {
  statements: SignalCandidate[];
}

// ---------------------------------------------------------------------------
// Layer 3 — whole-artifact synthesis
// ---------------------------------------------------------------------------

export interface TopOfMindSynthesisSignal {
  id: string;
  statement: string;
  confidence: number;
  evidenceCount: number;
  lastEvidenceAt: Date | null;
  /**
   * Which member holds this signal — set only on group synthesis, where the
   * cross-member reading is the whole point. Never set on personal passes.
   */
  ownerName?: string;
}

/**
 * An entry the human has edited. It is sent so the model can build around it
 * — and it must come back byte-identical. The caller enforces that rather
 * than trusting it; see `countLockViolations` in
 * `lib/top-of-mind-validation.ts` for the check, and `assembleEntries` in
 * `lib/top-of-mind-versioning.ts` for the copy that makes it true regardless.
 */
export interface TopOfMindLockedEntry {
  id: string;
  type: TopOfMindEntryType;
  body: string;
  belief: string | null;
  prompt: string | null;
  citedSignalIds: string[];
}

/**
 * A verdict the person gave on something WAKA previously generated. Sent to
 * synthesis because a reader who says "this is not true" and is then shown
 * the same sentence again has been told their judgement does not count.
 */
export interface TopOfMindRecentFeedback {
  target: "signal" | "entry";
  /** What the verdict was about, so the model can recognise it. */
  about: string;
  value: "true" | "partly" | "not_true";
  /** The person's own words about what is wrong, when they gave any. */
  correction: string | null;
}

export interface TopOfMindSynthesisInput {
  profileId: string;
  preferredLocale: SupportedLocale;
  /** Ranked by the deterministic selector, strongest first. */
  signals: TopOfMindSynthesisSignal[];
  lockedEntries: TopOfMindLockedEntry[];
  /** The live artifact's generated entries, so "no change" is answerable. */
  currentEntries: Array<{
    type: TopOfMindEntryType;
    body: string;
    citedSignalIds: string[];
  }>;
  /** Newest first, bounded by the caller. */
  recentFeedback: TopOfMindRecentFeedback[];
  /**
   * True when the selection had to borrow still-forming (emerging) signals to
   * say anything at all — the cold start. The synthesis writes more
   * tentatively, because these patterns have been seen once or twice, not
   * confirmed by return.
   */
  provisional: boolean;
  /**
   * Present when the artifact belongs to a group rather than a profile. The
   * signals then carry `ownerName`s, and the synthesis speaks in the group's
   * shared voice rather than to one person.
   */
  group?: { name: string; memberNames: string[] };
}

export interface TopOfMindSynthesisEntry {
  type: TopOfMindEntryType;
  body: string;
  belief?: string;
  prompt?: string;
  citedSignalIds: string[];
}

export interface TopOfMindSynthesisResult {
  entries: TopOfMindSynthesisEntry[];
  /**
   * The model's read that the current artifact still holds. Advisory: the
   * caller decides, and records the decision either way.
   */
  noChange?: boolean;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Layer 2 — the merge judge
// ---------------------------------------------------------------------------

/**
 * Asked only inside the ambiguous cosine band, where distance alone cannot
 * say whether two statements name one pattern. Everything above the band
 * attaches and everything below mints without a call, so this costs at most
 * one call per candidate and usually none.
 */
export interface SignalMatchJudgementInput {
  preferredLocale: SupportedLocale;
  candidateStatement: string;
  existingStatement: string;
}

/**
 * Three-way since no-quiet-corners Phase 5 — the vocabulary principle
 * judging already used, brought down to layer 2: `same` attaches, and
 * `opposed` mints WITH an undirected `contradicts` relation so the dispute
 * is held on the record instead of dissolved by whichever statement came
 * second. `independent` is the conservative middle and every failure mode
 * lands there: a duplicate is visible and mergeable, a phantom opposition
 * manufactures a dispute the person never had.
 */
export interface SignalMatchJudgement {
  relation: "same" | "independent" | "opposed";
}

// ---------------------------------------------------------------------------
// Layer 4 — principles
// ---------------------------------------------------------------------------

/** One signal with its longevity stats, as distillation reads it. */
export interface PrincipleDistillSignal {
  id: string;
  statement: string;
  evidenceCount: number;
  firstEvidenceAt: Date | null;
  lastEvidenceAt: Date | null;
  tomAppearances: number;
}

export interface DistillPrinciplesInput {
  profileId: string;
  preferredLocale: SupportedLocale;
  signals: PrincipleDistillSignal[];
  /** The standing set — context for no-duplication; matching is the judge's job. */
  currentPrinciples: Array<{ id: string; statement: string; state: string }>;
  /** Live top-of-mind entries — what a principle must generalize beyond, never echo. */
  currentEntries: Array<{ body: string }>;
}

export interface PrincipleCandidate {
  statement: string;
  type: PrincipleType;
  citedSignalIds: string[];
}

export interface DistillPrinciplesResult {
  candidates: PrincipleCandidate[];
}

/**
 * Asked per candidate against each standing principle. Conservative toward
 * `independent`: a duplicate is visible and mergeable; a silent merge or a
 * phantom conflict is not.
 */
export interface PrincipleRelationInput {
  preferredLocale: SupportedLocale;
  candidateStatement: string;
  existingStatement: string;
}

export interface PrincipleRelation {
  relation: "same" | "independent" | "conflicting";
}

/**
 * Internal routing for an owner declaration — context, directive, and
 * completion applied quietly. The outcome is a destination, never a verdict
 * shown to the owner.
 */
export interface DeclarationRouteInput {
  preferredLocale: SupportedLocale;
  statement: string;
}

export interface DeclarationRoute {
  route: "principle" | "inspiration";
  /** Classified shape when the route is principle; maxim when unsure. */
  type: PrincipleType;
}

/**
 * THE JUDGE DID NOT SIT. NOT: THE JUDGE RULED AGAINST YOU.
 *
 * A declaration is routed, never refused — words that are really a rule or a
 * goal are kept as an inspiration, which is where they already belong, and no
 * verdict travels back. That silence is right when the tests actually ran.
 *
 * It was also, until 2026-08-22, what a person got when the tests could NOT
 * run. A missing key, a rate limit, a timeout and a considered rejection all
 * produced the same row and the same 201: the statement went in with the
 * inspirations and nothing anywhere recorded that nobody had looked at it.
 * They told WAKA how they choose, WAKA said nothing, and their words became a
 * note. Nothing downstream could tell the two apart either, because no state
 * distinguished them.
 *
 * So this exists to be the difference. "We could not consider this yet" is a
 * different sentence from a refusal, and the product rule forbids the second,
 * not the first.
 */
export class DeclarationNotConsideredError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "DeclarationNotConsideredError";
    this.cause = cause;
  }
}

export interface ModelProvider {
  readonly name: string;
  extractSignalCandidates(
    input: SignalCandidateExtractionInput,
  ): Promise<SignalCandidateExtractionResult>;
  judgeSignalMatch(input: SignalMatchJudgementInput): Promise<SignalMatchJudgement>;
  distillPrinciples(input: DistillPrinciplesInput): Promise<DistillPrinciplesResult>;
  judgePrincipleRelation(input: PrincipleRelationInput): Promise<PrincipleRelation>;
  routeDeclaration(input: DeclarationRouteInput): Promise<DeclarationRoute>;
  synthesizeTopOfMind(
    input: TopOfMindSynthesisInput,
  ): Promise<TopOfMindSynthesisResult>;
}

let defaultProvider: ModelProvider | null = null;

/**
 * Resolved lazily and through a dynamic import so nothing that merely wants
 * the *type* of a provider drags the Gemini client (and its API-key check)
 * into a cold start.
 */
export async function getDefaultModelProvider(): Promise<ModelProvider> {
  if (!defaultProvider) {
    const { createGeminiModelProvider } = await import("./gemini-model-provider.js");
    defaultProvider = createGeminiModelProvider();
  }
  return defaultProvider;
}

export function setDefaultModelProviderForTests(provider: ModelProvider | null): void {
  defaultProvider = provider;
}
