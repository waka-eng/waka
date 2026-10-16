/** WHAT THIS MOCKS, AND WHY (gate G6): nothing — the readers run on a
 * disposable Postgres, because the claim is about which rows a chat may read
 * and how they are labelled. No model or network is involved. */
import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,expect,it} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {conversationMemory,memoryProfiles,readPerspectiveContext} from './conversation-context.js';
let t:TestDatabase;
beforeAll(async()=>{t=await createTestDatabase();});beforeEach(async()=>{await t.truncateAll();});afterAll(async()=>{await t?.cleanup();});
async function people(){
  const [account]=await t.sql`INSERT INTO accounts(email) VALUES(${randomUUID()+'@example.test'}) RETURNING id`;
  const [person]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${account.id},'human','Person') RETURNING id`;
  const [agent]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${account.id},'agent','Agent') RETURNING id`;
  await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${person.id},'Small first moves make starting easy')`;
  await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${agent.id},'Small first moves shipped faster in this repo')`;
  return {person:person.id as string,agent:agent.id as string};
}
it('reads both memories for a both chat, each source labelled with whose it is',async()=>{
  const p=await people();
  const memory=await conversationMemory(t.db as never,p.person,{perspective:'both',agentProfileId:p.agent});
  expect(memoryProfiles(memory)).toEqual([p.person,p.agent]);
  const context=await readPerspectiveContext(t.db as never,memory,'small first moves');
  expect(context.inspirations.map(row=>[row.owner,row.text])).toEqual([
    ['person','Small first moves make starting easy'],
    ['agent','Small first moves shipped faster in this repo'],
  ]);
});
it('reads only the agent for an agent chat, and falls back to the person when the agent is not theirs',async()=>{
  const p=await people(),stranger=await people();
  const agentOnly=await readPerspectiveContext(t.db as never,await conversationMemory(t.db as never,p.person,{perspective:'agent',agentProfileId:p.agent}),'small first moves');
  expect(agentOnly.inspirations.map(row=>row.owner)).toEqual(['agent']);
  const foreign=await conversationMemory(t.db as never,p.person,{perspective:'agent',agentProfileId:stranger.agent});
  expect(foreign).toEqual({perspective:'mine',personId:p.person,agentId:null});
});
it('re-proves a both chat\'s citations with their owners, and an agent chat\'s context names the person',async()=>{
  const {currentConversationReferences}=await import('./conversation-context.js');
  const p=await people();
  const both=await conversationMemory(t.db as never,p.person,{perspective:'both',agentProfileId:p.agent});
  const read=await readPerspectiveContext(t.db as never,both,'small first moves');
  const again=await currentConversationReferences(t.db as never,both,read.inspirations.map(({kind,id,hash})=>({kind,id,hash})));
  expect(again.map(row=>row?.owner)).toEqual(['person','agent']);
  const agentOnly=await readPerspectiveContext(t.db as never,await conversationMemory(t.db as never,p.person,{perspective:'agent',agentProfileId:p.agent}),'small first moves');
  expect(agentOnly.profileId).toBe(p.person);
});
