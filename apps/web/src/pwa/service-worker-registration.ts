export {
  WAKA_SERVICE_WORKER_PATH,
  WAKA_SERVICE_WORKER_SCOPE,
} from "./install-metadata.ts";
import {
  WAKA_SERVICE_WORKER_PATH,
  WAKA_SERVICE_WORKER_SCOPE,
} from "./install-metadata.ts";

export const WAKA_SERVICE_WORKER_SKIP_WAITING_MESSAGE_TYPE =
  "waka:service-worker:skip-waiting";

export interface ServiceWorkerRuntimeTarget {
  state?: string;
  addEventListener?(
    type: "statechange",
    listener: () => void,
  ): void;
  postMessage(message: { type: string }): void;
  removeEventListener?(
    type: "statechange",
    listener: () => void,
  ): void;
}

export interface ServiceWorkerRegistrationRecord {
  installing?: ServiceWorkerRuntimeTarget | null;
  waiting?: ServiceWorkerRuntimeTarget | null;
  addEventListener?(
    type: "updatefound",
    listener: () => void,
  ): void;
  removeEventListener?(
    type: "updatefound",
    listener: () => void,
  ): void;
}

export interface ServiceWorkerRegistrationTarget {
  register(
    scriptUrl: string,
    options?: {
      scope?: string;
    },
  ): Promise<ServiceWorkerRegistrationRecord>;
}

export function createServiceWorkerSkipWaitingMessage(): {
  type: string;
} {
  return {
    type: WAKA_SERVICE_WORKER_SKIP_WAITING_MESSAGE_TYPE,
  };
}

export function shouldRegisterProductionServiceWorker(
  env: string | undefined,
  supportsServiceWorker: boolean,
): boolean {
  return env === "production" && supportsServiceWorker;
}

export async function registerProductionServiceWorker(
  serviceWorker: ServiceWorkerRegistrationTarget | undefined,
  env: string | undefined = process.env.NODE_ENV,
): Promise<ServiceWorkerRegistrationRecord | false> {
  if (!shouldRegisterProductionServiceWorker(env, serviceWorker !== undefined)) {
    return false;
  }

  return serviceWorker.register(WAKA_SERVICE_WORKER_PATH, {
    scope: WAKA_SERVICE_WORKER_SCOPE,
  });
}
