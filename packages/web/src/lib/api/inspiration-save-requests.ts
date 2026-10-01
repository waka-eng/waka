import { ApiError, apiPath, getJson, type ProfileScoped } from './http';
import type { ApiInspirationProcessingReceipt } from './inspiration-processing';

export interface InspirationSaveOptions extends ProfileScoped {
  /** One UUID per authored intent. Reuse it after an ambiguous response. */
  requestId?: string;
  signal?: AbortSignal;
}
export interface ApiInspirationSaveReceipt { requestId: string; replayed: boolean }
export interface ApiInspirationSaveRequest {
  requestId: string;
  operation: 'inspiration' | 'reflection';
  inspirationId: string;
  reflectionId: string | null;
  processing: ApiInspirationProcessingReceipt;
  createdAt: string;
}

/** A read observes committed work only. 404 is not proof that a timed-out POST
 * cannot still commit; a retry must keep its original request identity. */
export async function fetchInspirationSaveRequest(requestId: string, options: ProfileScoped = {}, signal?: AbortSignal): Promise<ApiInspirationSaveRequest> {
  const query = options.profile ? `?profile=${encodeURIComponent(options.profile)}` : '';
  const body = await getJson<{ saveRequest: ApiInspirationSaveRequest }>(apiPath(`/inspirations/save-requests/${encodeURIComponent(requestId)}${query}`), 'Could not check this save', signal);
  const saved = body?.saveRequest;
  if (!saved || saved.requestId !== requestId.toLowerCase() || !['inspiration', 'reflection'].includes(saved.operation) ||
    !saved.inspirationId || saved.processing?.inspirationId !== saved.inspirationId ||
    (options.profile && saved.processing.profileId !== options.profile) ||
    (saved.operation === 'reflection' && !saved.reflectionId)) {
    throw new ApiError({ status: 200, message: 'Could not verify this save' });
  }
  return saved;
}
