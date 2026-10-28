import { apiPath, getJson, postJson, type ProfileScoped } from './http';
import type { ApiTopOfMindRefreshResult } from './top-of-mind';

export interface ApiInspirationProcessingReceipt {
  id: string; profileId: string; inspirationId: string; materialRevision: string;
  jobId: string; requestVersion: string;
}
export interface ApiInspirationProcessingStatus {
  profileId: string; inspirationId: string;
  receipt: Pick<ApiInspirationProcessingReceipt, 'id' | 'profileId' | 'inspirationId' | 'materialRevision'> | null;
  currentMaterialRevision: string | null;
  requestedMaterialRevision: string | null;
  latestDerivedRevision: string;
  latestCompletedRevision: string;
  superseded: boolean;
  phase: 'queued' | 'processing' | 'waiting' | 'ready' | 'failed' | 'unknown';
  stage: 'enrichment' | 'derivation' | 'reading' | null;
  runAfter: string | null;
  result: ApiTopOfMindRefreshResult | null;
  unavailableAttachments: number;
  canRetry: boolean;
}

export function fetchInspirationProcessing(inspirationId: string, options: ProfileScoped & { receiptId?: string } = {}, signal?: AbortSignal): Promise<ApiInspirationProcessingStatus> {
  const query = new URLSearchParams();
  if (options.profile) query.set('profile', options.profile);
  if (options.receiptId) query.set('receipt', options.receiptId);
  return getJson(apiPath(`/inspirations/${encodeURIComponent(inspirationId)}/processing${query.size ? `?${query}` : ''}`), 'Could not check this reading', signal);
}

export function retryInspirationProcessing(inspirationId: string, options: ProfileScoped & { receiptId?: string } = {}, signal?: AbortSignal): Promise<ApiInspirationProcessingStatus> {
  const query = options.profile ? `?profile=${encodeURIComponent(options.profile)}` : '';
  return postJson(apiPath(`/inspirations/${encodeURIComponent(inspirationId)}/processing/retry${query}`),
    { ...(options.receiptId ? { receiptId: options.receiptId } : {}) }, 'Could not resume this reading', signal);
}

export interface ApiProfileProcessing {
  profileId: string; total: number; failed: number;
  items: Array<{ inspirationId: string; createdAt: string; stage: string;
    phase: ApiInspirationProcessingStatus['phase']; runAfter: string | null }>;
}
export function fetchProfileProcessing(profileId: string, signal?: AbortSignal): Promise<ApiProfileProcessing> {
  return getJson(apiPath(`/inspirations/processing?profile=${encodeURIComponent(profileId)}`), 'Could not check saved inspirations', signal);
}
