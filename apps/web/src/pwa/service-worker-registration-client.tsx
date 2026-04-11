"use client";

import { useEffect } from "react";

import { scheduleProductionServiceWorkerRegistrationOnClient } from "./service-worker-client-registration.ts";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    return scheduleProductionServiceWorkerRegistrationOnClient();
  }, []);

  return null;
}
