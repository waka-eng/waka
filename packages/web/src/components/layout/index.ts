/**
 * Layout component barrel.
 *
 * Centralizes imports so consumers can write
 * `import { AppShell, ClusterGrid } from "../components/layout"` instead
 * of pulling each file individually. Keeps the public surface of the
 * `layout/` folder explicit and discoverable.
 */

export { AppHeader } from "./AppHeader";
export type { AppHeaderProps } from "./AppHeader";
export { AppShell } from "./AppShell";
export type { AppShellProps } from "./AppShell";
export { BackgroundField } from "./BackgroundField";
export { ClusterGrid } from "./ClusterGrid";
export type { ClusterGridProps } from "./ClusterGrid";
export { ClusterSection } from "./ClusterSection";
export type { ClusterSectionProps, ClusterKind } from "./ClusterSection";
export { DropOverlay } from "./DropOverlay";
export { HistoryPanel } from "./HistoryPanel";
export type { HistoryPanelProps } from "./HistoryPanel";
