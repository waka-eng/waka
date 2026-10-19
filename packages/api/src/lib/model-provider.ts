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

import type { ConversationPerspective, PrincipleType, TopOfMindEntryType } from "../db/index.js";
import type { SupportedLocale } from "./locales.js";
import {timeModelProvider} from './performance-stages.js';

// ---------------------------------------------------------------------------
// Layer 2 — signal candidate extraction
// ---------------------------------------------------------------------------

/** Machine-derived context about something the human saved, not typed. */
export interface AttachmentEnrichmentContext {
  kind: "page_body" | "image_description" | "audio_transcription";
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
   * Categories this profile has already used.
   *
   * THE WHOLE DIFFERENCE BETWEEN A USEFUL ROW OF TABS AND A USELESS ONE.
   * Asked cold, a model names each capture with a fresh phrase, and fifty
   * saves become fifty categories of one — a filter where every option shows
   * you one thing, which is worse than no filter. Shown what already exists,
   * it reuses, and the vocabulary converges on the handful of things a person
   * actually keeps about.
   */
  existingCategories: string[];
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
  /**
   * WHAT THIS CAPTURE IS ABOUT, in a word or two — or null when nothing fits.
   *
   * It rides on this call rather than getting one of its own because this
   * call already reads the whole capture, its reflections and its
   * attachments. A second model round-trip per save, to answer a smaller
   * question about material already in front of a model, would be paid on
   * the one act the product promises costs nothing.
   *
   * It is a fact about the CAPTURE (layer 1), not about the statements
   * (layer 2), which is why it sits beside `statements` rather than inside
   * one — a capture that yields no statement still has a subject.
   */
  category: string | null;
}

/** A separate, exhaustive question about existing links, not new discovery.
 * Only current material from one inspiration is supplied; related memories
 * cannot lend this inspiration support it does not have. */
export interface SignalSupportAssessmentInput {
  sources: Array<{ id: string; kind: "inspiration" | "reflection" | "attachment"; text: string }>;
  claims: Array<{ signalId: string; statement: string }>;
}

export interface SignalSupportAssessmentResult {
  assessments: Array<{
    signalId: string;
    verdict: "supported" | "unsupported" | "unresolved";
    sourceIds: string[];
  }>;
}

// ---------------------------------------------------------------------------
// Layer 3 — whole-artifact synthesis
// ---------------------------------------------------------------------------

export interface TopOfMindSynthesisSignal {
  id: string;
  statement: string;
  /** Personal selection may mix new interests and established patterns. */
  status?: 'active' | 'emerging';
  confidence: number;
  evidenceCount: number;
  lastEvidenceAt: Date | null;
  /**
   * Which member holds this signal — set only on group synthesis, where the
   * cross-member reading is the whole point. Never set on personal passes.
   */
  ownerName?: string;
  /**
   * Open contested pairs: ids of signals IN THIS SAME LIST that this one
   * pulls against, per the owner's unarbitrated record. Selection guarantees
   * both voices are present before either is marked, so every id here is
   * citable. Personal passes only — contested pairs are one person's.
   */
  contestedWithIds?: string[];
  /**
   * The pattern's life in time, worded — "held for 4 months; last fed 2
   * weeks ago", "returning after 5 weeks quiet", "new this week". Personal
   * passes set it; the prompt renders it so the synthesis can tell an
   * anchor from an arrival. English tokens by design: prompt-internal
   * metadata, while the Locale line governs what the artifact speaks.
   */
  timeShape?: string;
}

/**
 * An entry the human has edited. It is sent so the model can build around it
 * — and it must come back byte-identical. The caller enforces that rather
 * than trusting it; see `countLockViolations` in
 * `lib/top-of-mind-synthesis.ts` for the check, and `assembleEntries` in the
 * same file for the copy that makes it true regardless.
 */
export interface TopOfMindLockedEntry {
  id: string;
  type: TopOfMindEntryType;
  body: string;
  belief: string | null;
  prompt: string | null;
  citedSignalIds: string[];
  /** Keep the person's wording without treating it as additional evidence. */
  supportChanged?: boolean;
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
   * True when emerging signals are included, by cold-start backfill or the
   * bounded recent-focus allowance. Status is per signal; only forming
   * interests are tentative, not established patterns elsewhere in the read.
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

export interface PrincipleGroundingInput {
  preferredLocale: SupportedLocale;
  signals: Array<{id:string;statement:string}>;
  candidates: Array<{id:string;statement:string;citedSignalIds:string[]}>;
}
export interface PrincipleGroundingResult {
  assessments: Array<{candidateId:string;supported:boolean}>;
}

/**
 * Asked per candidate against a bounded batch of standing principles. Conservative toward
 * `independent`: a duplicate is visible and mergeable; a silent merge or a
 * phantom conflict is not.
 */
export interface PrincipleRelationInput {
  preferredLocale: SupportedLocale;
  candidateStatement: string;
  existingPrinciples: Array<{id:string;statement:string}>;
}

export interface PrincipleRelation {
  relations: Array<{principleId:string;relation:"same" | "independent" | "conflicting"}>;
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

/**
 * THE MODEL NEVER ANSWERED USABLY — a transport failure, a truncated body,
 * a malformed envelope. This is a different fact from "the model answered:
 * nothing here", and for a long time the two were recorded identically:
 * extraction mapped it to zero candidates (the capture was marked derived
 * and never read again — silent, permanent loss of what the person kept),
 * and the judges mapped it to "independent" (a bad provider hour minted
 * duplicate signals that nothing ever revisits). Observed live 2026-08-30,
 * when a routed backend spent minutes reasoning and returned JSON cut off
 * mid-key: a whole batch of captures recorded as having nothing to teach.
 *
 * Thrown instead, it fails the JOB ATTEMPT — the queue already retries up
 * to max_attempts and parks the row as `failed`, visible and re-runnable,
 * which is the honest ending. Derivation is safe to retry by construction:
 * evidence is unique per (signal, inspiration) and re-extracted statements
 * land in the dedupe band of anything already minted.
 */
/**
 * THE MODEL DECLINED — a considered refusal (a safety block, a content
 * filter), which is terminal: retrying the same material cannot help, so
 * callers keep their safe postures for it (extraction: nothing here;
 * judges: independent). Distinct from `null`, which means the road failed
 * and the attempt should be retried. The transport is the only layer that
 * can tell the two apart, so it says which one happened.
 */
export const MODEL_DECLINED: unique symbol = Symbol("the model declined to answer");

export class ModelDidNotAnswerError extends Error {
  constructor(task: string, cause?: unknown) {
    super(`the model did not answer usably: ${task}`);
    this.name = "ModelDidNotAnswerError";
    this.cause = cause;
  }
}

/**
 * The model answered, but not in the shape asked for. At temperature 0 the same
 * input repeats the same reply, so a retry only pays for it again: the queue
 * records it once as a terminal failure (`malformed_model_output`) rather than
 * retrying, and never as an empty result.
 */
export class MalformedModelOutputError extends ModelDidNotAnswerError {
  readonly reason = "malformed_model_output" as const;
  constructor(task: string, cause?: unknown) {
    super(task, cause);
    this.name = "MalformedModelOutputError";
    this.message = `malformed_model_output: ${this.message}`;
  }
}

/** One follow-up grounded in the inspiration and the person's saved answers. */
export interface ReflectionQuestionInput {
  preferredLocale: SupportedLocale;
  inspirationText: string;
  reflections: Array<{ question: string; answer: string }>;
  attachments?: Array<{ type: 'link' | 'image' | 'audio' | 'file'; status: string; kind: string | null; text: string | null }>;
}

export interface ReflectionQuestionResult {
  question: string;
}

export interface ReviewQuestionInput {
  preferredLocale:SupportedLocale;
  contextChanged?:boolean;
  sources:Array<{text:string;reflections:Array<{question:string;answer:string}>;
    attachments:NonNullable<ReflectionQuestionInput['attachments']>}>;
  history:Array<{question:string;connection?:string|null;answer:string}>;
}
export interface ReviewQuestionResult {connection:string|null;question:string;sourceNumbers:number[]}
export interface ReviewAnswerDerivationInput {
  preferredLocale:SupportedLocale;
  answer:string;question:string|null;contextChanged:boolean;
  sources:ReviewQuestionInput['sources'];
  claims:Array<{signalId:string;statement:string}>;
  discover:boolean;
}
export interface ReviewAnswerDerivationResult {
  assessments:Array<{signalId:string;verdict:'supported'|'unsupported'|'unresolved';quote:string|null}>;
  statements:Array<{statement:string;quote:string}>;
}

export interface ConversationReplyInput {
  preferredLocale:SupportedLocale;
  messageDate?:string;
  contextChanged?:boolean;
  focusSourceNumber?:number;
  /** Absent for a chat about the person's own memory — every chat before
      2026-10-15, and the prompt is byte-identical for them. 'agent' reads
      only the agent's memory; 'both' reads both, each source marked `owner`. */
  perspective?:Exclude<ConversationPerspective,'mine'>;
  history:Array<{role:'user'|'assistant';content:string;correction?:boolean}>;
  sources:Array<{kind:'principle'|'top_of_mind_entry'|'inspiration';text:string;owner?:'person'|'agent';recordedAt?:string;artifactVersion?:number;historical?:boolean;state?:string;rank?:number;locked?:boolean;supportCurrent?:boolean;truncated:boolean}>;
}
export const CONVERSATION_REPLY_OUTPUT_TOKENS=1200;
export interface ConversationReplyResult {answer:string;followUpQuestion:string|null;citations:Array<{sourceNumber:number;quote:string}>}

export interface ModelProvider {
  readonly name: string;
  answerConversation(input:ConversationReplyInput):Promise<ConversationReplyResult>;
  askReflectionQuestion(input: ReflectionQuestionInput): Promise<ReflectionQuestionResult>;
  askReviewQuestion(input:ReviewQuestionInput):Promise<ReviewQuestionResult>;
  deriveReviewAnswer(input:ReviewAnswerDerivationInput):Promise<ReviewAnswerDerivationResult>;
  extractSignalCandidates(
    input: SignalCandidateExtractionInput,
  ): Promise<SignalCandidateExtractionResult>;
  assessSignalSupport(input: SignalSupportAssessmentInput): Promise<SignalSupportAssessmentResult>;
  judgeSignalMatch(input: SignalMatchJudgementInput): Promise<SignalMatchJudgement>;
  distillPrinciples(input: DistillPrinciplesInput): Promise<DistillPrinciplesResult>;
  assessPrincipleGrounding(input: PrincipleGroundingInput): Promise<PrincipleGroundingResult>;
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
    /* OpenRouter when its key is present (owner request, 2026-10-05:
       DeepSeek V4.1 Flash for generation); Gemini otherwise, so an environment
       without the new key — CI before the secret lands, a fresh checkout —
       keeps generating instead of failing. Rollback anywhere is deleting
       one env var. Embeddings are untouched by this switch: they are pinned
       to Gemini regardless of which road generation takes. */
    if (process.env.OPENROUTER_API_KEY?.trim()) {
      const { createOpenRouterModelProvider } = await import(
        "./openrouter-model-provider.js"
      );
      defaultProvider = timeModelProvider(createOpenRouterModelProvider());
    } else {
      const { createGeminiModelProvider } = await import("./gemini-model-provider.js");
      defaultProvider = timeModelProvider(createGeminiModelProvider());
    }
  }
  return defaultProvider;
}

export function setDefaultModelProviderForTests(provider: ModelProvider | null): void {
  defaultProvider = provider;
}
