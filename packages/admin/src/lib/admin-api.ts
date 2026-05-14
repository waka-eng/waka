export type AdminJobStatus = "pending" | "running" | "succeeded" | "failed";
export type AdminJobType = "process_inspiration";

export interface AdminBackgroundJobPipelineDetail {
  type: "process_inspiration";
  inspiration: {
    id: string;
    textPreview: string;
    kind: string | null;
    category: number | null;
    cluster: string | null;
    classifiedAt: string | null;
    importanceScore: number;
    wowScore: number;
    createdAt: string;
    updatedAt: string;
  } | null;
  inspirationMissingReason: "payload_missing" | "not_found_or_not_visible" | null;
  wowMoments: Array<{
    id: string;
    kind: string;
    titlePreview: string;
    explanationPreview: string;
    wowScore: number;
    createdAt: string;
  }>;
}

export interface AdminBackgroundJob {
  id: string;
  userId: string;
  type: AdminJobType | string;
  status: AdminJobStatus | string;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  lockedAt: string | null;
  lastError: string | null;
  idempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
  payloadSummary: {
    inspirationId?: unknown;
    [key: string]: unknown;
  };
  pipeline?: AdminBackgroundJobPipelineDetail;
}

export interface ListBackgroundJobsFilters {
  status?: string;
  type?: string;
}

export class AdminApiError extends Error {
  readonly status: number;

  constructor(input: { status: number; message: string }) {
    super(input.message);
    this.name = "AdminApiError";
    this.status = input.status;
  }
}

export function adminApiPath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function errorMessageForStatus(status: number, fallback: string): string {
  if (status === 404) {
    return "Admin routes are disabled. Set WAKA_ENABLE_BACKGROUND_JOBS_ADMIN=true on the API/dev server.";
  }
  if (status === 401 || status === 403) {
    return "Sign into the WAKA app first; this admin app requires the normal auth cookie.";
  }
  return fallback;
}

async function parseJsonBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function messageFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error?: unknown }).error;
    if (typeof error === "string" && error.trim().length > 0) return error;
  }
  return fallback;
}

function isStringOrNull(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function assertPipeline(value: unknown): AdminBackgroundJobPipelineDetail {
  if (!value || typeof value !== "object") {
    throw new AdminApiError({ status: 200, message: "Malformed background job pipeline response" });
  }
  const candidate = value as Partial<AdminBackgroundJobPipelineDetail>;
  if (
    candidate.type !== "process_inspiration" ||
    !Array.isArray(candidate.wowMoments) ||
    !(
      candidate.inspirationMissingReason === null ||
      candidate.inspirationMissingReason === "payload_missing" ||
      candidate.inspirationMissingReason === "not_found_or_not_visible"
    )
  ) {
    throw new AdminApiError({ status: 200, message: "Malformed background job pipeline response" });
  }

  if (candidate.inspiration !== null) {
    const inspiration = candidate.inspiration;
    if (
      !inspiration ||
      typeof inspiration.id !== "string" ||
      typeof inspiration.textPreview !== "string" ||
      !isStringOrNull(inspiration.kind) ||
      !(typeof inspiration.category === "number" || inspiration.category === null) ||
      !isStringOrNull(inspiration.cluster) ||
      !isStringOrNull(inspiration.classifiedAt) ||
      typeof inspiration.importanceScore !== "number" ||
      typeof inspiration.wowScore !== "number" ||
      typeof inspiration.createdAt !== "string" ||
      typeof inspiration.updatedAt !== "string"
    ) {
      throw new AdminApiError({ status: 200, message: "Malformed background job pipeline response" });
    }
  }

  for (const moment of candidate.wowMoments) {
    if (
      !moment ||
      typeof moment !== "object" ||
      typeof moment.id !== "string" ||
      typeof moment.kind !== "string" ||
      typeof moment.titlePreview !== "string" ||
      typeof moment.explanationPreview !== "string" ||
      typeof moment.wowScore !== "number" ||
      typeof moment.createdAt !== "string"
    ) {
      throw new AdminApiError({ status: 200, message: "Malformed background job pipeline response" });
    }
  }

  return candidate as AdminBackgroundJobPipelineDetail;
}

function assertJob(value: unknown): AdminBackgroundJob {
  if (!value || typeof value !== "object") {
    throw new AdminApiError({ status: 200, message: "Malformed background job response" });
  }
  const candidate = value as Partial<AdminBackgroundJob>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.type !== "string" ||
    typeof candidate.status !== "string" ||
    typeof candidate.attempts !== "number" ||
    typeof candidate.maxAttempts !== "number" ||
    typeof candidate.runAfter !== "string" ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.updatedAt !== "string" ||
    typeof candidate.payloadSummary !== "object" ||
    candidate.payloadSummary === null
  ) {
    throw new AdminApiError({ status: 200, message: "Malformed background job response" });
  }
  if ("pipeline" in candidate && candidate.pipeline !== undefined) {
    candidate.pipeline = assertPipeline(candidate.pipeline);
  }
  return candidate as AdminBackgroundJob;
}

async function fetchJobRequest(path: string, fallback: string): Promise<AdminBackgroundJob> {
  let res: Response;
  try {
    res = await fetch(adminApiPath(path), {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new AdminApiError({ status: 0, message: fallback });
  }

  const body = await parseJsonBody(res);
  if (!res.ok) {
    throw new AdminApiError({
      status: res.status,
      message: errorMessageForStatus(res.status, messageFromBody(body, "Failed to load job detail")),
    });
  }

  if (!body || typeof body !== "object" || !("job" in body)) {
    throw new AdminApiError({ status: res.status, message: "Malformed background job detail response" });
  }

  return assertJob((body as { job: unknown }).job);
}

export async function fetchBackgroundJobs(
  filters: ListBackgroundJobsFilters = {},
): Promise<AdminBackgroundJob[]> {
  const query = new URLSearchParams();
  if (filters.status) query.set("status", filters.status);
  if (filters.type) query.set("type", filters.type);

  const url = adminApiPath(`/api/admin/background-jobs${query.size ? `?${query}` : ""}`);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new AdminApiError({ status: 0, message: "Network unreachable while loading jobs" });
  }

  const body = await parseJsonBody(res);
  if (!res.ok) {
    throw new AdminApiError({
      status: res.status,
      message: errorMessageForStatus(res.status, messageFromBody(body, "Failed to load jobs")),
    });
  }

  if (!body || typeof body !== "object" || !Array.isArray((body as { jobs?: unknown }).jobs)) {
    throw new AdminApiError({ status: res.status, message: "Malformed background jobs response" });
  }

  return (body as { jobs: unknown[] }).jobs.map(assertJob);
}

export async function fetchBackgroundJobDetail(id: string): Promise<AdminBackgroundJob> {
  return fetchJobRequest(
    `/api/admin/background-jobs/${id}`,
    "Network unreachable while loading job detail",
  );
}

export async function retryBackgroundJob(id: string): Promise<AdminBackgroundJob> {
  let res: Response;
  try {
    res = await fetch(adminApiPath(`/api/admin/background-jobs/${id}/retry`), {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new AdminApiError({ status: 0, message: "Network unreachable while retrying job" });
  }

  const body = await parseJsonBody(res);
  if (!res.ok) {
    throw new AdminApiError({
      status: res.status,
      message: errorMessageForStatus(res.status, messageFromBody(body, "Failed to retry job")),
    });
  }

  if (!body || typeof body !== "object" || !("job" in body)) {
    throw new AdminApiError({ status: res.status, message: "Malformed retry response" });
  }

  return assertJob((body as { job: unknown }).job);
}
