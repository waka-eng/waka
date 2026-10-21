/**
 * Layer 4 generation: how principles are minted from what survives.
 *
 * The mirror of top-of-mind synthesis in both directions that matter.
 * Selection is by LONGEVITY, not recency — a principle is what keeps being
 * true after the current moment moves on. And generation is mint-or-match
 * into an open, uncapped set (signals-shaped), not a whole-artifact rewrite
 * (top-of-mind-shaped): one candidate at a time, judged against the standing
 * set, merged on overlap, marked contested on genuine collision.
 *
 * Material changes request a deduplicated background pass. The nightly cron
 * recovers missed work. Three evidenced patterns and a citing top-of-mind
 * version can support an initial principle, without a fixed calendar wait.
 *
 * Canon: docs/data-model.md ("Principle (layer 4)"); mechanics and the
 * qualification tests: docs/generation.md; phases: docs/goals/principles.md.
 */

import { and, asc, eq, getTableColumns, inArray, isNotNull, or, sql } from "drizzle-orm";

import { createHash } from "node:crypto";
import { readGenerationRevision, assertGenerationRevision } from "./generation-revision.js";
import { personalEntrySupportCurrent, personalPrincipleSupportCurrent, personalSignalReadable, projectPersonalEntries } from "./personal-output.js";
import { citationStatementCurrent, evidenceSupportCurrent, loadSignalStatementRevisions } from './signal-support-state.js';
import {
  principles,
  principleSignals,
  signals,
  topOfMindEntrySignals,
  topOfMindEntries,
  topOfMinds,
  profiles,
  principleGenerationSteps,
} from "../db/index.js";
import { getDb } from "./db.js";
import { normalizeSupportedLocale } from "./locales.js";
import { selectIndependentEvidence } from './signal-lifecycle.js';
import {loadSignalEvidence} from './review-evidence.js';
import {PRINCIPLE_COMPARISON_LIMITS,PRINCIPLE_GROUNDING_LIMITS,PRINCIPLE_INPUT_LIMITS,selectPrincipleInput,renderPrincipleDistillContext} from './principle-input.js';
import {GEMINI_GENERATION_MODEL,parseDistilledPrinciples,parsePrincipleRelation,parsePrincipleGrounding,PRINCIPLE_DISTILL_SYSTEM_INSTRUCTION,PRINCIPLE_RELATION_JUDGE_SYSTEM_INSTRUCTION,PRINCIPLE_GROUNDING_SYSTEM_INSTRUCTION} from '../queue/gemini.js';
import {principleMaterialKey} from './principle-material-key.js';
import {principleWork} from './principle-work.js';
import {OPENROUTER_GENERATION_MODEL} from './openrouter-http.js';
import { writePrincipleStatementChain } from "./statement-chains.js";
import {
  getDefaultModelProvider,
  type ModelProvider,
  type PrincipleCandidate,
} from "./model-provider.js";

type WakaDb = ReturnType<typeof getDb>;
type WakaTx = Parameters<Parameters<WakaDb["transaction"]>[0]>[0];

// ---------------------------------------------------------------------------
// Tuning — the longevity bar. Named exports so docs/generation.md can pin
// them (drift-locked in Phase 6 of the goal), tuned only with real data.
// ---------------------------------------------------------------------------

/** Distinct citing signals a principle must rest on. */
export const PRINCIPLE_MIN_SIGNALS = 3;

/** No calendar wait for an initial principle; evidence is still required. */
export const PRINCIPLE_MIN_SPAN_DAYS = 0;

/** Distinct top-of-mind versions the citing signals were selected into. */
export const PRINCIPLE_MIN_TOM_APPEARANCES = 1;

/** Statement ceiling — a principle is a directive, not an essay. */
export const PRINCIPLE_MAX_STATEMENT_LENGTH = 200;

/** Candidates one nightly distillation may propose for one profile. */
export const PRINCIPLE_MAX_CANDIDATES_PER_RUN = 3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * E2e cannot wait 45 days or for midnight, so the bars accept env overrides —
 * honored only when the variable is set, absent in deployed configuration.
 * The exported constants stay the truth the docs pin.
 */
function bar(name: "SPAN" | "SIGNALS" | "TOM"): number {
  const override = process.env[`WAKA_PRINCIPLE_MIN_${name}_OVERRIDE`];
  if (override !== undefined && override !== "") {
    const parsed = Number.parseInt(override, 10);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return name === "SPAN"
    ? PRINCIPLE_MIN_SPAN_DAYS
    : name === "SIGNALS"
      ? PRINCIPLE_MIN_SIGNALS
      : PRINCIPLE_MIN_TOM_APPEARANCES;
}

// ---------------------------------------------------------------------------
// Pure arithmetic — what the unit tests pin.
// ---------------------------------------------------------------------------

export interface CitationEvidence {
  signalId: string;
  /** Evidence timestamps of the signal itself. */
  evidenceAt: Date[];
  /** Distinct meaningful reading versions; no-change audits share their anchor. */
  tomVersionIds: string[];
  /** Current evidence identity; dates alone cannot distinguish edited sources. */
  supportKey?: string;
}

export interface EligibilityVerdict {
  eligible: boolean;
  distinctSignals: number;
  spanDays: number;
  tomAppearances: number;
}

/**
 * The longevity bar, applied to one set of citing signals.
 *
 * Span is the first-to-last across the UNION of the signals' evidence — the
 * theme's lifetime, not any one signal's. Top-of-mind appearances count
 * distinct versions in which ANY citing signal was selected: survival of the
 * theme, however it was worded that week.
 */
export function computeCitationEligibility(
  citations: CitationEvidence[],
  now: Date,
): EligibilityVerdict {
  const distinctSignals = new Set(citations.map((row) => row.signalId)).size;

  const times = citations
    .flatMap((row) => row.evidenceAt)
    .map((date) => date.getTime())
    .filter((t) => Number.isFinite(t) && t <= now.getTime());
  const spanDays =
    times.length < 2 ? 0 : (Math.max(...times) - Math.min(...times)) / MS_PER_DAY;

  const tomAppearances = new Set(citations.flatMap((row) => row.tomVersionIds)).size;

  return {
    eligible:
      distinctSignals >= bar("SIGNALS") &&
      citations.every((row) => row.evidenceAt.some((at) => at <= now)) &&
      spanDays >= bar("SPAN") &&
      tomAppearances >= bar("TOM"),
    distinctSignals,
    spanDays,
    tomAppearances,
  };
}

/**
 * Where a new principle lands in the order.
 *
 * Rank is THE tie-breaker, so its maintenance is deliberately dumb: append
 * at the bottom, always. When the owner has arranged the order (any row
 * carries owner_ranked_at), that arrangement is sticky and generation never
 * re-sorts — this function is the whole of what generation may do to rank.
 */
export function nextRank(existing: Array<{ rank: number }>): number {
  return existing.length === 0 ? 1 : Math.max(...existing.map((row) => row.rank)) + 1;
}

/**
 * What happens to a standing principle whose citations no longer clear the
 * bar. Declared or edited wording stays, with lost support recorded. Only an
 * unedited minted claim is removed. A disagreement survives either outcome
 * for preserved words, and still-eligible rows are untouched.
 */
export function reconcileAction(
  row: { origin: "minted" | "declared"; state: "held" | "aspirational" | "contested"; lockedAt?: Date | null },
  stillEligible: boolean,
): "keep" | "demote" | "remove" {
  if (row.state === "aspirational" || stillEligible) return "keep";
  return row.origin === "declared" || row.lockedAt != null ? "demote" : "remove";
}

/** Redemption: only an aspirational principle promotes, and only on the bar. */
export function promoteDecision(
  state: "held" | "aspirational" | "contested",
  eligible: boolean,
): boolean {
  return state === "aspirational" && eligible;
}

// ---------------------------------------------------------------------------
// Evidence loading
// ---------------------------------------------------------------------------

async function loadCitationEvidence(
  db: WakaDb | WakaTx,
  profileId: string,
  signalIds: string[],
  countDismissed = false,
): Promise<Map<string, CitationEvidence>> {
  const out = new Map<string, CitationEvidence>();
  if (signalIds.length === 0) return out;
  for (const id of signalIds) {
    out.set(id, { signalId: id, evidenceAt: [], tomVersionIds: [] });
  }
  // Dated by the CAPTURE that witnesses it, not by when the link was noticed
  // — same rule as confidence and selection. The span describes the
  // theme's lifetime in the profile's history; a retroactively cited old save
  // must widen it with its own date, not collapse it to the day of noticing.
  // (A room mind's public-member evidence branch retired with the room engine.)
  const witnesses=(await loadSignalEvidence(db,profileId,signalIds)).witnesses;
  for(const [id,rows] of witnesses)out.get(id)!.evidenceAt=selectIndependentEvidence(rows).map(row=>row.createdAt);

  {
    // Metadata only. Personal revisions include authorized reflection/media
    // edits; review material hashes include the answer and referenced sources.
    // Neither a support check timestamp nor an audit version belongs here.
    const identities=await db.execute<{signalId:string;kind:string;unitId:string;sourceId:string;revision:string}>(sql`
      SELECT e.signal_id AS "signalId",'inspiration' AS kind,e.inspiration_id::text AS "unitId",
        e.inspiration_id::text AS "sourceId",r.personal_revision::text AS revision
      FROM signal_evidence e
      JOIN signals s ON s.id=e.signal_id AND s.profile_id=e.profile_id
      JOIN inspiration_revisions r ON r.inspiration_id=e.inspiration_id AND r.profile_id=e.owner_profile_id
      WHERE e.profile_id=${profileId}::uuid AND e.owner_profile_id=${profileId}::uuid
        AND e.signal_id IN (${sql.join(signalIds.map(id=>sql`${id}::uuid`),sql`,`)})
        AND ${evidenceSupportCurrent('e','s')}
      UNION ALL
      SELECT e.signal_id AS "signalId",'review' AS kind,e.session_id::text AS "unitId",
        e.answer_id::text AS "sourceId",r.material_hash AS revision
      FROM signal_review_evidence e
      JOIN signals s ON s.id=e.signal_id AND s.profile_id=e.profile_id
      JOIN review_signal_support r ON r.profile_id=e.profile_id AND r.signal_id=e.signal_id AND r.answer_id=e.answer_id
      WHERE e.profile_id=${profileId}::uuid
        AND e.signal_id IN (${sql.join(signalIds.map(id=>sql`${id}::uuid`),sql`,`)})
        AND review_evidence_current(e.profile_id,e.signal_id,e.answer_id,s.statement_revision) IS TRUE`);
    const currentUnits=new Map([...witnesses].map(([id,rows])=>[id,new Set(rows.map(row=>`${row.lineage!.kind}:${row.lineage!.unitId}`))]));
    const keys=new Map<string,Set<string>>();
    for(const row of identities){
      if(!currentUnits.get(row.signalId)?.has(`${row.kind}:${row.unitId}`))continue;
      const values=keys.get(row.signalId)??new Set<string>();
      values.add(JSON.stringify([row.kind,row.sourceId,row.revision]));keys.set(row.signalId,values);
    }
    for(const [id,bucket] of out)bucket.supportKey=createHash('sha256').update(JSON.stringify([...(keys.get(id)??[])].sort())).digest('hex');
  }

  const tomRows = await db
    .select({ signalId: topOfMindEntrySignals.signalId,
      // Validate support on the actual cited row below, but do not count an
      // unchanged audit copy as a new appearance or a new paid-work identity.
      // Keeping this separate from filtering rows preserves current support
      // when the latest copy refreshed citations to a new signal revision.
      topOfMindId: sql<string>`CASE WHEN ${topOfMinds.reason} = 'no_change' THEN COALESCE((
        SELECT meaningful.id FROM top_of_minds meaningful
        WHERE meaningful.profile_id IS NOT DISTINCT FROM ${topOfMinds.profileId}
          AND meaningful.group_id IS NOT DISTINCT FROM ${topOfMinds.groupId}
          AND meaningful.version <= ${topOfMinds.version}
          AND meaningful.reason <> 'no_change'
        ORDER BY meaningful.version DESC, meaningful.created_at DESC LIMIT 1
      ), ${topOfMinds.id}) ELSE ${topOfMinds.id} END`,
    })
    .from(topOfMindEntrySignals)
    .innerJoin(signals, eq(signals.id, topOfMindEntrySignals.signalId))
    .innerJoin(topOfMindEntries, eq(topOfMindEntries.id, topOfMindEntrySignals.entryId))
    .innerJoin(topOfMinds, eq(topOfMinds.id, topOfMindEntries.topOfMindId))
    .where(
      and(
        eq(topOfMinds.profileId, profileId),
        inArray(topOfMindEntrySignals.signalId, signalIds),
        citationStatementCurrent('top_of_mind_entry_signals'),
        personalEntrySupportCurrent(profileId, countDismissed),
      ),
    );
  for (const row of tomRows) {
    if (row.signalId === null) continue;
    const bucket = out.get(row.signalId);
    if (bucket && !bucket.tomVersionIds.includes(row.topOfMindId)) {
      bucket.tomVersionIds.push(row.topOfMindId);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The nightly run
// ---------------------------------------------------------------------------

export interface RefreshPrinciplesResult {
  status: "below_bar" | "no_candidates" | "evaluated" | "superseded";
  minted: number;
  attached: number;
  conflicts: number;
  redeemed: number;
  dropped: number;
}

export interface PrincipleGenerationDependencies {
  db?: WakaDb;
  modelProvider?: ModelProvider;
  now?: Date;
  /** No network calls: verify the worker still owns its claim at commit. */
  beforeCommit?: (tx: Pick<WakaTx, "select">) => Promise<void>;
  beforeProgress?: (tx:WakaTx)=>Promise<void>;
  jobId?:string;
  billingProfileId?:string;
  expectedMaterialKey?:string;
}

/** The profile's own readable active signals and their citation evidence. */
export async function loadPrincipleMaterial(db: WakaDb | WakaTx, profileId: string) {
  const [profile] = await db.select({ preferredLocale: profiles.preferredLocale, type: profiles.type }).from(profiles)
    .where(eq(profiles.id, profileId)).limit(1);
  /* A room's mind: its principles retired with the room engine. Decided on
     this same profile read, before any signal or evidence is loaded. */
  const groupProfile = profile?.type === "group";
  if (groupProfile) {
    const evidence = new Map<string, CitationEvidence>();
    return { activeSignals: [] as Array<{ id: string; statement: string; lastEvidenceAt: Date | null; updatedAt: Date }>,
      evidence, groupProfile, preferredLocale: profile?.preferredLocale ?? "en-US",
      eligibility: computeCitationEligibility([], new Date()) };
  }
  const rows = await db.select({ id: signals.id, statement: signals.statement,
    lastEvidenceAt: signals.lastEvidenceAt, updatedAt: signals.updatedAt })
    .from(signals).where(and(eq(signals.profileId, profileId), eq(signals.status, "active"),
      personalSignalReadable(profileId)));
  const activeSignals = rows;
  const evidence = await loadCitationEvidence(db, profileId, activeSignals.map((row) => row.id));
  return { activeSignals, evidence, groupProfile,
    preferredLocale: profile?.preferredLocale ?? "en-US",
    eligibility: computeCitationEligibility([...evidence.values()], new Date()) };
}

export async function refreshPrinciplesForProfile(
  input: { profileId: string },
  deps: PrincipleGenerationDependencies = {},
): Promise<RefreshPrinciplesResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const none: RefreshPrinciplesResult = {
    status: "below_bar",
    minted: 0,
    attached: 0,
    conflicts: 0,
    redeemed: 0,
    dropped: 0,
  };
  if(deps.jobId){
    const [done]=await db.select({response:principleGenerationSteps.response}).from(principleGenerationSteps)
      .where(and(eq(principleGenerationSteps.profileId,input.profileId),eq(principleGenerationSteps.jobId,deps.jobId),eq(principleGenerationSteps.kind,'publication'),eq(principleGenerationSteps.status,'ready'))).limit(1);
    if(done?.response)return done.response as RefreshPrinciplesResult;
  }
  const revision = await readGenerationRevision(db, { profileId: input.profileId });
  if (!revision) return none;

  // The cheap gate: active signals with their longevity stats. Nearly every
  // night ends here, with zero model calls.
  const material=await loadPrincipleMaterial(db,input.profileId);
  const { activeSignals, evidence } = material;
  if(deps.expectedMaterialKey&&deps.expectedMaterialKey!==principleMaterialKey(material))return {...none,status:'superseded'};
  if (activeSignals.length < bar("SIGNALS")) return none;

  const overall = computeCitationEligibility([...evidence.values()], now);
  if (!overall.eligible) return none;

  const provider = deps.modelProvider ?? (await getDefaultModelProvider());
  const [profileRow] = await db
    .select({ preferredLocale: profiles.preferredLocale })
    .from(profiles)
    .where(eq(profiles.id, input.profileId))
    .limit(1);
  const preferredLocale = normalizeSupportedLocale(profileRow?.preferredLocale);

  const existing = await db
    .select({ ...getTableColumns(principles), supportCurrent: personalPrincipleSupportCurrent(input.profileId, PRINCIPLE_MIN_SIGNALS) })
    .from(principles)
    .where(eq(principles.profileId, input.profileId)).orderBy(asc(principles.rank),asc(principles.id));

  const [liveTom] = await db
    .select({ id: topOfMinds.id })
    .from(topOfMinds)
    .where(and(eq(topOfMinds.profileId, input.profileId), eq(topOfMinds.status, "live")))
    .limit(1);
  const storedEntries = liveTom
    ? await db
        .select()
        .from(topOfMindEntries)
        .where(eq(topOfMindEntries.topOfMindId, liveTom.id))
    : [];
  const currentEntries = (await projectPersonalEntries(db, input.profileId, storedEntries)).entries.filter((entry) => !entry.supportChanged);

  const focus=currentEntries.length?await db.select({id:topOfMindEntrySignals.signalId}).from(topOfMindEntrySignals)
    .where(inArray(topOfMindEntrySignals.entryId,currentEntries.map(row=>row.id))):[];
  const distillInput=selectPrincipleInput({
    profileId: input.profileId,
    preferredLocale,
    signals: activeSignals.map((row) => {
      const stats = evidence.get(row.id);
      const times = (stats?.evidenceAt ?? []).map((d) => d.getTime());
      return {
        id: row.id,
        statement: row.statement,
        evidenceCount: stats?.evidenceAt.length ?? 0,
        firstEvidenceAt: times.length ? new Date(Math.min(...times)) : null,
        lastEvidenceAt: row.lastEvidenceAt,
        tomAppearances: stats?.tomVersionIds.length ?? 0,
      };
    }),
    currentPrinciples: existing.filter((row) => row.supportCurrent || row.lockedAt !== null || row.origin === 'declared').map((row) => ({
      id: row.id,
      statement: row.statement,
      state: row.supportCurrent || row.state === 'contested' ? row.state : 'aspirational',
    })),
    currentEntries: currentEntries.map((row) => ({ body: row.body })),
  },new Set(focus.flatMap(row=>row.id?[row.id]:[])));
  const billingProfileId=deps.billingProfileId??input.profileId;
  const inputHash=createHash('sha256').update(JSON.stringify({profileId:input.profileId,policy:'principle-work-v1',
    provider:provider.name??'injected',models:provider.name==='openrouter'
      ?[process.env.WAKA_MODEL_PRINCIPLES?.trim()||OPENROUTER_GENERATION_MODEL,process.env.WAKA_MODEL_PRINCIPLE_JUDGE?.trim()||OPENROUTER_GENERATION_MODEL]
      :[GEMINI_GENERATION_MODEL],limits:{input:PRINCIPLE_INPUT_LIMITS,comparison:PRINCIPLE_COMPARISON_LIMITS,grounding:PRINCIPLE_GROUNDING_LIMITS},
    prompts:[PRINCIPLE_DISTILL_SYSTEM_INSTRUCTION,PRINCIPLE_RELATION_JUDGE_SYSTEM_INSTRUCTION,PRINCIPLE_GROUNDING_SYSTEM_INSTRUCTION],context:renderPrincipleDistillContext(distillInput),material:principleMaterialKey(material),distillInput,
    standing:existing.map(row=>({id:row.id,statement:row.statement,revision:String(row.statementRevision),rank:row.rank,state:row.state,origin:row.origin,locked:row.lockedAt!==null,supported:row.supportCurrent,conflictsWithId:row.conflictsWithId}))})).digest('hex');
  const work=principleWork({db,profileId:input.profileId,billingProfileId,inputHash,revision,jobId:deps.jobId,beforeProgress:deps.beforeProgress});
  const distilled=await work.run('distill',()=>provider.distillPrinciples(distillInput),value=>({candidates:parseDistilledPrinciples(value).candidates.slice(0,PRINCIPLE_MAX_CANDIDATES_PER_RUN)}));
  const recordPublication=async(tx:WakaTx,result:RefreshPrinciplesResult)=>{
    if(deps.jobId)await tx.insert(principleGenerationSteps).values({profileId:input.profileId,billingProfileId,jobId:deps.jobId,inputHash,stepKey:'publication',kind:'publication',status:'ready',response:result,finishedAt:new Date()});
    await tx.update(principleGenerationSteps).set({response:null}).where(and(eq(principleGenerationSteps.profileId,input.profileId),eq(principleGenerationSteps.kind,'model')));
  };

  const result: RefreshPrinciplesResult = { ...none, status: "no_candidates" };
  const activeIds = new Set(distillInput.signals.map((row) => row.id));

  const candidates = distilled.candidates.slice(0, PRINCIPLE_MAX_CANDIDATES_PER_RUN);
  let valid: PrincipleCandidate[] = [];
  for (const candidate of candidates) {
    const statement = candidate.statement.trim();
    const cited = [...new Set(candidate.citedSignalIds)].filter((id) => activeIds.has(id));
    const distinctStatements = new Set(cited.map(id=>distillInput.signals.find(row=>row.id===id)!.statement.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase()));
    const verdict = computeCitationEligibility(
      cited.map((id) => evidence.get(id)!).filter(Boolean),
      now,
    );
    if (
      statement.length === 0 ||
      statement.length > PRINCIPLE_MAX_STATEMENT_LENGTH ||
      distinctStatements.size < bar("SIGNALS") ||
      !verdict.eligible
    ) {
      result.dropped += 1;
      continue;
    }
    valid.push({ ...candidate, statement, citedSignalIds: cited });
  }
  if(valid.length){
    const citedIds=new Set(valid.flatMap(row=>row.citedSignalIds));
    const groundingInput={preferredLocale,signals:distillInput.signals.filter(row=>citedIds.has(row.id)).map(row=>({id:row.id,statement:row.statement})),
      candidates:valid.map((row,index)=>({id:`candidate-${index}`,statement:row.statement,citedSignalIds:row.citedSignalIds}))};
    const grounding=await work.run('grounding',()=>provider.assessPrincipleGrounding(groundingInput),value=>parsePrincipleGrounding(value,groundingInput));
    valid=valid.filter((_,index)=>{const supported=grounding.assessments[index]!.supported;if(!supported)result.dropped++;return supported;});
  }
  if (valid.length === 0) {
    await db.transaction(async (tx) => {
      await assertGenerationRevision(tx, revision);
      await deps.beforeCommit?.(tx);
      await recordPublication(tx,result);
    });
    return result;
  }

  result.status = "evaluated";

  // Plan the complete batch before writing. Provisional IDs let a later
  // candidate compare against an earlier mint without persisting it first.
  const standingSet = existing.filter((row) => row.supportCurrent || row.lockedAt !== null || row.origin === 'declared')
    .map((row) => ({ id: row.id, statement: row.statement }));
  const planned: Array<{ candidate: PrincipleCandidate; matchedId: string | null; conflictingId: string | null; mintedId: string }> = [];
  for (const [candidateIndex,candidate] of valid.entries()) {
    // Compare against the standing set, including earlier planned candidates.
    // An unavailable comparison aborts the entire batch before any write.
    let matchedId: string | null = existing.find((row) => row.statement === candidate.statement)?.id ?? null;
    let conflictingId: string | null = null;
    for (let offset=0;offset<standingSet.length;offset+=PRINCIPLE_COMPARISON_LIMITS.items) {
      if (matchedId) break;
      /* An unreachable judge used to mean "independent for this pair" —
         which minted near-duplicate principles on layer 4, the ranked,
         visible surface, whenever the road was down. It propagates now:
         the nightly job attempt fails and retries, and the candidate is
         judged against the whole standing set or not at all. */
      const comparisonInput={
        preferredLocale,
        candidateStatement: candidate.statement,
        existingPrinciples: standingSet.slice(offset,offset+PRINCIPLE_COMPARISON_LIMITS.items),
      };
      const {relations}=await work.run(`relation:${candidateIndex}:${offset}`,()=>provider.judgePrincipleRelation(comparisonInput),value=>parsePrincipleRelation(value,comparisonInput));
      for(const {principleId,relation} of relations){
        if (relation === "same") { matchedId = principleId; break; }
        if (relation === "conflicting" && !conflictingId) conflictingId = principleId;
      }
    }
    const hex=createHash('sha256').update(`${inputHash}:${candidateIndex}`).digest('hex');
    const mintedId=`${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
    planned.push({ candidate, matchedId, conflictingId, mintedId });
    if (!matchedId) standingSet.push({ id: mintedId, statement: candidate.statement });
  }

  return db.transaction(async (tx) => {
    await assertGenerationRevision(tx, revision);
    await deps.beforeCommit?.(tx);
    try {
      // A human update may already own a row while its revision trigger waits
      // on our fence. Never wait back on that row: release and retry instead
      // of creating a deadlock that could abort the person's edit.
      await tx.select({ id: principles.id }).from(principles)
        .where(eq(principles.profileId, input.profileId)).for("no key update", { noWait: true });
    } catch (error) {
      const code = (error as { code?: string; cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code;
      if (code === "55P03") throw new Error("Generation inputs changed; retry current inputs");
      throw error;
    }
    for (const { candidate, matchedId, conflictingId, mintedId } of planned) {
      if (matchedId) {
        const attached = await attachCitations(tx, input.profileId, matchedId, candidate.citedSignalIds);
        result.attached += attached;
        const matched = existing.find((row) => row.id === matchedId);
        if (matched && (matched.state === "aspirational" || matched.unsupportedAt !== null)) {
          const promoted = await promoteIfDemonstrated(tx, input.profileId, matchedId, now);
          if (promoted) result.redeemed += 1;
        }
        continue;
      }

      const ranks = await tx
        .select({ rank: principles.rank })
        .from(principles)
        .where(eq(principles.profileId, input.profileId));
      const [row] = await tx
        .insert(principles)
        .values({
          id: mintedId,
          profileId: input.profileId,
          statement: candidate.statement,
          inputPolicy: null,
          type: candidate.type,
          state: "held",
          origin: "minted",
          rank: nextRank(ranks),
          heldSince: now,
        })
        .returning();
      const revisions = await loadSignalStatementRevisions(tx, candidate.citedSignalIds);
      await tx.insert(principleSignals).values(
        candidate.citedSignalIds.map((signalId) => ({
          profileId: input.profileId,
          principleId: row!.id,
          signalId,
          statementRevision: revisions.get(signalId),
          principleStatementRevision: row!.statementRevision,
        })),
      );
      // The chain begins at birth — the machine's sentence every later
      // revert returns to (no-quiet-corners Phase 2).
      await writePrincipleStatementChain(tx, {
        profileId: input.profileId,
        principleId: row!.id,
        statement: candidate.statement,
        reason: "minted",
        now,
      });
      result.minted += 1;

      if (conflictingId) {
        await tx
          .update(principles)
          .set({ state: "contested", conflictsWithId: conflictingId, updatedAt: now })
          .where(eq(principles.id, mintedId));
        await tx
          .update(principles)
          .set({ state: "contested", conflictsWithId: mintedId, updatedAt: now })
          .where(eq(principles.id, conflictingId));
        result.conflicts += 1;
      }
    }

    await recordPublication(tx,result);
    return result;
  });
}

async function attachCitations(
  db: WakaDb | WakaTx,
  profileId: string,
  principleId: string,
  signalIds: string[],
): Promise<number> {
  if (signalIds.length === 0) return 0;
  const revisions = await loadSignalStatementRevisions(db, signalIds);
  const [parent] = await db.select({ revision: principles.statementRevision }).from(principles)
    .where(and(eq(principles.profileId, profileId), eq(principles.id, principleId))).limit(1);
  if (!parent) throw new Error('Principle citation parent is unavailable');
  for (const signalId of signalIds) {
    await db.update(principleSignals).set({ statementRevision: revisions.get(signalId), principleStatementRevision: parent.revision })
      .where(and(eq(principleSignals.profileId, profileId), eq(principleSignals.principleId, principleId), eq(principleSignals.signalId, signalId)));
  }
  // A fresh matching candidate supplies current grounding. Retain other
  // current citations; stale ones no longer explain this renewed statement.
  await db.delete(principleSignals).where(and(eq(principleSignals.profileId, profileId), eq(principleSignals.principleId, principleId), sql`
    (coalesce(${principleSignals.principleStatementRevision}, 1) <> ${parent.revision} OR
    NOT EXISTS (SELECT 1 FROM signals WHERE signals.id = ${principleSignals.signalId}
      AND ${citationStatementCurrent('principle_signals')}
      AND ${personalSignalReadable(profileId)}))`));
  const inserted = await db
    .insert(principleSignals)
    .values(signalIds.map((signalId) => ({ profileId, principleId, signalId, statementRevision: revisions.get(signalId), principleStatementRevision: parent.revision })))
    .onConflictDoNothing()
    .returning({ id: principleSignals.id });
  return inserted.length;
}

/**
 * The redemption path: an aspirational declaration whose citations now meet
 * the bar becomes held — the declaration was a promise; the evidence redeems
 * it. Never touches the statement (declarations are locked from birth).
 */
export async function promoteIfDemonstrated(
  db: WakaDb | WakaTx,
  profileId: string,
  principleId: string,
  now: Date,
): Promise<boolean> {
  const cited = await db
    .select({ signalId: principleSignals.signalId })
    .from(principleSignals)
    .innerJoin(signals, eq(signals.id, principleSignals.signalId))
    .where(and(eq(principleSignals.principleId, principleId), eq(signals.status, "active"),
      citationStatementCurrent('principle_signals'), personalSignalReadable(profileId)));
  const evidence = await loadCitationEvidence(
    db,
    profileId,
    cited.map((row) => row.signalId),
  );
  const verdict = computeCitationEligibility([...evidence.values()], now);
  const [current] = await db
    .select({ state: principles.state, unsupportedAt: principles.unsupportedAt })
    .from(principles)
    .where(eq(principles.id, principleId))
    .limit(1);
  if (!current || !verdict.eligible ||
    (!promoteDecision(current.state, true) && current.unsupportedAt === null)) return false;

  const updated = await db
    .update(principles)
    .set({
      state: sql`case when ${principles.state} = 'contested' then 'contested'::principle_state else 'held'::principle_state end`,
      unsupportedAt: null, heldSince: now, updatedAt: now,
    })
    .where(and(eq(principles.id, principleId), eq(principles.profileId, profileId),
      or(eq(principles.state, "aspirational"), isNotNull(principles.unsupportedAt))))
    .returning({ id: principles.id });
  return updated.length > 0;
}

/**
 * Immediate state maintenance after signals are lost or retired — never
 * waits for midnight, involves no model. A held principle whose citations
 * fall below the bar: declared → back to aspirational (the owner's words
 * stand, undemonstrated again); minted → removed (a machine claim without
 * support has no words worth keeping). Conflict links pointing at a removed
 * row are cleared rather than left dangling.
 *
 * A DISMISSED CITATION STILL COUNTS HERE. Dismissal is undoable and this
 * pass deletes, so it must not turn an undo into a loss: a dismissed signal
 * (and the readings citing it) count as support, exactly as before the
 * dismissal; anything else that falls below the bar is handled as always.
 * Reads already withhold support resting on a dismissed signal
 * (`personalPrincipleSupportCurrent`), so a restore needs no reconcile.
 */
export async function reconcilePrinciplesAfterSignalLoss(
  db: WakaDb | WakaTx,
  /* `principleIds` names principles whose citation rows are already gone —
     a deleted signal cascades its `principle_signals` links away, so they
     can no longer be found from the signal id. */
  input: { profileId: string; signalIds: string[]; principleIds?: string[]; now?: Date },
): Promise<{ demoted: string[]; removed: string[] }> {
  const now = input.now ?? new Date();
  const demoted: string[] = [];
  const removed: string[] = [];
  if (input.signalIds.length === 0 && !input.principleIds?.length) return { demoted, removed };

  const citing = input.signalIds.length === 0 ? [] : await db
    .selectDistinct({ principleId: principleSignals.principleId })
    .from(principleSignals)
    .where(
      and(
        eq(principleSignals.profileId, input.profileId),
        inArray(principleSignals.signalId, input.signalIds),
      ),
    );
  const affected = [...new Set([...citing.map((row) => row.principleId), ...(input.principleIds ?? [])])]
    .map((principleId) => ({ principleId }));

  for (const { principleId } of affected) {
    await db.transaction(async (tx) => {
      // Read standing under the row lock: a committed human edit must be
      // observed before deciding whether automatic deletion is allowed.
      const [row] = await tx
        .select()
        .from(principles)
        .where(and(eq(principles.id, principleId), eq(principles.profileId, input.profileId)))
        .for("update")
        .limit(1);
      if (!row) return;

      const cited = await tx
        .select({ signalId: principleSignals.signalId })
        .from(principleSignals)
        .innerJoin(signals, eq(signals.id, principleSignals.signalId))
        .where(and(eq(principleSignals.principleId, principleId),
          or(eq(signals.status, "active"), isNotNull(signals.dismissedAt))));
      const evidence = await loadCitationEvidence(tx, input.profileId, cited.map((c) => c.signalId), true);
      const action = reconcileAction(row, computeCitationEligibility([...evidence.values()], now).eligible);
      if (action === "keep") return;

      if (action === "demote") {
        await tx.update(principles).set({
          state: row.state === "contested" ? "contested" : "aspirational",
          heldSince: null,
          unsupportedAt: row.unsupportedAt ?? now,
          updatedAt: now,
        }).where(eq(principles.id, principleId));
        demoted.push(principleId);
      } else {
        await tx.update(principles).set({ conflictsWithId: null })
          .where(eq(principles.conflictsWithId, principleId));
        await tx.delete(principles).where(eq(principles.id, principleId));
        removed.push(principleId);
      }
    });
  }
  return { demoted, removed };
}
