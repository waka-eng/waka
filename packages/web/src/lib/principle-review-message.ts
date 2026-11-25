import type { ApiPrincipleStatus } from "./api/principles";

export function principleReviewMessage(status: ApiPrincipleStatus | null | undefined) {
  if (status?.phase === "pending") {
    const waitingOnSupport = status.supportActive ?? (!status.eligible && status.supportPending);
    return waitingOnSupport ? "worldSupportQueued" : "worldPrinciplesQueued";
  }
  if (status?.phase === "processing") {
    // Older servers reported queued Principle reviews as processing.
    if (typeof status.supportActive !== "boolean") return "worldPrinciplesAwaitingResult";
    return status.supportActive ? "worldSupportChecking" : "worldPrinciplesReading";
  }
  return null;
}
