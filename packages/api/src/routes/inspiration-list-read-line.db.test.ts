/** A picture save's row leads with its first read line (founder, 2026-11-27,
 * approving "Inspirations, led by pictures" on the picture-saves board).
 *
 * The archive list carries no enrichment, so a screenshot's row had nothing
 * to say but "#8 Oct 27". It now carries `readLine` on an image summary: the
 * first line of the words the page quotes under the picture (the owner's fix
 * first), and NOTHING for a picture with no readable words: no scene
 * description, which was not approved as text. Real Postgres; only the auth
 * principal is a fixture. */
import {Hono} from 'hono';
import {randomUUID} from 'node:crypto';
import {afterAll,beforeEach,expect,it} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {createInspirationsRoutes} from './inspirations.js';
import {imageReadLine} from './inspirations-serialization.js';
import type {AuthEnv} from '../lib/middleware.js';
let t:TestDatabase,sequence=0;
beforeEach(async()=>{t??=await createTestDatabase();await t.truncateAll();});
afterAll(async()=>{await t?.cleanup();});
async function fixture(){
  const [account]=await t.sql`INSERT INTO accounts(email) VALUES (${`read-line-${++sequence}@example.test`}) RETURNING id`;
  const [profile]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${account.id},'human','Reader') RETURNING id`;
  const app=new Hono<AuthEnv>();app.route('/api/inspirations',createInspirationsRoutes({getDatabase:()=>t.db as never,
    authMiddleware:async(c,next)=>{c.set('session',{sessionId:randomUUID(),account:{id:account.id,email:'reader@example.test'},
      profile:{id:profile.id,accountId:account.id,type:'human',name:'Reader',preferredLocale:'en-US'}});await next();}}));
  return {profileId:profile.id as string,app};
}
type List={inspirations:Array<{id:string;attachmentSummary:Array<{id:string;type:string;label:string;readLine?:string}>}>};
async function picture(profileId:string,enrichment:{status:string|null;text:string|null;correction?:string|null}){
  const [row]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${profileId},'') RETURNING id`;
  await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,name,content_type,enrichment_status,enrichment_text,transcript_correction)
    VALUES (${profileId},${row.id},'image','s3://bucket/key.png','IMG_0001.png','image/png',${enrichment.status},${enrichment.text},${enrichment.correction??null})`;
  return row.id as string;
}

it('leads a read picture with the first line of its words, and a wordless one with nothing',async()=>{
  const f=await fixture();
  const read=await picture(f.profileId,{status:'ready',text:'Words: The smaller step\nMost plans fail on the first morning.\nImage: A screenshot of a post.'});
  const fixed=await picture(f.profileId,{status:'ready',text:'Words: The smaler step\nImage: A post.',correction:'You need a smaller next step.\nMake it silly.'});
  const none=await picture(f.profileId,{status:'ready',text:'Words: none\nImage: Rooftops at dusk from a window.'});
  const reading=await picture(f.profileId,{status:'pending',text:null});
  const legacy=await picture(f.profileId,{status:'ready',text:'A photograph of a cat on a sofa.'});
  /* a recording's transcript and fix are never read for a list */
  const [voice]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${f.profileId},'') RETURNING id`;
  await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,name,content_type,enrichment_status,enrichment_text,transcript_correction)
    VALUES (${f.profileId},${voice.id},'audio','s3://bucket/a.m4a','a.m4a','audio/mp4','ready','Words: spoken','What I said')`;
  const list=await (await f.app.request('/api/inspirations')).json() as List;
  const lineOf=(id:string)=>list.inspirations.find(item=>item.id===id)!.attachmentSummary[0]!;
  expect(lineOf(read).readLine).toBe('The smaller step');
  expect(lineOf(fixed).readLine).toBe('You need a smaller next step.');
  for(const id of [none,reading,legacy,voice.id as string]){
    expect(lineOf(id)).not.toHaveProperty('readLine');
    /* The scene is never the row's words. */
    expect(JSON.stringify(lineOf(id))).not.toMatch(/Rooftops|cat on a sofa/);
  }
});

it('clips a long first line and skips blank lines before it',()=>{
  expect(imageReadLine({enrichmentStatus:'ready',wordsSource:`Words: \n\n  ${'a'.repeat(400)}`,correction:null})).toHaveLength(160);
  expect(imageReadLine({enrichmentStatus:'failed',wordsSource:'Words: Stale',correction:null})).toBeNull();
  expect(imageReadLine({enrichmentStatus:'failed',wordsSource:null,correction:'  \nMine'})).toBe('Mine');
});
