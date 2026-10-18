/**
 * WHAT THE COMPOSER SAYS WHEN A KEEP OR AN UPLOAD RETRY FAILS.
 *
 * `Home` says both through `draftProblem`, each with its own fallback: a keep
 * falls back to "could not save", an upload retry to "upload failed". These
 * pin the three answers that matter: a server refusal of the SAVE is a failed
 * save (not an upload), an upload's own failure is an upload failure from
 * either path, and a draft changed in another tab is that conflict from
 * either path — the one answer that offers a separate draft.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing; `draftProblem` is pure.
 */
import { expect, it } from 'vitest';

import { ApiError } from '../src/lib/api';
import { DraftProblem, draftProblem } from '../src/lib/draft-problem';
import { InspirationDraftConflict } from '../src/lib/inspiration-draft-store';

it('says a refused keep as a failed save, not a failed upload', () => {
  expect(draftProblem(new ApiError({ status: 500, message: 'boom' }), 'worldComposerSaveFailed')).toBe('worldComposerSaveFailed');
});

it('says an upload failure as one, whichever path met it', () => {
  const upload = new DraftProblem('worldComposerUploadFailed');
  expect(draftProblem(upload, 'worldComposerSaveFailed')).toBe('worldComposerUploadFailed');
  expect(draftProblem(new TypeError('Failed to fetch'), 'worldComposerUploadFailed')).toBe('worldComposerUploadFailed');
});

it('says a draft changed elsewhere as that conflict on a retried upload too', () => {
  expect(draftProblem(new DraftProblem('worldDraftChangedElsewhere'), 'worldComposerUploadFailed')).toBe('worldDraftChangedElsewhere');
  expect(draftProblem(new InspirationDraftConflict(), 'worldComposerUploadFailed')).toBe('worldDraftChangedElsewhere');
});
