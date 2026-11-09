/**
 * ═══ A DEV-ONLY WALK THROUGH ONBOARDING ═════════════════════════════════
 *
 * `/onboarding?preview=1`, on a dev server only. The founder's own account is
 * long since onboarded, so without this the flow cannot be exercised on the
 * machine they use (Law 9). In preview: it opens on the intro, ignores the
 * gate and the server's save count, saves nothing (answers are simulated and
 * a sample read is shown), and never marks onboarding complete.
 *
 * In a production build `import.meta.env.DEV` is false, so the parameter does
 * nothing at all — `onboarding-preview.test.tsx` holds that.
 */
export function onboardingPreviewRequested(search: string, dev: boolean = import.meta.env.DEV): boolean {
  if (!dev) return false;
  try {
    return new URLSearchParams(search).get("preview") === "1";
  } catch {
    return false;
  }
}
