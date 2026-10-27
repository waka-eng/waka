import { approveReadingReview } from '../../test/helpers/top-of-mind-review.js';
/**
 * CONTESTED SPEAKS — a dispute the owner has not arbitrated reaches the
 * synthesis as a dispute, never as two independent certainties.
 *
 * The claims:
 *   (i)   both sides of an open pair reach the synthesis input marked with
 *         each other's id — and only ids in the same delivered list;
 *   (ii)  a RESOLVED pair carries no mark — arbitration ends the tension;
 *   (iii) a partner that is not standing (retired) cannot speak: the pair
 *         stays dormant and the surviving side carries no mark;
 *   (iv)  the pull itself, pure: a chosen side brings its standing partner
 *         into the list; nothing is chased transitively.
 *
 * WHAT THIS MOCKS, AND WHY: the model provider — a scripted synthesis that
 * captures its input, because the subject is what the machinery DELIVERS to
 * the call, not the call. Signals, pairs, and the queue are real rows.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { setDefaultModelProviderForTests } from "./model-provider.js";
import type { ModelProvider, TopOfMindSynthesisInput } from "./model-provider.js";
import { keepContestedTogether, refreshTopOfMindForProfile } from "./top-of-mind-synthesis.js";

let t: TestDatabase;
let seq = 0;

async function seedProfile(): Promise<string> {
  seq += 1;
  const [account] = await t.sql`
    INSERT INTO accounts (email) VALUES (${`contested-${seq}@example.test`}) RETURNING id`;
  const [p] = await t.sql`
    INSERT INTO profiles (account_id, type, name)
    VALUES (${account.id}, 'human', 'Owner') RETURNING id`;
  return p.id as string;
}

async function seedSignal(profileId: string, statement: string): Promise<string> {
  const [insp] = await t.sql`
    INSERT INTO inspirations (profile_id, text)
    VALUES (${profileId}, ${`witness of: ${statement}`}) RETURNING id`;
  const [sig] = await t.sql`
    INSERT INTO signals (profile_id, statement, status, confidence)
    VALUES (${profileId}, ${statement}, 'emerging', 0) RETURNING id`;
  await t.sql`
    INSERT INTO signal_evidence (profile_id, owner_profile_id, signal_id, inspiration_id)
    VALUES (${profileId}, ${profileId}, ${sig.id}, ${insp.id})`;
  // Even a lone standing side needs two original captures to enter synthesis.
  const [other] = await t.sql`INSERT INTO inspirations(profile_id,text)
    VALUES (${profileId}, ${`A later independent observation: ${statement}`}) RETURNING id`;
  await t.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id)
    VALUES (${profileId},${profileId},${sig.id},${other.id})`;
  return sig.id as string;
}

/** A synthesis that answers minimally and remembers what it was handed. */
function rememberingProvider(seen: TopOfMindSynthesisInput[]): ModelProvider {
  const refuse = () => {
    throw new Error("not this suite's task");
  };
  return {
    name: "remembering",
    reviewTopOfMind: approveReadingReview, async synthesizeTopOfMind(input: TopOfMindSynthesisInput) {
      seen.push(input);
      return {
        noChange: false,
        entries: [
          {
            type: "tension",
            body: "two things pull here",
            belief: null,
            prompt: null,
            citedSignalIds: [input.signals[0]!.id],
          },
        ],
      };
    },
    extractSignalCandidates: refuse,
    judgeSignalMatch: refuse,
    distillPrinciples: refuse,
    judgePrincipleRelation: refuse,
    routeDeclaration: refuse,
  } as unknown as ModelProvider;
}

beforeAll(async () => {
  t = await createTestDatabase();
  const url = new URL(process.env.DB_CONNECTION_URL!);
  url.searchParams.set("options", `-c search_path=${t.schemaName}`);
  process.env.DB_CONNECTION_URL = url.toString();
});

afterAll(async () => {
  setDefaultModelProviderForTests(null);
  await t?.cleanup();
});

describe("contested pairs reach the synthesis", () => {
  it('checks a noChange carry against current disputes even when neither side is selected',async()=>{
    const profileId=await seedProfile(),a=await seedSignal(profileId,'Evenings for family.'),b=await seedSignal(profileId,'Evenings for work.');
    for(let index=0;index<3;index++){
      const id=await seedSignal(profileId,`A current established pattern ${index}.`);
      for(let unit=0;unit<2;unit++){
        const [source]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${profileId},'Another independent experience') RETURNING id`;
        await t.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id) VALUES(${profileId},${profileId},${id},${source.id})`;
      }
      await t.sql`UPDATE signals SET status='active' WHERE id=${id}`;
    }
    await t.sql`INSERT INTO signal_contradictions(profile_id,a_signal_id,b_signal_id) VALUES(${profileId},${a<b?a:b},${a<b?b:a})`;
    const [tom]=await t.sql`INSERT INTO top_of_minds(profile_id) VALUES(${profileId}) RETURNING id`;
    const [entry]=await t.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body) VALUES(${tom.id},'pattern','Family always wins.') RETURNING id`;
    await t.sql`INSERT INTO top_of_mind_entry_signals(entry_id,signal_id) VALUES(${entry.id},${a})`;
    let seen:TopOfMindSynthesisInput|null=null;
    setDefaultModelProviderForTests({...rememberingProvider([]),reviewTopOfMind: approveReadingReview, synthesizeTopOfMind:async input=>{seen=input;return {noChange:true,entries:[]};}});
    await refreshTopOfMindForProfile({profileId,reason:'manual'});
    expect((seen as TopOfMindSynthesisInput|null)?.signals.map(row=>row.id)).not.toContain(a);
    const rows=await t.sql`SELECT e.body FROM top_of_mind_entries e JOIN top_of_minds m ON m.id=e.top_of_mind_id WHERE m.profile_id=${profileId} AND m.status='live'`;
    expect(rows).toHaveLength(0);
  });
  it('drops unilateral generated conclusions, including a noChange carry, without rewriting a human pin',async()=>{
    const profileId=await seedProfile(),a=await seedSignal(profileId,'Evenings for family.'),b=await seedSignal(profileId,'Evenings for work.');
    await t.sql`INSERT INTO signal_contradictions(profile_id,a_signal_id,b_signal_id) VALUES(${profileId},${a<b?a:b},${a<b?b:a})`;
    const [tom]=await t.sql`INSERT INTO top_of_minds(profile_id) VALUES(${profileId}) RETURNING id`;
    const [machine]=await t.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body) VALUES(${tom.id},'pattern','Family always wins.') RETURNING id`;
    const [human]=await t.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body,locked_at,pinned_at) VALUES(${tom.id},'pattern','My exact choice.',now(),now()) RETURNING id`;
    for(const entry of [machine,human])await t.sql`INSERT INTO top_of_mind_entry_signals(entry_id,signal_id) VALUES(${entry.id},${a})`;
    const seen:TopOfMindSynthesisInput[]=[];
    setDefaultModelProviderForTests({...rememberingProvider(seen),reviewTopOfMind: approveReadingReview, synthesizeTopOfMind:async()=>({noChange:true,entries:[]})});
    await refreshTopOfMindForProfile({profileId,reason:'manual'});
    const rows=await t.sql`SELECT e.body,e.locked_at FROM top_of_mind_entries e JOIN top_of_minds m ON m.id=e.top_of_mind_id WHERE m.profile_id=${profileId} AND m.status='live'`;
    expect(rows.map(row=>row.body)).toEqual(['My exact choice.']);
    expect(rows[0]!.locked_at).not.toBeNull();
  });

  it("marks both sides of an open pair with each other, and only each other", async () => {
    const profileId = await seedProfile();
    const a = await seedSignal(profileId, "Mornings are for deep work.");
    const b = await seedSignal(profileId, "Mornings are for exercise, not the desk.");
    const c = await seedSignal(profileId, "Walking untangles stuck problems.");
    await t.sql`
      INSERT INTO signal_contradictions (profile_id, a_signal_id, b_signal_id)
      VALUES (${profileId}, ${a < b ? a : b}, ${a < b ? b : a})`;

    const seen: TopOfMindSynthesisInput[] = [];
    setDefaultModelProviderForTests(rememberingProvider(seen));
    await refreshTopOfMindForProfile({ profileId, reason: "manual" });

    expect(seen).toHaveLength(1);
    const byId = new Map(seen[0]!.signals.map((s) => [s.id, s]));
    expect(byId.get(a)?.contestedWithIds).toEqual([b]);
    expect(byId.get(b)?.contestedWithIds).toEqual([a]);
    expect(byId.get(c)?.contestedWithIds).toBeUndefined();
  });

  it("carries no mark once the owner has arbitrated", async () => {
    const profileId = await seedProfile();
    const a = await seedSignal(profileId, "Ship small and often.");
    const b = await seedSignal(profileId, "Hold work back until it is whole.");
    await t.sql`
      INSERT INTO signal_contradictions
        (profile_id, a_signal_id, b_signal_id, resolved_at, resolved_by, yielded_signal_id)
      VALUES (${profileId}, ${a < b ? a : b}, ${a < b ? b : a}, now(), 'verdict', ${b})`;

    const seen: TopOfMindSynthesisInput[] = [];
    setDefaultModelProviderForTests(rememberingProvider(seen));
    await refreshTopOfMindForProfile({ profileId, reason: "manual" });

    for (const signal of seen[0]!.signals) {
      expect(signal.contestedWithIds, signal.statement).toBeUndefined();
    }
  });

  it("leaves the pair dormant when the other side no longer stands", async () => {
    const profileId = await seedProfile();
    const a = await seedSignal(profileId, "Notebooks beat apps.");
    const b = await seedSignal(profileId, "The app is where thoughts survive.");
    await t.sql`
      INSERT INTO signal_contradictions (profile_id, a_signal_id, b_signal_id)
      VALUES (${profileId}, ${a < b ? a : b}, ${a < b ? b : a})`;
    await t.sql`UPDATE signals SET status = 'retired' WHERE id = ${b}`;

    const seen: TopOfMindSynthesisInput[] = [];
    setDefaultModelProviderForTests(rememberingProvider(seen));
    await refreshTopOfMindForProfile({ profileId, reason: "manual" });

    const ids = seen[0]!.signals.map((s) => s.id);
    expect(ids).toContain(a);
    expect(ids).not.toContain(b);
    for (const signal of seen[0]!.signals) {
      expect(signal.contestedWithIds, signal.statement).toBeUndefined();
    }
  });
});

describe("keepContestedTogether, pure", () => {
  const sig = (id: string) => ({ id });

  it("pulls a standing partner in behind the chosen side", () => {
    const out = keepContestedTogether(
      [sig("a"), sig("c")],
      new Map([
        ["a", sig("a")],
        ["b", sig("b")],
        ["c", sig("c")],
      ]),
      new Map([
        ["a", ["b"]],
        ["b", ["a"]],
      ]),
    );
    expect(out.map((s) => s.id)).toEqual(["a", "c", "b"]);
  });

  it("pulls nothing when the partner is not standing, or already present", () => {
    const standing = new Map([["a", sig("a")]]);
    const opposing = new Map([["a", ["gone"]]]);
    expect(keepContestedTogether([sig("a")], standing, opposing).map((s) => s.id)).toEqual(["a"]);
    const both = keepContestedTogether(
      [sig("a"), sig("b")],
      new Map([
        ["a", sig("a")],
        ["b", sig("b")],
      ]),
      new Map([
        ["a", ["b"]],
        ["b", ["a"]],
      ]),
    );
    expect(both.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("does not chase a pulled partner's own other pairs", () => {
    const out = keepContestedTogether(
      [sig("a")],
      new Map([
        ["a", sig("a")],
        ["b", sig("b")],
        ["c", sig("c")],
      ]),
      new Map([
        ["a", ["b"]],
        ["b", ["a", "c"]],
        ["c", ["b"]],
      ]),
    );
    expect(out.map((s) => s.id)).toEqual(["a", "b"]);
  });
});
