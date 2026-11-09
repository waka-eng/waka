import { useState } from 'react';
import type { useAuthoredSave } from '../lib/use-authored-save';
import { t, type SupportedLocale } from '../lib/i18n';

export function AuthoredSaveNotice({ save, locale }: { save: ReturnType<typeof useAuthoredSave>; locale: SupportedLocale }) {
  /* STARTING AGAIN IS ASKED IN PLACE, never in a browser dialog: the
     sentence, then Cancel and Start again. */
  const [asking, setAsking] = useState(false);
  if (save.phase === 'idle') return null;
  const message = save.phase === 'checking' ? 'worldSaveChecking' : save.phase === 'saving' ? 'worldKeeping'
    : save.phase === 'removed' ? 'worldSaveRemoved' : save.phase === 'invalid' ? 'worldSaveInvalid'
    : save.phase === 'storage_error' ? 'worldSaveStorageFailed' : save.phase === 'unsupported' ? 'worldSaveUnavailable'
    : save.phase === 'rejected' ? 'worldSaveRejected'
    : save.pending?.acknowledged ? 'worldSaveKeptCheckFailed' : 'worldSaveUncertain';
  return <div className="jar-source-status" role="status" data-jar-chrome="1">
    <span>{save.phase === 'invalid' && asking ? t(locale, 'worldSaveResetConfirm') : save.phase === 'rejected' && save.pending?.validationMessage ? save.pending.validationMessage : t(locale, message)}</span>
    {save.phase === 'invalid' && asking ? <>
        <button type="button" onClick={() => setAsking(false)}>{t(locale, 'worldCancel')}</button>
        <button type="button" onClick={() => { setAsking(false); save.resetInvalid(); }}>{t(locale, 'worldSaveStartAgain')}</button>
      </>
      : save.phase === 'invalid' ? <button type="button" onClick={() => setAsking(true)}>{t(locale, 'worldSaveStartAgain')}</button>
      : save.phase === 'rejected' ? <button type="button" onClick={save.editRejected}>{t(locale, 'worldSaveEditDraft')}</button>
      : save.pending && !save.busy ? <button type="button" onClick={(event) => {
        event.currentTarget.closest<HTMLElement>('[data-jar-surface]')?.focus({ preventScroll: true });
        void save.retry();
      }}>{t(locale, 'worldSourceRetry')}</button>
      : !save.pending && !save.busy ? <button type="button" onClick={save.dismiss}>{t(locale, 'worldSourceDismiss')}</button> : null}
  </div>;
}
