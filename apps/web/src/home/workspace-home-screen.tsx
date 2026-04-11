"use client";

import { useEffect, useRef, useState } from "react";

import {
  retryWorkspaceHomeAiField,
  saveWorkspaceHomeManualAiFieldRecovery,
} from "./ai-field-recovery.ts";
import {
  collectWorkspaceHomeAiFieldFadeInKeys,
  createWorkspaceHomeAiFieldTransitionKey,
  WORKSPACE_HOME_AI_FIELD_FADE_IN_CLASS_NAME,
  WORKSPACE_HOME_AI_FIELD_FADE_IN_DURATION_MS,
} from "./workspace-home-ai-field-fade.ts";
import {
  INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
  INSPIRATION_ENRICHMENT_FIELD_STATUS_FAILED,
  type InspirationEnrichmentFieldStatus,
} from "../inspirations/enrichment-field-metadata.ts";
import {
  getWorkspaceHomePendingTextCaptureIds,
  pollWorkspaceHomePendingTextCaptureEnrichment,
  WORKSPACE_HOME_PENDING_TEXT_CAPTURE_POLL_INTERVAL_MS,
} from "./text-capture-enrichment-poll.ts";
import { useWorkspaceHomeShellState } from "./workspace-home-shell-context.tsx";
import {
  applyWorkspaceHomeTextCaptureEnrichmentUpdates,
  getWorkspaceHomeRecordDetail,
  getWorkspaceHomeScreenModel,
  applyWorkspaceHomeManualAiFieldRecovery,
  formatWorkspaceHomeDiscoveryClusterMovement,
  getWorkspaceHomeDiscoveryPreviewExcerpt,
  getWorkspaceHomeDiscoveryPreviewTitle,
  markWorkspaceHomeAiFieldRecoveryPending,
  shouldRenderWorkspaceHomeInlineReflection,
  type WorkspaceHomeClusterPreview,
  type WorkspaceHomeManualAiFieldValue,
  type WorkspaceHomeRecoverableAiFieldName,
  type GetWorkspaceHomeScreenModelOptions,
  type WorkspaceHomeClusterItemPreview,
  WORKSPACE_HOME_CLUSTER_FEED_EMPTY_MESSAGE,
  WORKSPACE_HOME_CLUSTER_FEED_EMPTY_TITLE,
  WORKSPACE_HOME_DISCOVERIES_EMPTY_MESSAGE,
  WORKSPACE_HOME_DISCOVERIES_EMPTY_TITLE,
} from "./workspace-home-screen-model.ts";
import { StableControlLabel } from "../ui/stable-control-label.tsx";

export interface WorkspaceHomeScreenProps
  extends GetWorkspaceHomeScreenModelOptions {}

function formatClusterItemSource(sourceType?: string): string | null {
  if (typeof sourceType !== "string" || sourceType.trim().length === 0) {
    return null;
  }

  return sourceType
    .split("_")
    .map((segment) => {
      if (segment === "AI") {
        return "AI";
      }

      const normalizedSegment = segment.toLowerCase();

      return `${normalizedSegment.slice(0, 1).toUpperCase()}${normalizedSegment.slice(1)}`;
    })
    .join(" ");
}

const workspaceHomeDiscoveryDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function formatWorkspaceHomeDiscoveryDate(createdAt: string): string | null {
  const timestamp = new Date(createdAt);

  if (Number.isNaN(timestamp.getTime())) {
    return null;
  }

  return workspaceHomeDiscoveryDateFormatter.format(timestamp);
}

interface WorkspaceHomeCaptureStatusBadge {
  kind: "enriching" | "retry" | "saving" | "sync";
  label: string;
}

function getWorkspaceHomeCaptureStatusBadges(item: {
  isSummaryPending?: boolean;
  isTagsPending?: boolean;
  isTitlePending?: boolean;
  saveState?: WorkspaceHomeClusterItemPreview["saveState"];
  syncStatus?: WorkspaceHomeClusterItemPreview["syncStatus"];
}): WorkspaceHomeCaptureStatusBadge[] {
  const badges: WorkspaceHomeCaptureStatusBadge[] = [];

  if (item.syncStatus === "pending-sync") {
    badges.push({
      kind: "sync",
      label: "Saving when online",
    });
  }

  if (item.saveState === "saving") {
    badges.push({
      kind: "saving",
      label: "Saving now",
    });
  }

  if (item.saveState === "failed") {
    badges.push({
      kind: "retry",
      label: "Needs retry",
    });
  }

  if (
    item.syncStatus !== "pending-sync" &&
    item.saveState !== "saving" &&
    item.saveState !== "failed" &&
    (item.isTitlePending || item.isSummaryPending || item.isTagsPending)
  ) {
    badges.push({
      kind: "enriching",
      label: "Adding details",
    });
  }

  return badges;
}

function getWorkspaceHomeCaptureStatusBadgeClasses(
  badgeKind: WorkspaceHomeCaptureStatusBadge["kind"],
): string {
  switch (badgeKind) {
    case "sync":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "retry":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "saving":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "enriching":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
}

type WorkspaceHomeAiFieldName = "summary" | "tags" | "title";
type WorkspaceHomeAiFieldTerminalTone = "completed" | "manual";

interface WorkspaceHomeAiFieldTerminalState {
  badge: string;
  message: string;
  tone: WorkspaceHomeAiFieldTerminalTone;
}

function getWorkspaceHomeAiFieldTerminalState(
  fieldName: WorkspaceHomeAiFieldName,
  fieldStatus: InspirationEnrichmentFieldStatus | undefined,
  hasValue: boolean,
): WorkspaceHomeAiFieldTerminalState | null {
  if (fieldStatus === INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED) {
    switch (fieldName) {
      case "title":
        return {
          badge: "Ready",
          message: "Title suggestion added.",
          tone: "completed",
        };
      case "summary":
        return {
          badge: "Ready",
          message: hasValue
            ? "Summary suggestion added."
            : "No summary was added.",
          tone: "completed",
        };
      case "tags":
        return {
          badge: "Ready",
          message: hasValue
            ? "Tags were added."
            : "No tags were added.",
          tone: "completed",
        };
    }
  }

  if (fieldStatus === INSPIRATION_ENRICHMENT_FIELD_STATUS_FAILED) {
    switch (fieldName) {
      case "title":
        return {
          badge: "Needs input",
          message: "Add a title yourself if you want one here.",
          tone: "manual",
        };
      case "summary":
        return {
          badge: "Needs input",
          message: "Write a summary yourself if this note needs one.",
          tone: "manual",
        };
      case "tags":
        return {
          badge: "Needs input",
          message: "Add tags yourself if you want to organize this note now.",
          tone: "manual",
        };
    }
  }

  return null;
}

function getWorkspaceHomeAiFieldTerminalClasses(
  tone: WorkspaceHomeAiFieldTerminalTone,
): string {
  return tone === "completed"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-amber-200 bg-amber-50 text-amber-700";
}

const WORKSPACE_HOME_INLINE_ACTION_BUTTON_CLASS_NAME =
  "inline-flex min-h-11 w-full max-w-full items-center justify-center rounded-full px-4 py-2.5 text-center text-sm font-medium leading-5 whitespace-normal break-words transition focus-visible:outline-none focus-visible:ring-2 md:w-auto";
const WORKSPACE_HOME_MOBILE_RECORD_DRAWER_HANDLE_BUTTON_CLASS_NAME =
  "inline-flex min-h-11 w-full max-w-full items-center justify-center rounded-full px-4 py-2.5 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70";
const WORKSPACE_HOME_MOBILE_RECORD_DRAWER_HEADER_CLASS_NAME =
  "mt-2 flex min-w-0 flex-col items-stretch gap-3 md:flex-row md:items-start md:justify-between";
const WORKSPACE_HOME_MOBILE_RECORD_DRAWER_CLOSE_BUTTON_CLASS_NAME =
  "inline-flex min-h-11 w-full max-w-full items-center justify-center rounded-full border border-stone-200 bg-white px-4 py-2.5 text-center text-sm font-medium leading-5 whitespace-normal break-words text-stone-700 transition hover:border-stone-300 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300/60 md:min-w-11 md:w-auto";
const WORKSPACE_HOME_MOBILE_RECORD_DRAWER_FOOTER_ACTION_BUTTON_CLASS_NAME =
  "inline-flex min-h-11 w-full items-center justify-center rounded-full border border-stone-200 bg-white px-4 py-2.5 text-center text-sm font-medium leading-5 whitespace-normal break-words text-stone-700 transition hover:border-stone-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300/60";
const WORKSPACE_HOME_RECENT_RECORDS_GRID_CLASS_NAME =
  "mt-6 grid min-w-0 gap-4 min-[56rem]:grid-cols-[repeat(auto-fit,minmax(16rem,1fr))]";
const WORKSPACE_HOME_CLUSTER_GRID_CLASS_NAME =
  "mt-6 grid min-w-0 gap-4 min-[56rem]:grid-cols-[repeat(auto-fit,minmax(18rem,1fr))]";
const WORKSPACE_HOME_CONTENT_GRID_CLASS_NAME =
  "grid gap-6 xl:items-start xl:grid-cols-[minmax(0,1fr)_minmax(18rem,20rem)]";
const WORKSPACE_HOME_DISCOVERY_GRID_CLASS_NAME =
  "mt-5 grid min-w-0 gap-3 text-sm leading-6 text-stone-600";
const WORKSPACE_HOME_SECONDARY_PANEL_STACK_CLASS_NAME =
  "flex min-w-0 flex-col gap-6";

interface WorkspaceHomeRecentRecordPreview
  extends WorkspaceHomeClusterItemPreview {
  clusterName: string;
}

function collectWorkspaceHomeRecentRecords(
  clusterPreviews: readonly WorkspaceHomeClusterPreview[],
  maximumItemCount = 6,
): WorkspaceHomeRecentRecordPreview[] {
  const recentRecords: WorkspaceHomeRecentRecordPreview[] = [];

  for (const cluster of clusterPreviews) {
    for (const item of cluster.items ?? []) {
      recentRecords.push({
        ...item,
        clusterName: cluster.name,
      });

      if (recentRecords.length >= maximumItemCount) {
        return recentRecords;
      }
    }
  }

  return recentRecords;
}

type WorkspaceHomeAiFieldRecoveryAction = "retry" | "save";

function createWorkspaceHomeManualAiFieldDrafts(selectedRecordDetail?: {
  summary?: string;
  tags?: readonly string[];
  title: string;
}): Record<WorkspaceHomeRecoverableAiFieldName, string> {
  return {
    summary: selectedRecordDetail?.summary ?? "",
    tags: (selectedRecordDetail?.tags ?? []).join(", "),
    title: selectedRecordDetail?.title ?? "",
  };
}

function parseWorkspaceHomeManualTagsDraft(tagsDraft: string): string[] {
  return [...new Set(tagsDraft
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0))];
}

function resolveWorkspaceHomeManualAiFieldValue(
  fieldName: WorkspaceHomeRecoverableAiFieldName,
  fieldDraft: string,
): WorkspaceHomeManualAiFieldValue | null {
  if (fieldName === "tags") {
    const tags = parseWorkspaceHomeManualTagsDraft(fieldDraft);

    return tags.length > 0 ? tags : null;
  }

  const normalizedDraft = fieldDraft.trim();

  return normalizedDraft.length > 0 ? normalizedDraft : null;
}

export function WorkspaceHomeScreen(
  props: WorkspaceHomeScreenProps = {},
) {
  const model = getWorkspaceHomeScreenModel(props);
  const hasExplicitInitialClusterPreviews =
    props.initialClusterData !== undefined ||
    props.initialClusterFeed !== undefined ||
    props.initialClusterPreviews !== undefined;
  const {
    clusterPreviews,
    selectedRecordId,
    setClusterPreviews,
    setSelectedRecordId,
  } = useWorkspaceHomeShellState();
  const [recentlyResolvedAiFieldKeys, setRecentlyResolvedAiFieldKeys] =
    useState(() => new Set<string>());
  const pendingTextCaptureIdsRef = useRef<Set<string>>(
    new Set(getWorkspaceHomePendingTextCaptureIds(clusterPreviews)),
  );
  const previousClusterPreviewsRef = useRef(clusterPreviews);
  const hasHydratedInitialClusterPreviewsRef = useRef(false);
  const isPollingPendingTextCapturesRef = useRef(false);
  const aiFieldFadeTimeoutsRef = useRef<
    Map<string, ReturnType<typeof globalThis.setTimeout>>
  >(new Map());
  const recentRecords = collectWorkspaceHomeRecentRecords(clusterPreviews);
  const selectedRecordDetail = getWorkspaceHomeRecordDetail(
    clusterPreviews,
    selectedRecordId,
  );
  const [aiFieldRecoveryDrafts, setAiFieldRecoveryDrafts] = useState(() =>
    createWorkspaceHomeManualAiFieldDrafts(selectedRecordDetail),
  );
  const [aiFieldRecoveryErrors, setAiFieldRecoveryErrors] = useState<
    Partial<Record<WorkspaceHomeRecoverableAiFieldName, string>>
  >({});
  const [aiFieldRecoveryEditors, setAiFieldRecoveryEditors] = useState<
    Partial<Record<WorkspaceHomeRecoverableAiFieldName, boolean>>
  >({});
  const [aiFieldRecoveryPendingActions, setAiFieldRecoveryPendingActions] =
    useState<
      Partial<
        Record<
          WorkspaceHomeRecoverableAiFieldName,
          WorkspaceHomeAiFieldRecoveryAction
        >
      >
    >({});
  const [isMobileRecordDetailDrawerOpen, setIsMobileRecordDetailDrawerOpen] =
    useState(false);
  const hasPendingTextCaptures =
    getWorkspaceHomePendingTextCaptureIds(clusterPreviews).length > 0;

  useEffect(() => {
    if (!hasExplicitInitialClusterPreviews) {
      return;
    }

    if (hasHydratedInitialClusterPreviewsRef.current) {
      return;
    }

    hasHydratedInitialClusterPreviewsRef.current = true;
    setClusterPreviews(model.clusterPreviews);
  }, [hasExplicitInitialClusterPreviews, model.clusterPreviews, setClusterPreviews]);

  useEffect(() => {
    pendingTextCaptureIdsRef.current = new Set(
      getWorkspaceHomePendingTextCaptureIds(clusterPreviews),
    );
  }, [clusterPreviews]);

  useEffect(() => {
    setAiFieldRecoveryDrafts(
      createWorkspaceHomeManualAiFieldDrafts(selectedRecordDetail),
    );
    setAiFieldRecoveryErrors({});
    setAiFieldRecoveryEditors({});
    setAiFieldRecoveryPendingActions({});
  }, [selectedRecordDetail?.id]);

  useEffect(() => {
    if (selectedRecordDetail === undefined) {
      setIsMobileRecordDetailDrawerOpen(false);
    }
  }, [selectedRecordDetail]);

  useEffect(() => {
    const fadeInFieldKeys = collectWorkspaceHomeAiFieldFadeInKeys(
      previousClusterPreviewsRef.current,
      clusterPreviews,
    );

    previousClusterPreviewsRef.current = clusterPreviews;

    if (fadeInFieldKeys.length === 0) {
      return;
    }

    setRecentlyResolvedAiFieldKeys((currentFieldKeys) => {
      const nextFieldKeys = new Set(currentFieldKeys);

      for (const fieldKey of fadeInFieldKeys) {
        nextFieldKeys.add(fieldKey);
      }

      return nextFieldKeys;
    });

    for (const fieldKey of fadeInFieldKeys) {
      const activeTimeout = aiFieldFadeTimeoutsRef.current.get(fieldKey);

      if (activeTimeout !== undefined) {
        globalThis.clearTimeout(activeTimeout);
      }

      const fadeTimeout = globalThis.setTimeout(() => {
        aiFieldFadeTimeoutsRef.current.delete(fieldKey);
        setRecentlyResolvedAiFieldKeys((currentFieldKeys) => {
          if (!currentFieldKeys.has(fieldKey)) {
            return currentFieldKeys;
          }

          const nextFieldKeys = new Set(currentFieldKeys);
          nextFieldKeys.delete(fieldKey);
          return nextFieldKeys;
        });
      }, WORKSPACE_HOME_AI_FIELD_FADE_IN_DURATION_MS);

      aiFieldFadeTimeoutsRef.current.set(fieldKey, fadeTimeout);
    }
  }, [clusterPreviews]);

  useEffect(() => {
    if (!hasPendingTextCaptures) {
      return;
    }

    const pendingTextCapturePollInterval = globalThis.setInterval(() => {
      if (isPollingPendingTextCapturesRef.current) {
        return;
      }

      isPollingPendingTextCapturesRef.current = true;

      void pollWorkspaceHomePendingTextCaptureEnrichment(
        [...pendingTextCaptureIdsRef.current],
      )
        .then((enrichmentUpdates) => {
          if (enrichmentUpdates.length === 0) {
            return;
          }

          setClusterPreviews((currentClusterPreviews) => {
            const nextClusterPreviews =
              applyWorkspaceHomeTextCaptureEnrichmentUpdates(
                currentClusterPreviews,
                enrichmentUpdates,
              );

            pendingTextCaptureIdsRef.current = new Set(
              getWorkspaceHomePendingTextCaptureIds(nextClusterPreviews),
            );

            return nextClusterPreviews;
          });
        })
        .catch(() => undefined)
        .finally(() => {
          isPollingPendingTextCapturesRef.current = false;
        });
    }, WORKSPACE_HOME_PENDING_TEXT_CAPTURE_POLL_INTERVAL_MS);

    return () => {
      globalThis.clearInterval(pendingTextCapturePollInterval);
    };
  }, [hasPendingTextCaptures]);

  useEffect(() => {
    return () => {
      for (const timeoutId of aiFieldFadeTimeoutsRef.current.values()) {
        globalThis.clearTimeout(timeoutId);
      }

      aiFieldFadeTimeoutsRef.current.clear();
    };
  }, []);

  async function handleAiFieldRetry(
    fieldName: WorkspaceHomeRecoverableAiFieldName,
  ): Promise<void> {
    if (!selectedRecordDetail) {
      return;
    }

    const inspirationId = selectedRecordDetail.id;

    setAiFieldRecoveryErrors((currentErrors) => ({
      ...currentErrors,
      [fieldName]: undefined,
    }));
    setAiFieldRecoveryPendingActions((currentActions) => ({
      ...currentActions,
      [fieldName]: "retry",
    }));

    try {
      await retryWorkspaceHomeAiField(inspirationId, fieldName);
      setClusterPreviews((currentClusterPreviews) =>
        markWorkspaceHomeAiFieldRecoveryPending(
          currentClusterPreviews,
          inspirationId,
          fieldName,
        ),
      );
    } catch (error) {
      setAiFieldRecoveryErrors((currentErrors) => ({
        ...currentErrors,
        [fieldName]:
          error instanceof Error ? error.message : "Retry request failed.",
      }));
    } finally {
      setAiFieldRecoveryPendingActions((currentActions) => ({
        ...currentActions,
        [fieldName]: undefined,
      }));
    }
  }

  async function handleManualAiFieldSave(
    fieldName: WorkspaceHomeRecoverableAiFieldName,
  ): Promise<void> {
    if (!selectedRecordDetail) {
      return;
    }

    const fieldValue = resolveWorkspaceHomeManualAiFieldValue(
      fieldName,
      aiFieldRecoveryDrafts[fieldName],
    );

    if (fieldValue === null) {
      setAiFieldRecoveryErrors((currentErrors) => ({
        ...currentErrors,
        [fieldName]:
          fieldName === "tags"
            ? "Add at least one tag before saving manually."
            : "Enter a value before saving manually.",
      }));
      return;
    }

    const inspirationId = selectedRecordDetail.id;

    setAiFieldRecoveryErrors((currentErrors) => ({
      ...currentErrors,
      [fieldName]: undefined,
    }));
    setAiFieldRecoveryPendingActions((currentActions) => ({
      ...currentActions,
      [fieldName]: "save",
    }));

    try {
      await saveWorkspaceHomeManualAiFieldRecovery(
        inspirationId,
        fieldName,
        fieldValue,
      );
      setClusterPreviews((currentClusterPreviews) =>
        applyWorkspaceHomeManualAiFieldRecovery(
          currentClusterPreviews,
          inspirationId,
          fieldName,
          fieldValue,
        ),
      );
      setAiFieldRecoveryEditors((currentEditors) => ({
        ...currentEditors,
        [fieldName]: false,
      }));
      setAiFieldRecoveryDrafts((currentDrafts) => ({
        ...currentDrafts,
        [fieldName]:
          fieldName === "tags" ? (fieldValue as readonly string[]).join(", ") : (fieldValue as string),
      }));
    } catch (error) {
      setAiFieldRecoveryErrors((currentErrors) => ({
        ...currentErrors,
        [fieldName]:
          error instanceof Error ? error.message : "Manual save failed.",
      }));
    } finally {
      setAiFieldRecoveryPendingActions((currentActions) => ({
        ...currentActions,
        [fieldName]: undefined,
      }));
    }
  }

  function handleRecordDetailSelection(recordId: string): void {
    setSelectedRecordId(recordId);
    setIsMobileRecordDetailDrawerOpen(true);
  }

  function handleMobileRecordDetailDrawerClose(): void {
    setIsMobileRecordDetailDrawerOpen(false);
  }

  function handleRecordDetailDismiss(): void {
    setSelectedRecordId(undefined);
    setIsMobileRecordDetailDrawerOpen(false);
  }

  const failedAiRecoveryFields =
    selectedRecordDetail === undefined
      ? []
      : [
          {
            currentValue: selectedRecordDetail.title,
            fieldName: "title" as const,
            helperText:
              "Try the title again later, or write one yourself now.",
            inputPlaceholder: "Manual title",
            label: "Title",
            status: selectedRecordDetail.titleStatus,
          },
          {
            currentValue: selectedRecordDetail.summary ?? "",
            fieldName: "summary" as const,
            helperText:
              "Try the summary again later, or finish it yourself now.",
            inputPlaceholder: "Manual summary",
            label: "Summary",
            status: selectedRecordDetail.summaryStatus,
          },
          {
            currentValue: (selectedRecordDetail.tags ?? []).join(", "),
            fieldName: "tags" as const,
            helperText:
              "Try tags again later, or add comma-separated tags yourself now.",
            inputPlaceholder: "tag-one, tag-two",
            label: "Tags",
            status: selectedRecordDetail.tagsStatus,
          },
        ].filter((field) => field.status === INSPIRATION_ENRICHMENT_FIELD_STATUS_FAILED);
  const shouldRenderInlineReflection =
    shouldRenderWorkspaceHomeInlineReflection(selectedRecordDetail);
  const isMobileRecordDetailDrawerVisible =
    selectedRecordDetail !== undefined && isMobileRecordDetailDrawerOpen;
  const recordDetailSectionContent = selectedRecordDetail ? (
    <div className="mt-5 space-y-5">
      <div className="flex flex-wrap items-start gap-2">
        {getWorkspaceHomeCaptureStatusBadges(selectedRecordDetail).map(
          (badge) => (
            <span
              key={`detail-${selectedRecordDetail.id}-${badge.kind}`}
              data-record-detail-status-badge={badge.kind}
              className={`max-w-full whitespace-normal break-words rounded-full border px-3 py-1 text-left text-[0.65rem] uppercase tracking-[0.2em] ${getWorkspaceHomeCaptureStatusBadgeClasses(
                badge.kind,
              )}`}
            >
              {badge.label}
            </span>
          ),
        )}
        {selectedRecordDetail.sourceType ? (
          <span className="max-w-full whitespace-normal break-words rounded-full border border-stone-200 bg-white px-3 py-1 text-left text-[0.65rem] uppercase tracking-[0.2em] text-stone-500">
            {formatClusterItemSource(selectedRecordDetail.sourceType)}
          </span>
        ) : null}
        {selectedRecordDetail.sourceParent ? (
          <span className="max-w-full whitespace-normal break-words rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-left text-[0.65rem] uppercase tracking-[0.2em] text-sky-700">
            Expanded from another note
          </span>
        ) : (
          <span className="max-w-full whitespace-normal break-words rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-left text-[0.65rem] uppercase tracking-[0.2em] text-emerald-700">
            Starting note
          </span>
        )}
      </div>

      <div className="min-w-0 space-y-2">
        <h3 className="break-words text-xl font-semibold text-stone-950">
          {selectedRecordDetail.title}
        </h3>
        {selectedRecordDetail.summary ? (
          <p className="break-words text-sm leading-6 text-stone-600">
            {selectedRecordDetail.summary}
          </p>
        ) : null}
      </div>

      {selectedRecordDetail.tags?.length ? (
        <ul className="flex flex-wrap gap-2">
          {selectedRecordDetail.tags.map((tag) => (
            <li
              key={`${selectedRecordDetail.id}-${tag}`}
              className="rounded-full border border-stone-200 bg-stone-100 px-3 py-1 text-[0.65rem] uppercase tracking-[0.18em] text-stone-600"
            >
              {tag}
            </li>
          ))}
        </ul>
      ) : null}

      {selectedRecordDetail.rawContent ? (
        <p className="whitespace-pre-wrap break-words rounded-[1.5rem] border border-stone-200 bg-[#fcfaf6] px-4 py-4 text-sm leading-6 text-stone-700">
          {selectedRecordDetail.rawContent}
        </p>
      ) : null}

      {shouldRenderInlineReflection ? (
        <div
          data-record-detail-reflection={selectedRecordDetail.reflectionStatus}
          className="rounded-[1.5rem] border border-sky-200 bg-sky-50 p-4"
        >
          <p className="text-xs uppercase tracking-[0.24em] text-sky-700">
            Something to think about
          </p>
          {selectedRecordDetail.reflectionPrompt ? (
            <p className="mt-3 text-sm leading-6 text-stone-900">
              {selectedRecordDetail.reflectionPrompt}
            </p>
          ) : null}
          <p className="mt-3 text-sm leading-6 text-stone-600">
            This note is already saved. Add more context here whenever you're
            ready.
          </p>
          {selectedRecordDetail.reflectionAnswer ? (
            <div
              data-record-detail-reflection-answer="saved"
              className="mt-4 rounded-[1rem] border border-stone-200 bg-white px-4 py-3"
            >
              <p className="text-xs uppercase tracking-[0.24em] text-stone-500">
                Your answer
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-stone-700">
                {selectedRecordDetail.reflectionAnswer}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {failedAiRecoveryFields.length > 0 ? (
        <div className="rounded-[1.5rem] border border-amber-200 bg-amber-50 p-4">
          <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.24em] text-amber-700">
                Finish missing details
              </p>
              <p className="mt-2 break-words text-sm leading-6 text-stone-600">
                If a suggested title, summary, or tags did not come through,
                try again or write it yourself.
              </p>
            </div>
            <span className="max-w-full self-start whitespace-normal break-words rounded-full border border-amber-200 bg-white px-3 py-1 text-left text-[0.65rem] uppercase tracking-[0.2em] text-amber-700">
              Needs input
            </span>
          </div>

          <div className="mt-4 grid gap-3">
            {failedAiRecoveryFields.map((field) => {
              const pendingAction =
                aiFieldRecoveryPendingActions[field.fieldName];
              const isManualEditorOpen =
                aiFieldRecoveryEditors[field.fieldName] === true;
              const fieldError = aiFieldRecoveryErrors[field.fieldName];
              const fieldDraft = aiFieldRecoveryDrafts[field.fieldName];

              return (
                <div
                  key={field.fieldName}
                  data-record-detail-ai-recovery-field={field.fieldName}
                  className="min-w-0 rounded-[1.25rem] border border-stone-200 bg-white p-4"
                >
                  <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                    <div className="min-w-0">
                      <p className="text-xs uppercase tracking-[0.24em] text-stone-500">
                        {field.label}
                      </p>
                      <p className="mt-2 break-words text-sm leading-6 text-stone-700">
                        {field.currentValue.length > 0
                          ? field.currentValue
                          : "Nothing saved yet."}
                      </p>
                    </div>
                    <span className="max-w-full self-start whitespace-normal break-words rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-left text-[0.65rem] uppercase tracking-[0.2em] text-amber-700">
                      Needs input
                    </span>
                  </div>

                  <p className="mt-3 text-sm leading-6 text-stone-600">
                    {field.helperText}
                  </p>

                  <div className="mt-4 grid w-full min-w-0 gap-2 md:grid-cols-2">
                    <button
                      type="button"
                      data-ai-field-retry-action={field.fieldName}
                      disabled={pendingAction !== undefined}
                      onClick={() => {
                        void handleAiFieldRetry(field.fieldName);
                      }}
                      className={`${WORKSPACE_HOME_INLINE_ACTION_BUTTON_CLASS_NAME} border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 focus-visible:ring-amber-300/70 disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      <StableControlLabel
                        label={
                          pendingAction === "retry"
                            ? "Retrying..."
                            : "Try again"
                        }
                        widestLabel="Try again"
                      />
                    </button>
                    <button
                      type="button"
                      data-ai-field-manual-toggle={field.fieldName}
                      disabled={pendingAction !== undefined}
                      onClick={() => {
                        setAiFieldRecoveryEditors((currentEditors) => ({
                          ...currentEditors,
                          [field.fieldName]:
                            currentEditors[field.fieldName] !== true,
                        }));
                        setAiFieldRecoveryErrors((currentErrors) => ({
                          ...currentErrors,
                          [field.fieldName]: undefined,
                        }));
                      }}
                      className={`${WORKSPACE_HOME_INLINE_ACTION_BUTTON_CLASS_NAME} border border-stone-200 bg-white text-stone-700 hover:border-stone-300 focus-visible:ring-stone-300/60 disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      <StableControlLabel
                        label={
                          isManualEditorOpen
                            ? "Close editor"
                            : "Edit myself"
                        }
                        widestLabel="Close editor"
                      />
                    </button>
                  </div>

                  {fieldError ? (
                    <p
                      role="alert"
                      className="mt-3 text-sm leading-6 text-amber-700"
                    >
                      {fieldError}
                    </p>
                  ) : null}

                  {isManualEditorOpen ? (
                    <div
                      data-ai-field-manual-editor={field.fieldName}
                      className="mt-4 min-w-0 space-y-3 rounded-[1rem] border border-stone-200 bg-[#fcfaf6] p-3"
                    >
                      {field.fieldName === "summary" ? (
                        <textarea
                          value={fieldDraft}
                          rows={4}
                          onChange={(event) => {
                            const nextDraft = event.target.value;

                            setAiFieldRecoveryDrafts((currentDrafts) => ({
                              ...currentDrafts,
                              [field.fieldName]: nextDraft,
                            }));
                          }}
                          placeholder={field.inputPlaceholder}
                          className="min-h-28 w-full min-w-0 max-w-full resize-none rounded-[1rem] border border-stone-200 bg-white px-4 py-3 text-sm leading-6 text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-amber-300 focus:ring-2 focus:ring-amber-300/30"
                        />
                      ) : (
                        <input
                          value={fieldDraft}
                          onChange={(event) => {
                            const nextDraft = event.target.value;

                            setAiFieldRecoveryDrafts((currentDrafts) => ({
                              ...currentDrafts,
                              [field.fieldName]: nextDraft,
                            }));
                          }}
                          placeholder={field.inputPlaceholder}
                          className="w-full min-w-0 max-w-full rounded-[1rem] border border-stone-200 bg-white px-4 py-3 text-sm leading-6 text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-amber-300 focus:ring-2 focus:ring-amber-300/30"
                        />
                      )}

                      <button
                        type="button"
                        data-ai-field-manual-save={field.fieldName}
                        disabled={
                          pendingAction !== undefined ||
                          resolveWorkspaceHomeManualAiFieldValue(
                            field.fieldName,
                            fieldDraft,
                          ) === null
                        }
                        onClick={() => {
                          void handleManualAiFieldSave(field.fieldName);
                        }}
                        className={`${WORKSPACE_HOME_INLINE_ACTION_BUTTON_CLASS_NAME} bg-stone-950 text-white hover:bg-stone-800 focus-visible:ring-amber-300/70 disabled:cursor-not-allowed disabled:bg-stone-400`}
                      >
                        <StableControlLabel
                          label={
                            pendingAction === "save"
                              ? "Saving..."
                              : `Save ${field.label}`
                          }
                          widestLabel={`Save ${field.label}`}
                        />
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="rounded-[1.5rem] border border-stone-200 bg-[#fcfaf6] p-4">
        <p className="text-xs uppercase tracking-[0.24em] text-stone-500">
          Related notes
        </p>
        {selectedRecordDetail.sourceParent ? (
          <div className="mt-3 space-y-3">
            <p className="text-sm leading-6 text-stone-600">
              This note was expanded from an earlier one.
            </p>
            <button
              type="button"
              data-source-parent-id={selectedRecordDetail.sourceParent.id}
              onClick={() => {
                handleRecordDetailSelection(selectedRecordDetail.sourceParent!.id);
              }}
              className="w-full rounded-[1.25rem] border border-sky-200 bg-white px-4 py-3 text-left transition hover:border-sky-300 hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200/70"
            >
              <p className="text-xs uppercase tracking-[0.24em] text-sky-700">
                Open earlier note
              </p>
              <p className="mt-2 text-sm font-medium text-stone-950">
                {selectedRecordDetail.sourceParent.title}
              </p>
              {selectedRecordDetail.sourceParent.summary ? (
                <p className="mt-1 text-sm leading-6 text-stone-600">
                  {selectedRecordDetail.sourceParent.summary}
                </p>
              ) : null}
            </button>
          </div>
        ) : (
          <p className="mt-3 text-sm leading-6 text-stone-600">
            This is the starting note for this thread. Any expanded notes can
            link back here.
          </p>
        )}
      </div>
    </div>
  ) : (
    <p className="mt-5 text-sm leading-6 text-stone-600">
      Choose a saved note to see its details.
    </p>
  );
  const screenContent = (
    <div
      data-screen={model.screenId}
      data-layout="workspace-home-content"
      className={WORKSPACE_HOME_CONTENT_GRID_CLASS_NAME}
    >
      <div
        data-layout="capture-feed-stack"
        className="flex min-w-0 flex-col waka-primary-section-stack"
      >
        <section
          data-section="recent-records"
          className="waka-primary-section min-w-0 rounded-[2rem] border border-stone-200 bg-white shadow-[0_18px_50px_rgba(41,37,36,0.06)]"
        >
          <div className="flex min-w-0 flex-col items-start gap-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.3em] text-amber-700">
                Saved recently
              </p>
              <h2 className="mt-2 break-words text-2xl font-semibold text-stone-950">
                The last things you kept
              </h2>
            </div>
            <span className="inline-flex max-w-full rounded-full border border-stone-200 bg-[#fcfaf6] px-3 py-1 text-xs uppercase tracking-[0.18em] text-stone-500">
              Open a note only when you need detail
            </span>
          </div>

          {recentRecords.length > 0 ? (
            <ul
              className={WORKSPACE_HOME_RECENT_RECORDS_GRID_CLASS_NAME}
              data-cluster-content="seeded"
            >
              {recentRecords.map((item) => {
                const formattedSource = formatClusterItemSource(item.sourceType);
                const captureStatusBadges =
                  getWorkspaceHomeCaptureStatusBadges(item);
                const titleTransitionKey =
                  item.id === undefined
                    ? undefined
                    : createWorkspaceHomeAiFieldTransitionKey(item.id, "title");
                const summaryTransitionKey =
                  item.id === undefined
                    ? undefined
                    : createWorkspaceHomeAiFieldTransitionKey(
                        item.id,
                        "summary",
                      );
                const tagsTransitionKey =
                  item.id === undefined
                    ? undefined
                    : createWorkspaceHomeAiFieldTransitionKey(item.id, "tags");
                const isTitleFadingIn =
                  titleTransitionKey !== undefined &&
                  recentlyResolvedAiFieldKeys.has(titleTransitionKey);
                const isSummaryFadingIn =
                  summaryTransitionKey !== undefined &&
                  recentlyResolvedAiFieldKeys.has(summaryTransitionKey);
                const isTagsFadingIn =
                  tagsTransitionKey !== undefined &&
                  recentlyResolvedAiFieldKeys.has(tagsTransitionKey);
                const isSelectedRecord =
                  item.id !== undefined && item.id === selectedRecordId;
                const titleTerminalState = getWorkspaceHomeAiFieldTerminalState(
                  "title",
                  item.titleStatus,
                  item.title.length > 0,
                );
                const summaryTerminalState =
                  getWorkspaceHomeAiFieldTerminalState(
                    "summary",
                    item.summaryStatus,
                    typeof item.summary === "string" && item.summary.length > 0,
                  );
                const tagsTerminalState = getWorkspaceHomeAiFieldTerminalState(
                  "tags",
                  item.tagsStatus,
                  (item.tags ?? []).length > 0,
                );

                return (
                  <li
                    key={item.id ?? `${item.clusterName}-${item.title}`}
                    data-cluster-item-id={item.id}
                    data-cluster-item-sync-status={item.syncStatus}
                    data-selected-record-id={
                      isSelectedRecord ? item.id : undefined
                    }
                    className={`min-w-0 rounded-[1.5rem] border px-4 py-4 transition ${
                      isSelectedRecord
                        ? "border-amber-300 bg-amber-50 shadow-[0_0_0_1px_rgba(251,191,36,0.18)]"
                        : "border-stone-200 bg-[#fcfaf6]"
                    }`}
                  >
                    <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                      <p className="text-[0.7rem] uppercase tracking-[0.24em] text-stone-500">
                        {item.clusterName}
                      </p>
                      <div className="flex min-w-0 flex-wrap items-start justify-end gap-2">
                        {item.sourceParentId ? (
                          <span className="max-w-full whitespace-normal break-words rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-left text-[0.65rem] uppercase tracking-[0.2em] text-sky-700">
                            Follow-up
                          </span>
                        ) : null}
                        {captureStatusBadges.map((badge) => (
                          <span
                            key={`${item.id ?? item.title}-${badge.kind}`}
                            data-cluster-item-status-badge={badge.kind}
                            className={`max-w-full whitespace-normal break-words rounded-full border px-2.5 py-1 text-left text-[0.65rem] uppercase tracking-[0.2em] ${getWorkspaceHomeCaptureStatusBadgeClasses(
                              badge.kind,
                            )}`}
                          >
                            {badge.label}
                          </span>
                        ))}
                        {formattedSource ? (
                          <span className="max-w-full whitespace-normal break-words rounded-full border border-stone-200 bg-white px-2.5 py-1 text-left text-[0.65rem] uppercase tracking-[0.2em] text-stone-500">
                            {formattedSource}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-3 min-w-0">
                      {item.isTitlePending ? (
                        <div
                          aria-hidden="true"
                          data-cluster-item-ai-title="pending"
                          className="h-4 w-40 max-w-full animate-pulse rounded-full bg-stone-200"
                        />
                      ) : (
                        <h3
                          data-cluster-item-ai-title="resolved"
                          data-cluster-item-ai-title-transition={
                            isTitleFadingIn ? "fade-in" : "idle"
                          }
                          className={`min-w-0 break-words text-lg font-semibold text-stone-950 ${
                            isTitleFadingIn
                              ? WORKSPACE_HOME_AI_FIELD_FADE_IN_CLASS_NAME
                              : ""
                          }`}
                        >
                          {item.title}
                        </h3>
                      )}
                    </div>

                    {titleTerminalState ? (
                      <p
                        data-cluster-item-ai-title-terminal={
                          titleTerminalState.tone
                        }
                        className={`mt-3 flex max-w-full flex-wrap items-center gap-2 rounded-[1rem] border px-3 py-2 text-[0.7rem] leading-5 tracking-[0.16em] ${getWorkspaceHomeAiFieldTerminalClasses(
                          titleTerminalState.tone,
                        )}`}
                      >
                        <span className="font-semibold uppercase">
                          {titleTerminalState.badge}
                        </span>
                        <span className="min-w-0 break-words tracking-normal">
                          {titleTerminalState.message}
                        </span>
                      </p>
                    ) : null}

                    {item.isSummaryPending ? (
                      <div
                        aria-hidden="true"
                        data-cluster-item-ai-summary="pending"
                        className="mt-3 grid gap-2"
                      >
                        <div className="h-3 w-full animate-pulse rounded-full bg-stone-200" />
                        <div className="h-3 w-2/3 animate-pulse rounded-full bg-stone-200" />
                      </div>
                    ) : item.summary ? (
                      <p
                        data-cluster-item-ai-summary="resolved"
                        data-cluster-item-ai-summary-transition={
                          isSummaryFadingIn ? "fade-in" : "idle"
                        }
                        className={`mt-3 break-words text-sm leading-6 text-stone-600 ${
                          isSummaryFadingIn
                            ? WORKSPACE_HOME_AI_FIELD_FADE_IN_CLASS_NAME
                            : ""
                        }`}
                      >
                        {item.summary}
                      </p>
                    ) : item.rawContent ? (
                      <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-stone-600">
                        {item.rawContent}
                      </p>
                    ) : null}

                    {summaryTerminalState ? (
                      <p
                        data-cluster-item-ai-summary-terminal={
                          summaryTerminalState.tone
                        }
                        className={`mt-3 flex max-w-full flex-wrap items-center gap-2 rounded-[1rem] border px-3 py-2 text-[0.7rem] leading-5 tracking-[0.16em] ${getWorkspaceHomeAiFieldTerminalClasses(
                          summaryTerminalState.tone,
                        )}`}
                      >
                        <span className="font-semibold uppercase">
                          {summaryTerminalState.badge}
                        </span>
                        <span className="min-w-0 break-words tracking-normal">
                          {summaryTerminalState.message}
                        </span>
                      </p>
                    ) : null}

                    {item.isTagsPending ? (
                      <div
                        aria-hidden="true"
                        data-cluster-item-ai-tags="pending"
                        className="mt-3 flex flex-wrap gap-2"
                      >
                        <div className="h-6 w-20 animate-pulse rounded-full bg-stone-200" />
                        <div className="h-6 w-16 animate-pulse rounded-full bg-stone-200" />
                        <div className="h-6 w-24 animate-pulse rounded-full bg-stone-200" />
                      </div>
                    ) : (item.tags ?? []).length > 0 ? (
                      <ul
                        data-cluster-item-ai-tags="resolved"
                        data-cluster-item-ai-tags-transition={
                          isTagsFadingIn ? "fade-in" : "idle"
                        }
                        className={`mt-3 flex flex-wrap gap-2 ${
                          isTagsFadingIn
                            ? WORKSPACE_HOME_AI_FIELD_FADE_IN_CLASS_NAME
                            : ""
                        }`}
                      >
                        {(item.tags ?? []).map((tag) => (
                          <li
                            key={`${item.id ?? item.title}-${tag}`}
                            className="rounded-full border border-stone-200 bg-white px-3 py-1 text-[0.65rem] uppercase tracking-[0.18em] text-stone-500"
                          >
                            {tag}
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {tagsTerminalState ? (
                      <p
                        data-cluster-item-ai-tags-terminal={
                          tagsTerminalState.tone
                        }
                        className={`mt-3 flex max-w-full flex-wrap items-center gap-2 rounded-[1rem] border px-3 py-2 text-[0.7rem] leading-5 tracking-[0.16em] ${getWorkspaceHomeAiFieldTerminalClasses(
                          tagsTerminalState.tone,
                        )}`}
                      >
                        <span className="font-semibold uppercase">
                          {tagsTerminalState.badge}
                        </span>
                        <span className="min-w-0 break-words tracking-normal">
                          {tagsTerminalState.message}
                        </span>
                      </p>
                    ) : null}

                    {item.id ? (
                      <div className="mt-4">
                        <button
                          type="button"
                          data-record-detail-list-action={item.id}
                          onClick={() => {
                            handleRecordDetailSelection(item.id!);
                          }}
                          className={`${WORKSPACE_HOME_INLINE_ACTION_BUTTON_CLASS_NAME} border border-stone-200 bg-white text-stone-700 hover:border-amber-300 hover:bg-amber-50 focus-visible:ring-amber-300/70`}
                        >
                          <StableControlLabel
                            label={
                              isSelectedRecord ? "Viewing detail" : "Open detail"
                            }
                            widestLabel="Viewing detail"
                          />
                        </button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div
              data-cluster-feed-empty-state="true"
              className="mt-6 rounded-[1.5rem] border border-dashed border-stone-300 bg-[#fcfaf6] px-5 py-8"
            >
              <p className="text-sm font-medium text-stone-950">
                {WORKSPACE_HOME_CLUSTER_FEED_EMPTY_TITLE}
              </p>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-600">
                {WORKSPACE_HOME_CLUSTER_FEED_EMPTY_MESSAGE}
              </p>
            </div>
          )}
        </section>

        {selectedRecordDetail ? (
          <section
            data-section="record-detail"
            className="hidden min-[56rem]:block waka-primary-section min-w-0 rounded-[2rem] border border-stone-200 bg-white shadow-[0_18px_50px_rgba(41,37,36,0.06)]"
          >
            <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.3em] text-amber-700">
                  Selected note
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-stone-950">
                  Open only when you need the full detail
                </h2>
              </div>
              <button
                type="button"
                data-record-detail-dismiss="true"
                onClick={handleRecordDetailDismiss}
                className={`${WORKSPACE_HOME_INLINE_ACTION_BUTTON_CLASS_NAME} border border-stone-200 bg-white text-stone-700 hover:border-stone-300 focus-visible:ring-stone-300/60`}
              >
                Close note
              </button>
            </div>
            {recordDetailSectionContent}
          </section>
        ) : null}

        <section
          data-section="cluster-feed"
          className="waka-primary-section min-w-0 rounded-[2rem] border border-stone-200 bg-white shadow-[0_18px_50px_rgba(41,37,36,0.06)]"
        >
          <div className="flex min-w-0 flex-col items-start gap-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.3em] text-amber-700">
                Taking shape
              </p>
              <h2 className="mt-2 break-words text-2xl font-semibold text-stone-950">
                Themes building up
              </h2>
            </div>
            <span className="inline-flex max-w-full rounded-full border border-stone-200 bg-[#fcfaf6] px-3 py-1 text-xs uppercase tracking-[0.18em] text-stone-500">
              Groups stay quiet until they matter
            </span>
          </div>

          {clusterPreviews.length > 0 ? (
            <div className={WORKSPACE_HOME_CLUSTER_GRID_CLASS_NAME}>
              {clusterPreviews.map((cluster) => (
                <article
                  key={cluster.id ?? cluster.name}
                  data-cluster-id={cluster.id}
                  className="flex h-full min-w-0 flex-col rounded-[1.5rem] border border-stone-200 bg-[#fcfaf6] p-5"
                >
                  <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                    <div className="min-w-0 space-y-2">
                      <h3 className="break-words text-lg font-medium text-stone-950">
                        {cluster.name}
                      </h3>
                      <p className="break-words text-sm leading-6 text-stone-600">
                        {cluster.summary}
                      </p>
                    </div>
                    <span className="inline-flex max-w-full self-start whitespace-normal break-words rounded-full border border-amber-200 bg-white px-3 py-1 text-left text-xs text-amber-700">
                      {cluster.itemCount} notes
                    </span>
                  </div>

                  {(cluster.items ?? []).length > 0 ? (
                    <ul className="mt-5 grid min-w-0 gap-3">
                      {(cluster.items ?? []).slice(0, 3).map((item) => (
                        <li
                          key={item.id ?? `${cluster.name}-${item.title}`}
                          className="rounded-[1.1rem] border border-stone-200 bg-white px-4 py-3"
                        >
                          <p className="break-words text-sm font-medium text-stone-900">
                            {item.title}
                          </p>
                          <p className="mt-1 text-sm leading-6 text-stone-600">
                            {item.summary ?? item.rawContent ?? "Saved and waiting for more context."}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <div
              data-cluster-feed-empty-state="true"
              className="mt-6 rounded-[1.5rem] border border-dashed border-stone-300 bg-[#fcfaf6] px-5 py-8"
            >
              <p className="text-sm font-medium text-stone-950">
                {WORKSPACE_HOME_CLUSTER_FEED_EMPTY_TITLE}
              </p>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-600">
                {WORKSPACE_HOME_CLUSTER_FEED_EMPTY_MESSAGE}
              </p>
            </div>
          )}
        </section>
      </div>

      {isMobileRecordDetailDrawerVisible ? (
        <div className="fixed inset-0 z-30 min-[56rem]:hidden">
          <button
            type="button"
            aria-label="Close detail drawer"
            className="absolute inset-0 bg-stone-950/30 backdrop-blur-sm"
            onClick={handleMobileRecordDetailDrawerClose}
          />
          <div className="absolute inset-x-0 bottom-0 px-3 pb-3 pt-20">
            <section
              role="dialog"
              aria-label="Selected note details"
              aria-modal="false"
              data-record-detail-drawer="open"
              className="relative min-w-0 overflow-hidden rounded-[2rem] border border-stone-200 bg-white shadow-[0_24px_80px_rgba(41,37,36,0.18)]"
            >
              <div className="flex max-h-[min(82dvh,46rem)] min-w-0 flex-col">
                <div className="border-b border-stone-200 px-3 pb-4 pt-2 sm:px-4">
                  <button
                    type="button"
                    data-record-detail-drawer-handle="close"
                    aria-label="Collapse detail drawer"
                    onClick={handleMobileRecordDetailDrawerClose}
                    className={
                      WORKSPACE_HOME_MOBILE_RECORD_DRAWER_HANDLE_BUTTON_CLASS_NAME
                    }
                  >
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-16 rounded-full bg-stone-300"
                    />
                  </button>
                  <div
                    className={
                      WORKSPACE_HOME_MOBILE_RECORD_DRAWER_HEADER_CLASS_NAME
                    }
                  >
                    <div className="min-w-0">
                      <p className="text-xs uppercase tracking-[0.3em] text-amber-700">
                        Note details
                      </p>
                      <h2 className="mt-2 break-words text-xl font-semibold text-stone-950">
                        Selected note
                      </h2>
                    </div>
                    <button
                      type="button"
                      data-record-detail-drawer-close-action="true"
                      aria-label="Close selected note details"
                      onClick={handleMobileRecordDetailDrawerClose}
                      className={
                        WORKSPACE_HOME_MOBILE_RECORD_DRAWER_CLOSE_BUTTON_CLASS_NAME
                      }
                    >
                      Close
                    </button>
                  </div>
                </div>
                <div className="min-h-0 overflow-y-auto px-4 pb-4 md:px-6">
                  {recordDetailSectionContent}
                </div>
                <div className="border-t border-stone-200 p-4">
                  <button
                    type="button"
                    data-record-detail-drawer-footer-action="close"
                    onClick={handleMobileRecordDetailDrawerClose}
                    className={
                      WORKSPACE_HOME_MOBILE_RECORD_DRAWER_FOOTER_ACTION_BUTTON_CLASS_NAME
                    }
                  >
                      Close note
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>
      ) : null}

      <aside className={WORKSPACE_HOME_SECONDARY_PANEL_STACK_CLASS_NAME}>
        <section className="waka-primary-section min-w-0 rounded-[2rem] border border-stone-200 bg-white shadow-[0_18px_50px_rgba(41,37,36,0.06)]">
          <p className="text-xs uppercase tracking-[0.3em] text-amber-700">
            Recent changes
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-stone-950">
            What changed
          </h2>
          {model.discoveryPreviews.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-stone-300 bg-[#fcfaf6] px-4 py-4">
              <p className="text-sm font-medium text-stone-950">
                {WORKSPACE_HOME_DISCOVERIES_EMPTY_TITLE}
              </p>
              <p className="mt-2 text-sm leading-6 text-stone-600">
                {WORKSPACE_HOME_DISCOVERIES_EMPTY_MESSAGE}
              </p>
            </div>
          ) : (
            <ul className={WORKSPACE_HOME_DISCOVERY_GRID_CLASS_NAME}>
              {model.discoveryPreviews.map((item) => {
                const discoveryDate = formatWorkspaceHomeDiscoveryDate(
                  item.createdAt,
                );
                const discoveryExcerpt =
                  getWorkspaceHomeDiscoveryPreviewExcerpt(item);
                const discoverySource =
                  formatClusterItemSource(item.inspiration.sourceType) ??
                  item.inspiration.sourceType;

                return (
                  <li
                    key={item.id}
                    data-discovery-event-type={item.eventType}
                    className="h-full break-words rounded-2xl border border-stone-200 bg-[#fcfaf6] px-4 py-4"
                  >
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                      <p className="text-[0.7rem] font-medium uppercase tracking-[0.24em] text-amber-700">
                        Cluster reassigned
                      </p>
                      {discoveryDate === null ? null : (
                        <p className="text-xs uppercase tracking-[0.22em] text-stone-500">
                          {discoveryDate}
                        </p>
                      )}
                    </div>
                    <h3 className="mt-3 text-base font-semibold text-stone-950">
                      {getWorkspaceHomeDiscoveryPreviewTitle(item)}
                    </h3>
                    <p className="mt-3 text-sm leading-6 text-stone-700">
                      {formatWorkspaceHomeDiscoveryClusterMovement(item)}
                    </p>
                    {discoveryExcerpt === undefined ? null : (
                      <p className="mt-3 text-sm leading-6 text-stone-600">
                        {discoveryExcerpt}
                      </p>
                    )}
                    <p className="mt-4 text-xs uppercase tracking-[0.22em] text-stone-500">
                      {discoverySource}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );

  return screenContent;
}
