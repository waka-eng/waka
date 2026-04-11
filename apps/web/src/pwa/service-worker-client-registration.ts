import {
  createServiceWorkerSkipWaitingMessage,
  registerProductionServiceWorker,
  shouldRegisterProductionServiceWorker,
  type ServiceWorkerRegistrationRecord,
  type ServiceWorkerRegistrationTarget,
  type ServiceWorkerRuntimeTarget,
} from "./service-worker-registration.ts";

export interface ServiceWorkerNavigatorRegistrationTarget
  extends ServiceWorkerRegistrationTarget {
  controller?: unknown;
  addEventListener?(
    type: "controllerchange",
    listener: () => void,
  ): void;
  removeEventListener?(
    type: "controllerchange",
    listener: () => void,
  ): void;
}

export interface ServiceWorkerNavigatorTarget {
  serviceWorker?: ServiceWorkerNavigatorRegistrationTarget;
}

export interface ServiceWorkerRegistrationDocumentTarget {
  readyState: DocumentReadyState;
}

export interface ServiceWorkerRegistrationWindowTarget {
  addEventListener(
    type: "load" | "pagehide",
    listener: () => void,
    options?: {
      once?: boolean;
    },
  ): void;
  clearTimeout(timeoutId: number): void;
  location?: {
    reload(): void;
  };
  removeEventListener(type: "load" | "pagehide", listener: () => void): void;
  setTimeout(callback: () => void, delay?: number): number;
}

export type ServiceWorkerClientRegistrationCleanup = () => void;

export interface ServiceWorkerRegistrationBootstrapOptions {
  browserDocument?: ServiceWorkerRegistrationDocumentTarget;
  browserNavigator?: ServiceWorkerNavigatorTarget;
  browserWindow?: ServiceWorkerRegistrationWindowTarget;
  env?: string | undefined;
  registerServiceWorker?: (
    browserNavigator: ServiceWorkerNavigatorTarget | undefined,
    env: string | undefined,
    browserWindow: ServiceWorkerRegistrationWindowTarget | undefined,
  ) => Promise<ServiceWorkerClientRegistrationCleanup | false>;
}

function resolveServiceWorkerRegistrationTarget(
  browserNavigator:
    | ServiceWorkerNavigatorTarget
    | undefined = typeof navigator === "undefined" ? undefined : navigator,
): ServiceWorkerNavigatorRegistrationTarget | undefined {
  return browserNavigator?.serviceWorker;
}

function canRegisterProductionServiceWorkerOnClient(
  browserNavigator:
    | ServiceWorkerNavigatorTarget
    | undefined = typeof navigator === "undefined" ? undefined : navigator,
  env: string | undefined = process.env.NODE_ENV,
): boolean {
  return shouldRegisterProductionServiceWorker(
    env,
    resolveServiceWorkerRegistrationTarget(browserNavigator) !== undefined,
  );
}

function hasActiveServiceWorkerController(
  browserNavigator:
    | ServiceWorkerNavigatorTarget
    | undefined = typeof navigator === "undefined" ? undefined : navigator,
): boolean {
  const controller = resolveServiceWorkerRegistrationTarget(browserNavigator)?.controller;

  return controller !== undefined && controller !== null;
}

function installServiceWorkerUpdateHandling({
  browserNavigator,
  browserWindow,
  registration,
}: {
  browserNavigator:
    | ServiceWorkerNavigatorTarget
    | undefined;
  browserWindow:
    | ServiceWorkerRegistrationWindowTarget
    | undefined;
  registration: ServiceWorkerRegistrationRecord;
}): ServiceWorkerClientRegistrationCleanup {
  const serviceWorker = resolveServiceWorkerRegistrationTarget(browserNavigator);
  const hasController = hasActiveServiceWorkerController(browserNavigator);

  if (serviceWorker === undefined) {
    return () => undefined;
  }

  let pendingWaitingWorker: ServiceWorkerRuntimeTarget | null =
    registration.waiting ?? null;
  let shouldReloadOnControllerChange = false;
  let didReloadOnControllerChange = false;
  let didRequestActivation = false;

  const activatePendingWaitingWorker = ({
    reloadOnControllerChange,
  }: {
    reloadOnControllerChange: boolean;
  }): void => {
    if (pendingWaitingWorker === null || didRequestActivation) {
      return;
    }

    shouldReloadOnControllerChange = reloadOnControllerChange;
    didRequestActivation = true;
    pendingWaitingWorker.postMessage(createServiceWorkerSkipWaitingMessage());
  };

  const handleControllerChange = (): void => {
    if (!shouldReloadOnControllerChange || didReloadOnControllerChange) {
      return;
    }

    didReloadOnControllerChange = true;
    browserWindow?.location?.reload();
  };

  const handlePageHide = (): void => {
    activatePendingWaitingWorker({
      reloadOnControllerChange: false,
    });
  };

  let removeInstallingWorkerListener: ServiceWorkerClientRegistrationCleanup =
    () => undefined;

  const trackInstallingWorker = (
    installingWorker: ServiceWorkerRuntimeTarget | null | undefined,
  ): void => {
    removeInstallingWorkerListener();
    removeInstallingWorkerListener = () => undefined;

    if (installingWorker === null || installingWorker === undefined) {
      return;
    }

    const handleInstallingWorkerStateChange = (): void => {
      if (installingWorker.state !== "installed") {
        return;
      }

      pendingWaitingWorker = registration.waiting ?? installingWorker;
    };

    installingWorker.addEventListener?.(
      "statechange",
      handleInstallingWorkerStateChange,
    );
    removeInstallingWorkerListener = () => {
      installingWorker.removeEventListener?.(
        "statechange",
        handleInstallingWorkerStateChange,
      );
    };
    handleInstallingWorkerStateChange();
  };

  const handleUpdateFound = (): void => {
    trackInstallingWorker(registration.installing);
  };

  serviceWorker.addEventListener?.("controllerchange", handleControllerChange);
  registration.addEventListener?.("updatefound", handleUpdateFound);
  browserWindow?.addEventListener("pagehide", handlePageHide);

  trackInstallingWorker(registration.installing);

  if (hasController && registration.waiting !== undefined && registration.waiting !== null) {
    activatePendingWaitingWorker({
      reloadOnControllerChange: true,
    });
  }

  return () => {
    removeInstallingWorkerListener();
    serviceWorker.removeEventListener?.("controllerchange", handleControllerChange);
    registration.removeEventListener?.("updatefound", handleUpdateFound);
    browserWindow?.removeEventListener("pagehide", handlePageHide);
  };
}

export async function registerProductionServiceWorkerOnClient(
  browserNavigator:
    | ServiceWorkerNavigatorTarget
    | undefined = typeof navigator === "undefined" ? undefined : navigator,
  env: string | undefined = process.env.NODE_ENV,
  browserWindow:
    | ServiceWorkerRegistrationWindowTarget
    | undefined = typeof window === "undefined" ? undefined : window,
): Promise<ServiceWorkerClientRegistrationCleanup | false> {
  const serviceWorker = resolveServiceWorkerRegistrationTarget(browserNavigator);

  if (!canRegisterProductionServiceWorkerOnClient(browserNavigator, env)) {
    return false;
  }

  const registration = await registerProductionServiceWorker(serviceWorker, env);

  if (registration === false) {
    return false;
  }

  return installServiceWorkerUpdateHandling({
    browserNavigator,
    browserWindow,
    registration,
  });
}

export function scheduleProductionServiceWorkerRegistrationOnClient({
  browserDocument = typeof document === "undefined" ? undefined : document,
  browserNavigator = typeof navigator === "undefined" ? undefined : navigator,
  browserWindow = typeof window === "undefined" ? undefined : window,
  env = process.env.NODE_ENV,
  registerServiceWorker = registerProductionServiceWorkerOnClient,
}: ServiceWorkerRegistrationBootstrapOptions = {}): () => void {
  if (
    browserWindow === undefined ||
    !canRegisterProductionServiceWorkerOnClient(browserNavigator, env)
  ) {
    return () => undefined;
  }

  let didDispose = false;
  let removeServiceWorkerRegistrationListeners: ServiceWorkerClientRegistrationCleanup =
    () => undefined;

  const runRegistration = () => {
    void registerServiceWorker(browserNavigator, env, browserWindow)
      .then((registrationCleanup) => {
        if (registrationCleanup === false) {
          return;
        }

        if (didDispose) {
          registrationCleanup();
          return;
        }

        removeServiceWorkerRegistrationListeners = registrationCleanup;
      })
      .catch(() => undefined);
  };

  if (browserDocument?.readyState === "complete") {
    const timeoutId = browserWindow.setTimeout(runRegistration, 0);

    return () => {
      didDispose = true;
      browserWindow.clearTimeout(timeoutId);
      removeServiceWorkerRegistrationListeners();
    };
  }

  browserWindow.addEventListener("load", runRegistration, {
    once: true,
  });

  return () => {
    didDispose = true;
    browserWindow.removeEventListener("load", runRegistration);
    removeServiceWorkerRegistrationListeners();
  };
}
