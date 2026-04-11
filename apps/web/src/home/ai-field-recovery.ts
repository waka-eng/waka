import type {
  WorkspaceHomeManualAiFieldValue,
  WorkspaceHomeRecoverableAiFieldName,
} from "./workspace-home-screen-model.ts";

export interface RetryWorkspaceHomeAiFieldResult {
  id: string;
  queuedFieldNames: WorkspaceHomeRecoverableAiFieldName[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readResponseError(response: Response): Promise<string> {
  try {
    const payload = await response.json();

    if (isRecord(payload) && typeof payload.error === "string") {
      return payload.error;
    }
  } catch {
    // Fall back to a generic message when the response body is not JSON.
  }

  return `Request failed with status ${response.status}.`;
}

function buildManualFieldRecoveryRequestBody(
  fieldName: WorkspaceHomeRecoverableAiFieldName,
  value: WorkspaceHomeManualAiFieldValue,
): string {
  switch (fieldName) {
    case "summary":
      return JSON.stringify({
        summary: value,
      });
    case "tags":
      return JSON.stringify({
        tags: value,
      });
    case "title":
      return JSON.stringify({
        title: value,
      });
  }
}

export async function retryWorkspaceHomeAiField(
  inspirationId: string,
  fieldName: WorkspaceHomeRecoverableAiFieldName,
  fetchImplementation: typeof fetch = fetch,
): Promise<RetryWorkspaceHomeAiFieldResult> {
  const response = await fetchImplementation(
    `/api/inspirations/${encodeURIComponent(inspirationId)}/rerun`,
    {
      body: JSON.stringify({
        fieldNames: [fieldName],
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    },
  );

  if (!response.ok) {
    throw new Error(await readResponseError(response));
  }

  const payload = await response.json();

  if (
    !isRecord(payload) ||
    typeof payload.id !== "string" ||
    !Array.isArray(payload.queuedFieldNames)
  ) {
    throw new TypeError("AI field retry response body is invalid.");
  }

  return {
    id: payload.id,
    queuedFieldNames: payload.queuedFieldNames.filter(
      (entry): entry is WorkspaceHomeRecoverableAiFieldName =>
        entry === "summary" || entry === "tags" || entry === "title",
    ),
  };
}

export async function saveWorkspaceHomeManualAiFieldRecovery(
  inspirationId: string,
  fieldName: WorkspaceHomeRecoverableAiFieldName,
  value: WorkspaceHomeManualAiFieldValue,
  fetchImplementation: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImplementation(
    `/api/inspirations/${encodeURIComponent(inspirationId)}`,
    {
      body: buildManualFieldRecoveryRequestBody(fieldName, value),
      headers: {
        "content-type": "application/json",
      },
      method: "PUT",
    },
  );

  if (!response.ok) {
    throw new Error(await readResponseError(response));
  }
}
