import type { useAuthoredSave } from '../lib/use-authored-save';
import { t, type SupportedLocale } from '../lib/i18n';

/** `onResave` rebuilds the save from what is on screen at the press — so
    "Save as new" keeps the words as they are NOW, not as they were when the
    question first appeared (review). Without it, the stashed words are used. */
export function AuthoredSaveNotice({ save, locale, onResave }: { save: ReturnType<typeof useAuthoredSave>; locale: SupportedLocale; onResave?: () => void }) {
  if (save.phase === 'idle') return null;
  const message = save.phase === 'checking' ? 'worldSaveChecking' : save.phase === 'saving' ? 'worldKeeping'
    : save.phase === 'removed' ? 'worldSaveRemoved' : save.phase === 'invalid' ? 'worldSaveInvalid'
    : save.phase === 'storage_error' ? 'worldSaveStorageFailed' : save.phase === 'unsupported' ? 'worldSaveUnavailable'
    : save.phase === 'rejected' ? 'worldSaveRejected'
    : save.phase === 'unsent' ? 'worldSaveUnsent'
    : save.phase === 'diverged' ? 'worldSaveDiverged'
    : save.pending?.acknowledged ? 'worldSaveKeptCheckFailed' : 'worldSaveUncertain';
  return <div className="jar-source-status" role="status" data-jar-chrome="1">
    <span>{save.phase === 'rejected' && save.pending?.validationMessage ? save.pending.validationMessage : t(locale, message)}</span>
    {save.phase === 'invalid' ? <button type="button" onClick={() => { if (window.confirm(t(locale, 'worldSaveResetConfirm'))) save.resetInvalid(); }}>{t(locale, 'worldSaveStartAgain')}</button>
      : save.phase === 'rejected' ? <button type="button" onClick={save.editRejected}>{t(locale, 'worldSaveEditDraft')}</button>
      /* THE PERSON CHOOSES whether edited words become a second inspiration
         while the first may already have landed; nothing decides it for them. */
      : save.phase === 'diverged' && !save.busy ? <>
        <button type="button" onClick={() => { if (!onResave) { save.saveAsNew(); return; } if (save.discardHeld()) onResave(); }}>{t(locale, 'worldSaveAsNew')}</button>
        <button type="button" onClick={() => { void save.keepEarlier(); }}>{t(locale, 'worldSaveCheckEarlier')}</button>
      </>
      : save.pending && !save.busy ? <button type="button" onClick={(event) => {
        event.currentTarget.closest<HTMLElement>('[data-jar-surface]')?.focus({ preventScroll: true });
        void save.retry();
      }}>{t(locale, 'worldSourceRetry')}</button>
      : !save.pending && !save.busy ? <button type="button" aria-label={t(locale, 'worldSourceDismiss')} onClick={save.dismiss}>×</button> : null}
  </div>;
}
