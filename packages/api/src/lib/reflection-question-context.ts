import { and, desc, eq, isNotNull, asc } from 'drizzle-orm';
import { attachments, inspirations, profiles, reflections } from '../db/index.js';
import { getDb } from './db.js';
import { isSupportedLocale } from './locales.js';
import { effectiveAttachmentKind, effectiveAttachmentStatus, effectiveAttachmentText } from './attachment-material.js';
import { hashEmbeddingInput } from './inspiration-embeddings.js';
import type { ReflectionQuestionInput } from './model-provider.js';

/** Only this source and its answers/attachments, never another profile's memory. */
export async function loadReflectionQuestionContext(db: Pick<ReturnType<typeof getDb>, 'select'>, profileId: string, inspirationId: string) {
  const [parent, profile, recent, media] = await Promise.all([
    db.select({text: inspirations.text}).from(inspirations).where(and(eq(inspirations.id,inspirationId),eq(inspirations.profileId,profileId))).limit(1),
    db.select({preferredLocale:profiles.preferredLocale}).from(profiles).where(eq(profiles.id,profileId)).limit(1),
    db.select({id:reflections.id,question:reflections.question,answer:reflections.answer}).from(reflections)
      .where(and(eq(reflections.inspirationId,inspirationId),eq(reflections.profileId,profileId),eq(reflections.skipped,false),isNotNull(reflections.answer)))
      .orderBy(desc(reflections.createdAt),desc(reflections.id)).limit(6),
    db.select({id:attachments.id,type:attachments.type,status:effectiveAttachmentStatus,kind:effectiveAttachmentKind,text:effectiveAttachmentText})
      .from(attachments).where(and(eq(attachments.inspirationId,inspirationId),eq(attachments.profileId,profileId))).orderBy(asc(attachments.id)),
  ]);
  if (!parent[0] || !profile[0]) return null;
  const input: ReflectionQuestionInput = {
    preferredLocale:isSupportedLocale(profile[0].preferredLocale)?profile[0].preferredLocale:'en-US',
    inspirationText:parent[0].text,
    reflections:[...recent].reverse().map(row=>({question:row.question,answer:row.answer??''})),
    attachments:media.map(row=>({type:row.type,status:row.status??'unavailable',kind:row.kind,
      text:row.status === 'ready' ? row.text : null})),
  };
  return {latestId:recent[0]?.id,input,hash:hashEmbeddingInput(JSON.stringify({input,attachmentIds:media.map(row=>row.id)}))};
}
