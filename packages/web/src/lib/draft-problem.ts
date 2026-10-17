import type { MessageKey } from './i18n';
import { InspirationDraftConflict } from './inspiration-draft-store';

/**
 * A DRAFT PROBLEM THE PERSON CAN BE TOLD ABOUT, as a catalogue key.
 *
 * The composer's draft hook, its upload and `Home`'s save path used to set
 * and throw finished English sentences — "File drafts are unavailable on
 * this device." — which every caller printed as they came, so a Korean reader got them in English. A lib does not know whose
 * screen it is on; it says WHICH problem, and the surface says it in the
 * reader's language. `draftProblem` turns anything a draft write can reject
 * with into one of these keys, so a storage engine's own message ("Draft
 * storage failed") never reaches a screen either.
 */
export class DraftProblem extends Error {
  constructor(readonly reason: MessageKey) {
    super(reason);
    this.name = 'DraftProblem';
  }
}
export function draftProblem(reason: unknown, fallback: MessageKey = 'worldDraftKeepFailed'): MessageKey {
  if (reason instanceof DraftProblem) return reason.reason;
  if (reason instanceof InspirationDraftConflict) return 'worldDraftChangedElsewhere';
  return fallback;
}
