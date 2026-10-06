import {and,asc,desc,eq,inArray,isNull,ne,sql} from 'drizzle-orm';
import {topOfMindEntries,topOfMinds} from '../db/index.js';
import type {getDb} from './db.js';
import {personalEntryReadable,personalEntrySupportCurrent} from './personal-output.js';

type Reader=Pick<ReturnType<typeof getDb>,'select'>;
export const CONVERSATION_READING_LIMITS={live:5,comparisonLive:3,priorArtifacts:3,historicalVersions:2,entryScan:14} as const;
export function asksAboutThinkingChange(question:string):boolean {
  return /(?:what|how).{0,55}(?:changed|evolved)|(?:changed|evolved).{0,45}(?:think|thinking|mind|belief)|(?:earlier|previous|past|before).{0,35}(?:reading|thinking|belief)|compare.{0,45}(?:reading|then|before|past)|(?:생각|관점|원칙).{0,25}(?:달라|변화|바뀌)|(?:예전|이전|과거).{0,25}(?:생각|읽기|원칙)/iu.test(question);
}

/** Earlier records obey the same private serving policy as the history UI.
 * They are dated readings, not proof of an earlier belief or its change date. */
export async function readConversationReadings(db:Reader,profileId:string,question:string,ids?:string[]){
  const fields={id:topOfMindEntries.id,text:topOfMindEntries.body,
    revision:sql<string>`${topOfMindEntries.bodyRevision}::text`,
    locked:sql<boolean>`${topOfMindEntries.lockedAt} IS NOT NULL`,
    supportCurrent:sql<boolean>`${personalEntrySupportCurrent(profileId)}`,
    recordedAt:topOfMinds.createdAt,artifactVersion:topOfMinds.version,
    historical:sql<boolean>`${topOfMinds.status} <> 'live'`};
  const visible=and(eq(topOfMinds.profileId,profileId),isNull(topOfMindEntries.dismissedAt),personalEntryReadable(profileId));
  const selection=()=>db.select(fields).from(topOfMindEntries).innerJoin(topOfMinds,eq(topOfMinds.id,topOfMindEntries.topOfMindId));
  const map=(rows:Array<{id:string;text:string;revision:string;locked:boolean;supportCurrent:boolean;recordedAt:Date;artifactVersion:number;historical:boolean}>)=>rows.map(row=>({...row,recordedAt:row.recordedAt.toISOString()}));
  if(ids)return map(await selection().where(and(visible,inArray(topOfMindEntries.id,ids))).orderBy(asc(topOfMindEntries.sortOrder),asc(topOfMindEntries.id)).limit(6));
  const comparing=asksAboutThinkingChange(question);
  const live=await selection().where(and(visible,eq(topOfMinds.status,'live'))).orderBy(asc(topOfMindEntries.sortOrder),asc(topOfMindEntries.id)).limit(comparing?CONVERSATION_READING_LIMITS.comparisonLive:CONVERSATION_READING_LIMITS.live);
  if(!comparing)return map(live);
  const prior=db.select({id:topOfMinds.id}).from(topOfMinds)
    .where(and(eq(topOfMinds.profileId,profileId),eq(topOfMinds.status,'superseded'),ne(topOfMinds.reason,'no_change')))
    .orderBy(desc(topOfMinds.version)).limit(CONVERSATION_READING_LIMITS.priorArtifacts).as('conversation_prior_readings');
  const rows=await selection().innerJoin(prior,eq(prior.id,topOfMinds.id)).where(and(visible,
    sql`NOT EXISTS(SELECT 1 FROM top_of_mind_entries current_entry JOIN top_of_minds current_reading ON current_reading.id=current_entry.top_of_mind_id
      WHERE current_reading.profile_id=${profileId}::uuid AND current_reading.status='live'
        AND current_entry.dismissed_at IS NULL AND current_entry.body=${topOfMindEntries.body})`))
    .orderBy(desc(topOfMinds.version),asc(topOfMindEntries.sortOrder),asc(topOfMindEntries.id)).limit(CONVERSATION_READING_LIMITS.entryScan);
  const versions=new Set<number>();
  const earlier=rows.filter(row=>{if(versions.has(row.artifactVersion)||versions.size>=CONVERSATION_READING_LIMITS.historicalVersions)return false;versions.add(row.artifactVersion);return true;});
  return map([...live,...earlier]);
}
