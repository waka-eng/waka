import { INSPIRATION_ENRICHMENT_FIELD_STATUS_FAILED } from "../inspirations/enrichment-field-metadata.ts";
import type {
  WorkspaceHomeClusterItemPreview,
  WorkspaceHomeClusterPreview,
} from "./workspace-home-screen-model.ts";

export const WORKSPACE_HOME_AI_FIELD_FADE_IN_DURATION_MS = 240;
export const WORKSPACE_HOME_AI_FIELD_FADE_IN_CLASS_NAME =
  "motion-safe:animate-[waka-ai-field-fade-in_240ms_ease-out]";

export type WorkspaceHomeAiFieldName = "title" | "summary" | "tags";

function hasResolvedSummary(
  item: WorkspaceHomeClusterItemPreview,
): boolean {
  return (
    !item.isSummaryPending &&
    typeof item.summary === "string" &&
    item.summary.trim().length > 0
  );
}

function hasResolvedTags(item: WorkspaceHomeClusterItemPreview): boolean {
  return !item.isTagsPending && Array.isArray(item.tags) && item.tags.length > 0;
}

export function createWorkspaceHomeAiFieldTransitionKey(
  itemId: string,
  fieldName: WorkspaceHomeAiFieldName,
): string {
  return `${itemId}:${fieldName}`;
}

export function collectWorkspaceHomeAiFieldFadeInKeys(
  previousClusterPreviews: readonly WorkspaceHomeClusterPreview[],
  nextClusterPreviews: readonly WorkspaceHomeClusterPreview[],
): readonly string[] {
  const previousItemsById = new Map<string, WorkspaceHomeClusterItemPreview>();

  for (const cluster of previousClusterPreviews) {
    for (const item of cluster.items ?? []) {
      if (typeof item.id !== "string" || item.id.length === 0) {
        continue;
      }

      previousItemsById.set(item.id, item);
    }
  }

  const fadeInFieldKeys = new Set<string>();

  for (const cluster of nextClusterPreviews) {
    for (const item of cluster.items ?? []) {
      if (typeof item.id !== "string" || item.id.length === 0) {
        continue;
      }

      const previousItem = previousItemsById.get(item.id);

      if (previousItem === undefined) {
        continue;
      }

      if (
        previousItem.isTitlePending &&
        !item.isTitlePending &&
        item.titleStatus !== INSPIRATION_ENRICHMENT_FIELD_STATUS_FAILED
      ) {
        fadeInFieldKeys.add(
          createWorkspaceHomeAiFieldTransitionKey(item.id, "title"),
        );
      }

      if (previousItem.isSummaryPending && hasResolvedSummary(item)) {
        fadeInFieldKeys.add(
          createWorkspaceHomeAiFieldTransitionKey(item.id, "summary"),
        );
      }

      if (previousItem.isTagsPending && hasResolvedTags(item)) {
        fadeInFieldKeys.add(
          createWorkspaceHomeAiFieldTransitionKey(item.id, "tags"),
        );
      }
    }
  }

  return [...fadeInFieldKeys];
}
