import { normalizeUrlDetectedCapture } from "../inspirations/url-detection.ts";
import {
  INSPIRATION_ENRICHMENT_FIELD_STATUS_FAILED,
  type InspirationEnrichmentFieldStatus,
} from "../inspirations/enrichment-field-metadata.ts";
import { CLUSTER_REASSIGNMENT_DISCOVERY_EVENT_TYPE } from "../discoveries/cluster-reassignment-persistence.ts";

export const WORKSPACE_HOME_SCREEN_ID = "workspace-home";
export const WORKSPACE_HOME_TITLE = "Pick up the idea before it slips away.";
export const WORKSPACE_HOME_DESCRIPTION =
  "Capture quickly now. Waka keeps the raw note safe first, then brings back context when you're ready to sort it out.";
export const WORKSPACE_HOME_CAPTURE_PLACEHOLDER =
  "Type the note, paste the link, or leave the fragment you want to keep.";
export const WORKSPACE_HOME_CAPTURE_MODES = [
  "Text",
  "URL",
  "Voice",
  "Photo",
  "AI chat",
] as const;
export const WORKSPACE_HOME_CAPTURE_PROMISES = [
  "Capture from notes, links, photos, voice, and pasted chats",
  "Drafts stay put while Waka finishes saving",
  "Waka adds titles, summaries, and tags in the background",
] as const;
export type WorkspaceHomeCaptureSaveState =
  | "saving"
  | "queued"
  | "saved"
  | "failed";
export type WorkspaceHomeCaptureSyncStatus = "pending-sync" | "synced";
export const WORKSPACE_HOME_OPTIMISTIC_CAPTURE_TITLE = "Saving note...";
export const WORKSPACE_HOME_CAPTURE_QUEUED_TITLE =
  "Will save when you're back online";
export const WORKSPACE_HOME_CAPTURE_RETRY_TITLE = "Could not save yet";

export interface WorkspaceHomeCaptureProcessingState {
  isTagsPending: boolean;
  isSummaryPending: boolean;
  isTitlePending: boolean;
  status?: string;
  tagsStatus?: InspirationEnrichmentFieldStatus;
  summaryStatus?: InspirationEnrichmentFieldStatus;
  titleStatus?: InspirationEnrichmentFieldStatus;
}

export interface WorkspaceHomeTextCaptureEnrichmentUpdate {
  cluster?: WorkspaceHomeClusterAssignment | null;
  id: string;
  processingState: WorkspaceHomeCaptureProcessingState;
  reflectionAnswer?: string;
  reflectionPrompt?: string;
  reflectionStatus?: WorkspaceHomeReflectionStatus;
  summary?: string;
  tags?: readonly string[];
  title?: string;
}

export interface WorkspaceHomeClusterAssignment {
  id: string;
  name: string;
  summary: string;
}

export type WorkspaceHomeRecoverableAiFieldName =
  | "summary"
  | "tags"
  | "title";

export type WorkspaceHomeManualAiFieldValue = string | readonly string[];

export const WORKSPACE_HOME_REFLECTION_STATUSES = [
  "PENDING",
  "PROMPTED",
  "ANSWERED",
  "SKIPPED",
  "NOT_NEEDED",
] as const;

export type WorkspaceHomeReflectionStatus =
  (typeof WORKSPACE_HOME_REFLECTION_STATUSES)[number];

export interface WorkspaceHomeClusterItemPreview {
  id?: string;
  isTagsPending?: boolean;
  isSummaryPending?: boolean;
  isTitlePending?: boolean;
  rawContent?: string;
  reflectionAnswer?: string;
  reflectionPrompt?: string;
  reflectionStatus?: WorkspaceHomeReflectionStatus;
  saveState?: WorkspaceHomeCaptureSaveState;
  syncStatus?: WorkspaceHomeCaptureSyncStatus;
  sourceType?: string;
  sourceParentId?: string;
  summary?: string;
  summaryStatus?: InspirationEnrichmentFieldStatus;
  tags?: readonly string[];
  tagsStatus?: InspirationEnrichmentFieldStatus;
  title: string;
  titleStatus?: InspirationEnrichmentFieldStatus;
}

export const WORKSPACE_HOME_CLUSTER_PREVIEWS = [
  {
    id: "signal-hunting",
    name: "Product hunches",
    summary: "Loose notes, follow-ups, and early instincts circling the same opportunity.",
    itemCount: 12,
    items: [
      {
        id: "insp-child-lineage",
        rawContent:
          "Follow-up note: when an idea grows, I still want to see the first note that started it.",
        reflectionPrompt:
          "What made this worth expanding?",
        reflectionStatus: "PROMPTED",
        sourceParentId: "insp-root-lineage",
        sourceType: "TEXT_NOTE",
        summary:
          "A follow-up note that keeps the path back to the original idea visible.",
        tags: ["follow-up", "history"],
        title: "Keep the first note in view",
      },
      {
        id: "insp-root-lineage",
        rawContent:
          "Original note: once I expand an idea, I should still be able to trace where it began.",
        sourceType: "TEXT_NOTE",
        summary:
          "The starting note for a thread that later grows into something bigger.",
        tags: ["origin", "thread"],
        title: "Show where the idea started",
      },
    ],
  },
  {
    id: "ambient-architecture",
    name: "Research threads",
    summary: "Links, quotes, and observations that are starting to point in the same direction.",
    itemCount: 8,
    items: [
      {
        id: "insp-queue-reliability",
        rawContent:
          "Voice memo: short customer quotes are easier to use when they stay next to the link or note that sparked them.",
        sourceType: "TEXT_NOTE",
        summary: "A reminder to keep research context attached to each note.",
        tags: ["research", "context"],
        title: "Keep quotes near the source",
      },
    ],
  },
  {
    id: "tiny-prompts",
    name: "Quick saves",
    summary: "Short thoughts worth keeping before you know what they mean yet.",
    itemCount: 5,
  },
] as const;
export const WORKSPACE_HOME_DISCOVERY_PREVIEWS = [
  {
    createdAt: "2026-04-11T05:30:00.000Z",
    eventType: CLUSTER_REASSIGNMENT_DISCOVERY_EVENT_TYPE,
    id: "discovery-preview-cross-surface",
    inspiration: {
      id: "insp-cli-voice",
      rawContent:
        "A pasted conversation about onboarding now sits next to voice notes from the same theme.",
      sourceType: "CLI_CONVERSATION",
      summary:
        "Waka regrouped a saved chat with related voice notes about onboarding.",
      title: "The onboarding notes finally landed together",
    },
    newCluster: {
      description:
        "Notes about first-run experience, setup friction, and early questions.",
      id: "cluster-cross-surface",
      label: "Onboarding patterns",
    },
    previousCluster: {
      description: "Loose saved chats still waiting for a clearer home.",
      id: "cluster-cli-fragments",
      label: "Saved chats",
    },
  },
  {
    createdAt: "2026-04-10T05:30:00.000Z",
    eventType: CLUSTER_REASSIGNMENT_DISCOVERY_EVENT_TYPE,
    id: "discovery-preview-reliability",
    inspiration: {
      id: "insp-url-reliability",
      rawContent:
        "A saved link about journaling now fits better with recent notes on personal workflows.",
      sourceType: "URL_IMPORT",
      summary:
        "A link moved into the same theme as newer notes about daily capture habits.",
      title: "The journaling link found its place",
    },
    newCluster: {
      description:
        "Notes about routines, personal systems, and daily capture habits.",
      id: "cluster-capture-reliability",
      label: "Daily capture habits",
    },
    previousCluster: {
      description: "Loose links and references kept for later reading.",
      id: "cluster-url-inbox",
      label: "Reading list",
    },
  },
] as const satisfies readonly WorkspaceHomeDiscoveryPreview[];
export const WORKSPACE_HOME_CLUSTER_FEED_EMPTY_TITLE = "Nothing saved yet";
export const WORKSPACE_HOME_CLUSTER_FEED_EMPTY_MESSAGE =
  "Save one thought and it will land here first. Waka will start grouping related notes once there is enough signal.";
export const WORKSPACE_HOME_CLUSTER_DEFAULT_SUMMARY =
  "Related notes grouped so they're easier to revisit.";
export const WORKSPACE_HOME_DISCOVERIES_EMPTY_TITLE =
  "No changes yet";
export const WORKSPACE_HOME_DISCOVERIES_EMPTY_MESSAGE =
  "When Waka moves a note into a clearer theme, you'll see that update here.";
export const WORKSPACE_HOME_UNCLUSTERED_CLUSTER_ID = "unclustered";
export const WORKSPACE_HOME_UNCLUSTERED_CLUSTER_NAME = "Recently saved";
export const WORKSPACE_HOME_UNCLUSTERED_CLUSTER_SUMMARY =
  "New notes appear here first while Waka sorts them into themes.";

export interface WorkspaceHomeClusterPreviewSeedItem {
  id?: string | null;
  rawContent?: string | null;
  reflectionAnswer?: string | null;
  reflectionPrompt?: string | null;
  reflectionStatus?: WorkspaceHomeReflectionStatus | null;
  sourceType?: string | null;
  sourceParentId?: string | null;
  summary?: string | null;
  tags?: readonly string[] | null;
  title?: string | null;
}

export interface WorkspaceHomeClusterPreview {
  id?: string;
  itemCount: number;
  items?: readonly WorkspaceHomeClusterItemPreview[];
  name: string;
  summary: string;
}

export interface WorkspaceHomeDiscoveryClusterPreview {
  description?: string;
  id: string;
  label?: string;
}

export interface WorkspaceHomeDiscoveryInspirationPreview {
  id: string;
  rawContent: string;
  sourceType: string;
  summary?: string;
  title?: string;
}

export interface WorkspaceHomeDiscoveryPreview {
  createdAt: string;
  eventType: typeof CLUSTER_REASSIGNMENT_DISCOVERY_EVENT_TYPE;
  id: string;
  inspiration: WorkspaceHomeDiscoveryInspirationPreview;
  newCluster: WorkspaceHomeDiscoveryClusterPreview;
  previousCluster: WorkspaceHomeDiscoveryClusterPreview;
}

export interface WorkspaceHomeClusterPreviewSeed {
  count?: number | null;
  description?: string | null;
  id?: string | null;
  inspirations?: readonly WorkspaceHomeClusterPreviewSeedItem[] | null;
  itemCount?: number | null;
  items?: readonly WorkspaceHomeClusterPreviewSeedItem[] | null;
  label?: string | null;
  name?: string | null;
  summary?: string | null;
}

export interface WorkspaceHomeDiscoveryClusterPreviewSeed {
  description?: string | null;
  id?: string | null;
  label?: string | null;
}

export interface WorkspaceHomeDiscoveryInspirationPreviewSeed {
  id?: string | null;
  rawContent?: string | null;
  sourceType?: string | null;
  summary?: string | null;
  title?: string | null;
}

export interface WorkspaceHomeDiscoveryPreviewSeed {
  createdAt?: string | null;
  eventType?: string | null;
  id?: string | null;
  inspiration?: WorkspaceHomeDiscoveryInspirationPreviewSeed | null;
  newCluster?: WorkspaceHomeDiscoveryClusterPreviewSeed | null;
  previousCluster?: WorkspaceHomeDiscoveryClusterPreviewSeed | null;
}

export interface GetWorkspaceHomeScreenModelOptions {
  initialClusterData?: readonly WorkspaceHomeClusterPreviewSeed[];
  initialClusterFeed?: readonly WorkspaceHomeClusterPreviewSeed[];
  initialClusterPreviews?: readonly WorkspaceHomeClusterPreviewSeed[];
  initialDiscoveries?: readonly WorkspaceHomeDiscoveryPreviewSeed[];
  initialDiscoveryFeed?: readonly WorkspaceHomeDiscoveryPreviewSeed[];
  initialDiscoveryPreviews?: readonly WorkspaceHomeDiscoveryPreviewSeed[];
}

export interface WorkspaceHomeScreenModel {
  captureModes: readonly string[];
  capturePlaceholder: string;
  capturePromises: readonly string[];
  clusterPreviews: readonly WorkspaceHomeClusterPreview[];
  description: string;
  discoveryPreviews: readonly WorkspaceHomeDiscoveryPreview[];
  screenId: string;
  title: string;
}

export interface WorkspaceHomeSourceParentPreview {
  id: string;
  summary?: string;
  title: string;
}

export interface WorkspaceHomeRecordDetail {
  id: string;
  isSummaryPending?: boolean;
  isTagsPending?: boolean;
  isTitlePending?: boolean;
  rawContent?: string;
  reflectionAnswer?: string;
  reflectionPrompt?: string;
  reflectionStatus?: WorkspaceHomeReflectionStatus;
  saveState?: WorkspaceHomeCaptureSaveState;
  syncStatus?: WorkspaceHomeCaptureSyncStatus;
  sourceParent?: WorkspaceHomeSourceParentPreview;
  sourceType?: string;
  summary?: string;
  summaryStatus?: InspirationEnrichmentFieldStatus;
  tags?: readonly string[];
  tagsStatus?: InspirationEnrichmentFieldStatus;
  title: string;
  titleStatus?: InspirationEnrichmentFieldStatus;
}

export function shouldRenderWorkspaceHomeInlineReflection(
  selectedRecordDetail?: Pick<
    WorkspaceHomeRecordDetail,
    | "reflectionAnswer"
    | "reflectionPrompt"
    | "reflectionStatus"
    | "saveState"
  >,
): boolean {
  if (selectedRecordDetail === undefined) {
    return false;
  }

  if (
    selectedRecordDetail.saveState !== undefined &&
    selectedRecordDetail.saveState !== "saved"
  ) {
    return false;
  }

  const hasPrompt =
    typeof selectedRecordDetail.reflectionPrompt === "string" &&
    selectedRecordDetail.reflectionPrompt.length > 0;
  const hasAnswer =
    typeof selectedRecordDetail.reflectionAnswer === "string" &&
    selectedRecordDetail.reflectionAnswer.length > 0;

  return (
    (selectedRecordDetail.reflectionStatus === "PROMPTED" && hasPrompt) ||
    (selectedRecordDetail.reflectionStatus === "ANSWERED" &&
      (hasPrompt || hasAnswer))
  );
}

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalizedValue = value.trim();

  return normalizedValue.length > 0 ? normalizedValue : undefined;
}

function readNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function readOptionalStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalizedValues = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return normalizedValues.length > 0 ? normalizedValues : undefined;
}

function readWorkspaceHomeReflectionStatus(
  value: unknown,
): WorkspaceHomeReflectionStatus | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  return WORKSPACE_HOME_REFLECTION_STATUSES.find(
    (status) => status === value,
  );
}

function createPreviewKey(prefix: string, index: number): string {
  const normalizedPrefix = prefix
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${normalizedPrefix || "cluster"}-${index + 1}`;
}

function isUnclusteredCluster(
  cluster: WorkspaceHomeClusterPreview,
): boolean {
  return (
    cluster.id === WORKSPACE_HOME_UNCLUSTERED_CLUSTER_ID ||
    cluster.name === WORKSPACE_HOME_UNCLUSTERED_CLUSTER_NAME
  );
}

function mapWorkspaceHomeClusterItems(
  clusterPreviews: readonly WorkspaceHomeClusterPreview[],
  itemId: string,
  transform: (
    item: WorkspaceHomeClusterItemPreview,
  ) => WorkspaceHomeClusterItemPreview,
): readonly WorkspaceHomeClusterPreview[] {
  return clusterPreviews.map((cluster) => {
    if ((cluster.items ?? []).length === 0) {
      return cluster;
    }

    let itemUpdated = false;
    const nextItems = (cluster.items ?? []).map((item) => {
      if (item.id !== itemId) {
        return item;
      }

      itemUpdated = true;

      return transform(item);
    });

    if (!itemUpdated) {
      return cluster;
    }

    return {
      ...cluster,
      items: nextItems,
    };
  });
}

function normalizeClusterPreviewItem(
  item: WorkspaceHomeClusterPreviewSeedItem,
  clusterName: string,
  itemIndex: number,
): WorkspaceHomeClusterItemPreview | null {
  const title =
    readTrimmedString(item.title) ??
    readTrimmedString(item.summary) ??
    readTrimmedString(item.rawContent);
  const rawContent = readTrimmedString(item.rawContent);
  const reflectionAnswer = readTrimmedString(item.reflectionAnswer);
  const reflectionPrompt = readTrimmedString(item.reflectionPrompt);
  const reflectionStatus = readWorkspaceHomeReflectionStatus(
    item.reflectionStatus,
  );
  const summary = readTrimmedString(item.summary);
  const sourceType = readTrimmedString(item.sourceType);
  const sourceParentId = readTrimmedString(item.sourceParentId);
  const tags = readOptionalStringArray(item.tags);

  if (title === undefined && rawContent === undefined && summary === undefined) {
    return null;
  }

  return {
    id: readTrimmedString(item.id) ?? createPreviewKey(clusterName, itemIndex),
    title: title ?? rawContent ?? summary ?? "Untitled note",
    ...(rawContent === undefined ? {} : { rawContent }),
    ...(reflectionAnswer === undefined ? {} : { reflectionAnswer }),
    ...(reflectionPrompt === undefined ? {} : { reflectionPrompt }),
    ...(reflectionStatus === undefined ? {} : { reflectionStatus }),
    ...(summary === undefined ? {} : { summary }),
    ...(sourceType === undefined ? {} : { sourceType }),
    ...(sourceParentId === undefined ? {} : { sourceParentId }),
    ...(tags === undefined ? {} : { tags }),
  };
}

function findWorkspaceHomeClusterItemById(
  clusterPreviews: readonly WorkspaceHomeClusterPreview[],
  itemId: string,
): WorkspaceHomeClusterItemPreview | undefined {
  for (const cluster of clusterPreviews) {
    const matchedItem = (cluster.items ?? []).find(
      (item) => item.id === itemId,
    );

    if (matchedItem !== undefined) {
      return matchedItem;
    }
  }

  return undefined;
}

function normalizeClusterPreview(
  cluster: WorkspaceHomeClusterPreviewSeed,
  clusterIndex: number,
): WorkspaceHomeClusterPreview | null {
  const name = readTrimmedString(cluster.name) ?? readTrimmedString(cluster.label);

  if (name === undefined) {
    return null;
  }

  const itemsSource = Array.isArray(cluster.inspirations)
    ? cluster.inspirations
    : Array.isArray(cluster.items)
      ? cluster.items
      : [];
  const items = itemsSource
    .map((item, itemIndex) => normalizeClusterPreviewItem(item, name, itemIndex))
    .filter(
      (item): item is WorkspaceHomeClusterItemPreview => item !== null,
    );
  const itemCount =
    readNonNegativeInteger(cluster.itemCount) ??
    readNonNegativeInteger(cluster.count) ??
    items.length;

  return {
    id: readTrimmedString(cluster.id) ?? createPreviewKey(name, clusterIndex),
    itemCount,
    items,
    name,
    summary:
      readTrimmedString(cluster.summary) ??
      readTrimmedString(cluster.description) ??
      WORKSPACE_HOME_CLUSTER_DEFAULT_SUMMARY,
  };
}

function resolveInitialClusterPreviews(
  options: GetWorkspaceHomeScreenModelOptions,
): readonly WorkspaceHomeClusterPreview[] | undefined {
  const seededClusterPreviews =
    options.initialClusterData ??
    options.initialClusterFeed ??
    options.initialClusterPreviews;

  if (seededClusterPreviews === undefined) {
    return undefined;
  }

  if (!Array.isArray(seededClusterPreviews)) {
    return undefined;
  }

  const normalizedClusterPreviews = seededClusterPreviews
    .map((cluster, clusterIndex) => normalizeClusterPreview(cluster, clusterIndex))
    .filter(
      (cluster): cluster is WorkspaceHomeClusterPreview => cluster !== null,
    );

  return normalizedClusterPreviews;
}

function normalizeDiscoveryClusterPreview(
  cluster: WorkspaceHomeDiscoveryClusterPreviewSeed | null | undefined,
): WorkspaceHomeDiscoveryClusterPreview | null {
  const id = readTrimmedString(cluster?.id);

  if (id === undefined) {
    return null;
  }

  const description = readTrimmedString(cluster?.description);
  const label = readTrimmedString(cluster?.label);

  return {
    id,
    ...(description === undefined ? {} : { description }),
    ...(label === undefined ? {} : { label }),
  };
}

function normalizeDiscoveryInspirationPreview(
  inspiration: WorkspaceHomeDiscoveryInspirationPreviewSeed | null | undefined,
): WorkspaceHomeDiscoveryInspirationPreview | null {
  const id = readTrimmedString(inspiration?.id);
  const rawContent = readTrimmedString(inspiration?.rawContent);
  const sourceType = readTrimmedString(inspiration?.sourceType);

  if (id === undefined || rawContent === undefined || sourceType === undefined) {
    return null;
  }

  const summary = readTrimmedString(inspiration?.summary);
  const title = readTrimmedString(inspiration?.title);

  return {
    id,
    rawContent,
    sourceType,
    ...(summary === undefined ? {} : { summary }),
    ...(title === undefined ? {} : { title }),
  };
}

function normalizeDiscoveryPreview(
  discovery: WorkspaceHomeDiscoveryPreviewSeed,
  discoveryIndex: number,
): WorkspaceHomeDiscoveryPreview | null {
  const inspiration = normalizeDiscoveryInspirationPreview(discovery.inspiration);
  const previousCluster = normalizeDiscoveryClusterPreview(
    discovery.previousCluster,
  );
  const newCluster = normalizeDiscoveryClusterPreview(discovery.newCluster);

  if (
    inspiration === null ||
    previousCluster === null ||
    newCluster === null
  ) {
    return null;
  }

  return {
    createdAt: readTrimmedString(discovery.createdAt) ?? "",
    eventType:
      discovery.eventType === CLUSTER_REASSIGNMENT_DISCOVERY_EVENT_TYPE
        ? discovery.eventType
        : CLUSTER_REASSIGNMENT_DISCOVERY_EVENT_TYPE,
    id:
      readTrimmedString(discovery.id) ??
      createPreviewKey("discovery", discoveryIndex),
    inspiration,
    newCluster,
    previousCluster,
  };
}

function resolveInitialDiscoveryPreviews(
  options: GetWorkspaceHomeScreenModelOptions,
): readonly WorkspaceHomeDiscoveryPreview[] | undefined {
  const seededDiscoveryPreviews =
    options.initialDiscoveries ??
    options.initialDiscoveryFeed ??
    options.initialDiscoveryPreviews;

  if (seededDiscoveryPreviews === undefined) {
    return undefined;
  }

  if (!Array.isArray(seededDiscoveryPreviews)) {
    return undefined;
  }

  const normalizedDiscoveryPreviews = seededDiscoveryPreviews
    .map((discovery, discoveryIndex) =>
      normalizeDiscoveryPreview(discovery, discoveryIndex),
    )
    .filter(
      (discovery): discovery is WorkspaceHomeDiscoveryPreview =>
        discovery !== null,
    );

  return normalizedDiscoveryPreviews;
}

export function getWorkspaceHomeDiscoveryClusterLabel(
  cluster: Pick<WorkspaceHomeDiscoveryClusterPreview, "id" | "label">,
): string {
  return readTrimmedString(cluster.label) ?? cluster.id;
}

export function getWorkspaceHomeDiscoveryPreviewTitle(
  discovery: Pick<WorkspaceHomeDiscoveryPreview, "inspiration">,
): string {
  return (
    readTrimmedString(discovery.inspiration.title) ??
    readTrimmedString(discovery.inspiration.summary) ??
    discovery.inspiration.rawContent
  );
}

export function getWorkspaceHomeDiscoveryPreviewExcerpt(
  discovery: Pick<WorkspaceHomeDiscoveryPreview, "inspiration">,
): string | undefined {
  const title = readTrimmedString(discovery.inspiration.title);
  const summary = readTrimmedString(discovery.inspiration.summary);
  const rawContent = readTrimmedString(discovery.inspiration.rawContent);

  if (summary !== undefined && summary !== title) {
    return summary;
  }

  if (rawContent !== undefined && rawContent !== title) {
    return rawContent;
  }

  return undefined;
}

export function formatWorkspaceHomeDiscoveryClusterMovement(
  discovery: Pick<
    WorkspaceHomeDiscoveryPreview,
    "newCluster" | "previousCluster"
  >,
): string {
  return `Now grouped with ${getWorkspaceHomeDiscoveryClusterLabel(discovery.newCluster)} instead of ${getWorkspaceHomeDiscoveryClusterLabel(discovery.previousCluster)}.`;
}

export function getWorkspaceHomeScreenModel(
  options: GetWorkspaceHomeScreenModelOptions = {},
): WorkspaceHomeScreenModel {
  return {
    captureModes: WORKSPACE_HOME_CAPTURE_MODES,
    capturePlaceholder: WORKSPACE_HOME_CAPTURE_PLACEHOLDER,
    capturePromises: WORKSPACE_HOME_CAPTURE_PROMISES,
    clusterPreviews:
      resolveInitialClusterPreviews(options) ?? WORKSPACE_HOME_CLUSTER_PREVIEWS,
    description: WORKSPACE_HOME_DESCRIPTION,
    discoveryPreviews:
      resolveInitialDiscoveryPreviews(options) ?? WORKSPACE_HOME_DISCOVERY_PREVIEWS,
    screenId: WORKSPACE_HOME_SCREEN_ID,
    title: WORKSPACE_HOME_TITLE,
  };
}

export function getWorkspaceHomeInitialSelectedRecordId(
  clusterPreviews: readonly WorkspaceHomeClusterPreview[],
): string | undefined {
  let firstAvailableRecordId: string | undefined;

  for (const cluster of clusterPreviews) {
    for (const item of cluster.items ?? []) {
      if (item.id === undefined) {
        continue;
      }

      if (firstAvailableRecordId === undefined) {
        firstAvailableRecordId = item.id;
      }

      if (item.sourceParentId !== undefined) {
        return item.id;
      }
    }
  }

  return firstAvailableRecordId;
}

export function getWorkspaceHomeRecordDetail(
  clusterPreviews: readonly WorkspaceHomeClusterPreview[],
  selectedRecordId?: string,
): WorkspaceHomeRecordDetail | undefined {
  if (selectedRecordId === undefined) {
    return undefined;
  }

  const selectedItem = findWorkspaceHomeClusterItemById(
    clusterPreviews,
    selectedRecordId,
  );

  if (selectedItem === undefined || selectedItem.id === undefined) {
    return undefined;
  }

  const sourceParentItem =
    selectedItem.sourceParentId === undefined
      ? undefined
      : findWorkspaceHomeClusterItemById(
          clusterPreviews,
          selectedItem.sourceParentId,
        );
  const sourceParent =
    selectedItem.sourceParentId === undefined
      ? undefined
      : {
          id: selectedItem.sourceParentId,
          title:
            sourceParentItem?.title ??
            sourceParentItem?.summary ??
            sourceParentItem?.rawContent ??
            "Earlier note",
          ...(sourceParentItem?.summary === undefined
            ? {}
            : { summary: sourceParentItem.summary }),
        };

  return {
    id: selectedItem.id,
    ...(selectedItem.isSummaryPending === undefined
      ? {}
      : { isSummaryPending: selectedItem.isSummaryPending }),
    ...(selectedItem.isTagsPending === undefined
      ? {}
      : { isTagsPending: selectedItem.isTagsPending }),
    ...(selectedItem.isTitlePending === undefined
      ? {}
      : { isTitlePending: selectedItem.isTitlePending }),
    title: selectedItem.title,
    ...(selectedItem.rawContent === undefined
      ? {}
      : { rawContent: selectedItem.rawContent }),
    ...(selectedItem.reflectionAnswer === undefined
      ? {}
      : { reflectionAnswer: selectedItem.reflectionAnswer }),
    ...(selectedItem.reflectionPrompt === undefined
      ? {}
      : { reflectionPrompt: selectedItem.reflectionPrompt }),
    ...(selectedItem.reflectionStatus === undefined
      ? {}
      : { reflectionStatus: selectedItem.reflectionStatus }),
    ...(selectedItem.saveState === undefined
      ? {}
      : { saveState: selectedItem.saveState }),
    ...(selectedItem.syncStatus === undefined
      ? {}
      : { syncStatus: selectedItem.syncStatus }),
    ...(selectedItem.sourceType === undefined
      ? {}
      : { sourceType: selectedItem.sourceType }),
    ...(selectedItem.summary === undefined
      ? {}
      : { summary: selectedItem.summary }),
    ...(selectedItem.summaryStatus === undefined
      ? {}
      : { summaryStatus: selectedItem.summaryStatus }),
    ...(selectedItem.tags === undefined ? {} : { tags: selectedItem.tags }),
    ...(selectedItem.tagsStatus === undefined
      ? {}
      : { tagsStatus: selectedItem.tagsStatus }),
    ...(selectedItem.titleStatus === undefined
      ? {}
      : { titleStatus: selectedItem.titleStatus }),
    ...(sourceParent === undefined ? {} : { sourceParent }),
  };
}

export function createWorkspaceHomeOptimisticTextCapture(
  rawContent: string,
  id: string,
): WorkspaceHomeClusterItemPreview {
  const normalizedCapture = normalizeUrlDetectedCapture({
    rawContent,
    sourceType: "TEXT_NOTE",
  });

  return {
    id,
    isTagsPending: true,
    isSummaryPending: true,
    isTitlePending: true,
    rawContent: normalizedCapture.rawContent,
    saveState: "saving",
    sourceType: normalizedCapture.sourceType,
    title: WORKSPACE_HOME_OPTIMISTIC_CAPTURE_TITLE,
  };
}

export function prependWorkspaceHomeOptimisticCapture(
  clusterPreviews: readonly WorkspaceHomeClusterPreview[],
  optimisticCapture: WorkspaceHomeClusterItemPreview,
): readonly WorkspaceHomeClusterPreview[] {
  const existingUnclusteredCluster = clusterPreviews.find(isUnclusteredCluster);
  const remainingClusters = clusterPreviews.filter(
    (cluster) => !isUnclusteredCluster(cluster),
  );
  const nextUnclusteredItems = [
    optimisticCapture,
    ...(existingUnclusteredCluster?.items ?? []),
  ];

  return [
    {
      id:
        existingUnclusteredCluster?.id ??
        WORKSPACE_HOME_UNCLUSTERED_CLUSTER_ID,
      itemCount:
        existingUnclusteredCluster?.itemCount !== undefined
          ? existingUnclusteredCluster.itemCount + 1
          : nextUnclusteredItems.length,
      items: nextUnclusteredItems,
      name:
        existingUnclusteredCluster?.name ??
        WORKSPACE_HOME_UNCLUSTERED_CLUSTER_NAME,
      summary:
        existingUnclusteredCluster?.summary ??
        WORKSPACE_HOME_UNCLUSTERED_CLUSTER_SUMMARY,
    },
    ...remainingClusters,
  ];
}

export function markWorkspaceHomeOptimisticCaptureSaved(
  clusterPreviews: readonly WorkspaceHomeClusterPreview[],
  optimisticCaptureId: string,
  persistedCaptureId: string,
  processingState: WorkspaceHomeCaptureProcessingState,
): readonly WorkspaceHomeClusterPreview[] {
  return mapWorkspaceHomeClusterItems(
    clusterPreviews,
    optimisticCaptureId,
    (item) => ({
      ...item,
      id: persistedCaptureId,
      isTagsPending: processingState.isTagsPending,
      isSummaryPending: processingState.isSummaryPending,
      isTitlePending: processingState.isTitlePending,
      reflectionStatus: "PENDING",
      saveState: "saved",
      syncStatus: "synced",
      ...(processingState.summaryStatus === undefined
        ? {}
        : { summaryStatus: processingState.summaryStatus }),
      ...(processingState.tagsStatus === undefined
        ? {}
        : { tagsStatus: processingState.tagsStatus }),
      ...(processingState.titleStatus === undefined
        ? {}
        : { titleStatus: processingState.titleStatus }),
    }),
  );
}

function resolveWorkspaceHomeQueuedCaptureTitle(
  item: WorkspaceHomeClusterItemPreview,
): string {
  return (
    readTrimmedString(item.rawContent) ??
    readTrimmedString(item.title) ??
    WORKSPACE_HOME_CAPTURE_QUEUED_TITLE
  );
}

export function markWorkspaceHomeOptimisticCaptureQueued(
  clusterPreviews: readonly WorkspaceHomeClusterPreview[],
  optimisticCaptureId: string,
  queuedCaptureId: string,
): readonly WorkspaceHomeClusterPreview[] {
  return mapWorkspaceHomeClusterItems(
    clusterPreviews,
    optimisticCaptureId,
    (item) => ({
      ...item,
      id: queuedCaptureId,
      isTagsPending: false,
      isSummaryPending: false,
      isTitlePending: false,
      saveState: "queued",
      syncStatus: "pending-sync",
      title: resolveWorkspaceHomeQueuedCaptureTitle(item),
    }),
  );
}

export function markWorkspaceHomeOptimisticCaptureFailed(
  clusterPreviews: readonly WorkspaceHomeClusterPreview[],
  optimisticCaptureId: string,
): readonly WorkspaceHomeClusterPreview[] {
  return mapWorkspaceHomeClusterItems(
    clusterPreviews,
    optimisticCaptureId,
    (item) => ({
      ...item,
      isTagsPending: false,
      isSummaryPending: false,
      isTitlePending: false,
      saveState: "failed",
      title: WORKSPACE_HOME_CAPTURE_RETRY_TITLE,
    }),
  );
}

function shouldKeepWorkspaceHomeAiFieldPending<TValue>(
  itemIsPending: boolean | undefined,
  nextFieldStatus: InspirationEnrichmentFieldStatus | undefined,
  nextValue: TValue | undefined,
): boolean {
  return (
    itemIsPending === true &&
    nextValue === undefined &&
    nextFieldStatus !== INSPIRATION_ENRICHMENT_FIELD_STATUS_FAILED
  );
}

function resolveWorkspaceHomeFailedTitleFallback(
  item: WorkspaceHomeClusterItemPreview,
  update: WorkspaceHomeTextCaptureEnrichmentUpdate,
): string | undefined {
  if (
    item.isTitlePending !== true ||
    update.title !== undefined ||
    update.processingState.titleStatus !== INSPIRATION_ENRICHMENT_FIELD_STATUS_FAILED
  ) {
    return undefined;
  }

  if (typeof item.rawContent === "string" && item.rawContent.length > 0) {
    return item.rawContent;
  }

  if (
    typeof item.title === "string" &&
    item.title.length > 0 &&
    item.title !== WORKSPACE_HOME_OPTIMISTIC_CAPTURE_TITLE
  ) {
    return item.title;
  }

  return undefined;
}

function resolveWorkspaceHomeTextCaptureEnrichmentItem(
  item: WorkspaceHomeClusterItemPreview,
  update: WorkspaceHomeTextCaptureEnrichmentUpdate,
): WorkspaceHomeClusterItemPreview {
  return {
    ...item,
    isTagsPending: shouldKeepWorkspaceHomeAiFieldPending(
      item.isTagsPending,
      update.processingState.tagsStatus,
      update.tags,
    ),
    isSummaryPending: shouldKeepWorkspaceHomeAiFieldPending(
      item.isSummaryPending,
      update.processingState.summaryStatus,
      update.summary,
    ),
    isTitlePending: shouldKeepWorkspaceHomeAiFieldPending(
      item.isTitlePending,
      update.processingState.titleStatus,
      update.title,
    ),
    ...(update.summary === undefined ? {} : { summary: update.summary }),
    ...(update.processingState.summaryStatus === undefined
      ? {}
      : { summaryStatus: update.processingState.summaryStatus }),
    ...(update.tags === undefined ? {} : { tags: [...update.tags] }),
    ...(update.processingState.tagsStatus === undefined
      ? {}
      : { tagsStatus: update.processingState.tagsStatus }),
    ...(update.title === undefined ? {} : { title: update.title }),
    ...(update.processingState.titleStatus === undefined
      ? {}
      : { titleStatus: update.processingState.titleStatus }),
    ...(update.reflectionAnswer === undefined
      ? {}
      : { reflectionAnswer: update.reflectionAnswer }),
    ...(update.reflectionPrompt === undefined
      ? {}
      : { reflectionPrompt: update.reflectionPrompt }),
    ...(update.reflectionStatus === undefined
      ? {}
      : { reflectionStatus: update.reflectionStatus }),
    ...(update.title === undefined
      ? (() => {
          const fallbackTitle = resolveWorkspaceHomeFailedTitleFallback(
            item,
            update,
          );

          return fallbackTitle === undefined ? {} : { title: fallbackTitle };
        })()
      : {}),
  };
}

function createWorkspaceHomeClusterPreviewFromAssignment(
  cluster: WorkspaceHomeClusterAssignment,
  item: WorkspaceHomeClusterItemPreview,
): WorkspaceHomeClusterPreview {
  return {
    id: cluster.id,
    itemCount: 1,
    items: [item],
    name: cluster.name,
    summary: cluster.summary,
  };
}

function moveWorkspaceHomeClusterItem(
  clusterPreviews: readonly WorkspaceHomeClusterPreview[],
  itemId: string,
  item: WorkspaceHomeClusterItemPreview,
  cluster: WorkspaceHomeClusterAssignment | null,
): readonly WorkspaceHomeClusterPreview[] {
  let targetCluster: WorkspaceHomeClusterPreview | undefined;
  const remainingClusters: WorkspaceHomeClusterPreview[] = [];

  for (const currentCluster of clusterPreviews) {
    const currentItems = currentCluster.items ?? [];
    const nextItems = currentItems.filter((entry) => entry.id !== itemId);
    const itemWasRemoved = nextItems.length !== currentItems.length;
    const normalizedCluster =
      itemWasRemoved === false
        ? currentCluster
        : nextItems.length === 0
          ? null
          : {
              ...currentCluster,
              itemCount: nextItems.length,
              items: nextItems,
            };

    if (cluster !== null && currentCluster.id === cluster.id) {
      targetCluster =
        normalizedCluster ?? {
          ...currentCluster,
          itemCount: 0,
          items: [],
        };
      continue;
    }

    if (normalizedCluster !== null) {
      remainingClusters.push(normalizedCluster);
    }
  }

  if (cluster === null) {
    return prependWorkspaceHomeOptimisticCapture(remainingClusters, item);
  }

  const nextTargetItems = [item, ...(targetCluster?.items ?? [])];
  const nextTargetCluster =
    targetCluster === undefined
      ? createWorkspaceHomeClusterPreviewFromAssignment(cluster, item)
      : {
          ...targetCluster,
          id: cluster.id,
          itemCount: nextTargetItems.length,
          items: nextTargetItems,
          name: cluster.name,
          summary: cluster.summary,
        };
  const unclusteredCluster = remainingClusters.find(isUnclusteredCluster);
  const clusteredRemainder = remainingClusters.filter(
    (currentCluster) => !isUnclusteredCluster(currentCluster),
  );

  return [
    ...(unclusteredCluster === undefined ? [] : [unclusteredCluster]),
    nextTargetCluster,
    ...clusteredRemainder.filter(
      (currentCluster) => currentCluster.id !== cluster.id,
    ),
  ];
}

export function applyWorkspaceHomeTextCaptureEnrichmentUpdate(
  clusterPreviews: readonly WorkspaceHomeClusterPreview[],
  update: WorkspaceHomeTextCaptureEnrichmentUpdate,
): readonly WorkspaceHomeClusterPreview[] {
  const currentItem = findWorkspaceHomeClusterItemById(
    clusterPreviews,
    update.id,
  );

  if (currentItem === undefined) {
    return clusterPreviews;
  }

  const nextItem = resolveWorkspaceHomeTextCaptureEnrichmentItem(
    currentItem,
    update,
  );

  if (update.cluster !== undefined) {
    return moveWorkspaceHomeClusterItem(
      clusterPreviews,
      update.id,
      nextItem,
      update.cluster,
    );
  }

  return mapWorkspaceHomeClusterItems(
    clusterPreviews,
    update.id,
    () => nextItem,
  );
}

export function applyWorkspaceHomeTextCaptureEnrichmentUpdates(
  clusterPreviews: readonly WorkspaceHomeClusterPreview[],
  updates: readonly WorkspaceHomeTextCaptureEnrichmentUpdate[],
): readonly WorkspaceHomeClusterPreview[] {
  return updates.reduce(
    (currentClusterPreviews, update) =>
      applyWorkspaceHomeTextCaptureEnrichmentUpdate(
        currentClusterPreviews,
        update,
      ),
    clusterPreviews,
  );
}

export function markWorkspaceHomeAiFieldRecoveryPending(
  clusterPreviews: readonly WorkspaceHomeClusterPreview[],
  itemId: string,
  fieldName: WorkspaceHomeRecoverableAiFieldName,
): readonly WorkspaceHomeClusterPreview[] {
  return mapWorkspaceHomeClusterItems(clusterPreviews, itemId, (item) => {
    switch (fieldName) {
      case "summary":
        return {
          ...item,
          isSummaryPending: true,
          summaryStatus: "PENDING",
        };
      case "tags":
        return {
          ...item,
          isTagsPending: true,
          tagsStatus: "PENDING",
        };
      case "title":
        return {
          ...item,
          isTitlePending: true,
          titleStatus: "PENDING",
        };
    }
  });
}

export function applyWorkspaceHomeManualAiFieldRecovery(
  clusterPreviews: readonly WorkspaceHomeClusterPreview[],
  itemId: string,
  fieldName: WorkspaceHomeRecoverableAiFieldName,
  value: WorkspaceHomeManualAiFieldValue,
): readonly WorkspaceHomeClusterPreview[] {
  return mapWorkspaceHomeClusterItems(clusterPreviews, itemId, (item) => {
    switch (fieldName) {
      case "summary":
        return {
          ...item,
          isSummaryPending: false,
          summary: value as string,
          summaryStatus: "COMPLETED",
        };
      case "tags":
        return {
          ...item,
          isTagsPending: false,
          tags: [...(value as readonly string[])],
          tagsStatus: "COMPLETED",
        };
      case "title":
        return {
          ...item,
          isTitlePending: false,
          title: value as string,
          titleStatus: "COMPLETED",
        };
    }
  });
}
