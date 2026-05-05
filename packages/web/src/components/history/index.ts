/**
 * History component barrel.
 *
 * Re-exports the history-detail interactive primitives so consumers can
 * write `import { ReflectionThread, ReflectionForm } from
 * "../components/history"`.
 */

export { ReflectionThread } from "./ReflectionThread";
export type {
  ReflectionThreadProps,
  ReflectionEntry,
} from "./ReflectionThread";

export { ReflectionForm } from "./ReflectionForm";
export type {
  ReflectionFormProps,
  PendingReflection,
} from "./ReflectionForm";

export { InspirationDetail } from "./InspirationDetail";
export type {
  InspirationDetailProps,
  InspirationDetailData,
} from "./InspirationDetail";
