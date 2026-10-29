/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. Opt-in live model calls
 * exercise distillation, grounding and persistence over synthetic material
 * in a disposable local database. No user archive is read or regenerated. */
import {afterAll,describe,expect,it} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {refreshPrinciplesForProfile} from './principle-generation.js';
import {loadPrincipleViews} from '../routes/principles.js';
import {readingMatchesLocale} from './top-of-mind-quality.js';

const live=process.env.WAKA_RUN_LIVE_EVALS==='1'&&Boolean(process.env.OPENROUTER_API_KEY||process.env.GEMINI_API_KEY);
let t:TestDatabase|undefined;
afterAll(async()=>{await t?.cleanup();});
const syntheticSignals=[
  {statement:'Across photography equipment and home projects, you test a cheap reversible option before committing more money.',
    originals:['I rented a camera before deciding to buy one.','I tried a removable shelf before drilling into the wall.','I borrowed a lens to test it before spending more.']},
  {statement:'When learning languages and cooking techniques, you keep trials short and wait to see what works before expanding them.',
    originals:['I tried short language lessons before booking a full course.','I tested one small recipe before planning a dinner.','I tried a week of flashcards before buying a subscription.']},
  {statement:'In software work and fitness routines, you start with small experiments and use their results before making a bigger commitment.',
    originals:['I made a small prototype before building the whole feature.','I tried the gym for a week before choosing a membership.','I tested a brief exercise routine before expanding it.']},
];
describe.skipIf(!live)('live personal Principle generation',()=>{
  it.each(['en-US','ko-KR'] as const)('persists a grounded %s decision guide from English patterns',async locale=>{
    t??=await createTestDatabase();
    const [account]=await t.sql`INSERT INTO accounts(email) VALUES(${`live-principle-${locale}@example.test`}) RETURNING id`;
    const [profile]=await t.sql`INSERT INTO profiles(account_id,type,name,preferred_locale) VALUES(${account.id},'agent','Synthetic agent',${locale}) RETURNING id`;
    const ids:string[]=[];
    for(const sourceSignal of syntheticSignals){
      const [signal]=await t.sql`INSERT INTO signals(profile_id,statement) VALUES(${profile.id},${sourceSignal.statement}) RETURNING id`;
      for(const original of sourceSignal.originals){
        const [source]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${profile.id},${original}) RETURNING id`;
        await t.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id) VALUES(${profile.id},${profile.id},${signal.id},${source.id})`;
      }
      await t.sql`UPDATE signals SET status='active' WHERE id=${signal.id}`;
      ids.push(signal.id);
    }
    const [reading]=await t.sql`INSERT INTO top_of_minds(profile_id) VALUES(${profile.id}) RETURNING id`;
    const [entry]=await t.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body) VALUES(${reading.id},'pattern','Small reversible trials are a recurring theme.') RETURNING id`;
    for(const id of ids)await t.sql`INSERT INTO top_of_mind_entry_signals(entry_id,signal_id) VALUES(${entry.id},${id})`;
    const result=await refreshPrinciplesForProfile({profileId:profile.id as string},{db:t.db as never});
    expect(result.minted).toBeGreaterThan(0);
    const views=await loadPrincipleViews(t.db as never,profile.id as string);
    expect(views).toHaveLength(result.minted);
    for(const view of views){
      expect(view).toMatchObject({state:'held',origin:'minted',locked:false,supportChanged:false});
      expect(readingMatchesLocale(view.statement,locale)).toBe(true);
      expect(view.citedSignals.map(row=>row.id).sort()).toEqual([...ids].sort());
      expect(syntheticSignals.map(row=>row.statement)).not.toContain(view.statement);
    }
    console.log('[synthetic-principle]',JSON.stringify({locale,statements:views.map(row=>row.statement)}));
  },90_000);
});
