/**
 * How a refused payload names what was wrong with it.
 *
 * Every route rendered `error.flatten().fieldErrors` — which silently drops
 * ROOT-level issues, and with `.strict()` schemas the most important refusal
 * of all lives at the root: `unrecognized_keys`. A capture smuggling
 * `profile` in its body got back `details: {}` — a 400 that refused to say
 * why, which is barely better than the silent ignoring it replaced. Root
 * issues now land under `body`, keyed like any field, so the shape of
 * `details` stays uniform and the refusal names the key.
 */
import type { z } from "zod";

export function validationDetails(
  error: z.ZodError,
): Record<string, string[] | undefined> {
  const { fieldErrors, formErrors } = error.flatten();
  return formErrors.length > 0 ? { ...fieldErrors, body: formErrors } : fieldErrors;
}
