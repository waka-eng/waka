import type { ApiPrincipleStatus } from "./api/principles";

export function principleReviewMessage(status: ApiPrincipleStatus | null | undefined) {
  if (status?.phase === "pending") {
    return status.supportActive ? "worldSupportQueued" : "worldPrinciplesQueued";
  }
  if (status?.phase === "processing") {
    return status.supportActive ? "worldSupportChecking" : "worldPrinciplesReading";
  }
  return null;
}
