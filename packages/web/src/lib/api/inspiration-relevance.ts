import { apiPath, getJson, postJson } from './http';

export interface InspirationRelevance {
  id: string; text: string; kind: string | null; createdAt: string;
  sourceRevision: string; reviewVersion: number;
  memoryExcludedAt: string | null; reviewAfter: string | null; attachmentLabel: string | null;
}
export type RelevanceChoice = 'relevant' | 'not_relevant' | 'later';
export async function listInspirationReviews(profile: string): Promise<InspirationRelevance[]> {
  return (await getJson<{items:InspirationRelevance[]}>(apiPath(`/inspiration-relevance?profile=${encodeURIComponent(profile)}&limit=2`),'Could not load inspiration reviews')).items;
}
export async function readInspirationRelevance(id: string, profile: string): Promise<InspirationRelevance> {
  return (await getJson<{item:InspirationRelevance}>(apiPath(`/inspiration-relevance/${encodeURIComponent(id)}?profile=${encodeURIComponent(profile)}`),'Could not load inspiration relevance')).item;
}
export async function reviewInspiration(item: InspirationRelevance, profile: string, choice: RelevanceChoice, requestId: string): Promise<void> {
  await postJson(apiPath(`/inspiration-relevance/${encodeURIComponent(item.id)}?profile=${encodeURIComponent(profile)}`),
    {requestId,sourceRevision:item.sourceRevision,reviewVersion:item.reviewVersion,choice},'Could not save your review');
}
