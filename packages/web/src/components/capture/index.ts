/**
 * Capture component barrel.
 *
 * Re-exports the interactive capture primitives so consumers can write
 * `import { CaptureCell, CloseConfirmModal } from "../components/capture"`.
 */

export { CaptureCell } from "./CaptureCell";
export type {
  CaptureCellProps,
  CaptureCellVisualState,
  CaptureView,
} from "./CaptureCell";
export { CloseConfirmModal } from "./CloseConfirmModal";
export type { CloseConfirmModalProps } from "./CloseConfirmModal";
export { CaptureForm, extractUrlsFromText } from "./CaptureForm";
export type {
  CaptureFormProps,
  PendingAttachment,
  PendingInspiration,
  PersistedResult,
} from "./CaptureForm";
