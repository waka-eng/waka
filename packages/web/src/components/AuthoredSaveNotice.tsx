import type { useAuthoredSave } from '../lib/use-authored-save';
import { t, type SupportedLocale } from '../lib/i18n';

/** `onResave` rebuilds the save from what is on screen at the press — so
    "Save as new" keeps the words as they are NOW, not as they were when the
    question first appeared. Without it, the stashed words are used. */
export function AuthoredSaveNotice({ save, locale, onResave }: {
  save: ReturnType<typeof useAuthoredSave>; locale: SupportedLocale; onResave?: () => void;
}) {
  /* A JOURNAL THAT CANNOT BE READ STAYS SAID UNTIL IT IS RESET (review), and
     beside whatever else is pending, never instead of it: a pass over the
     readable saves must not wipe the one sentence about the unreadable one. */
  const unreadable = save.invalid ? <div className="jar-source-status" role="status" data-jar-chrome="1">
    <span>{t(locale, 'worldSaveInvalid')}</span>
    <button type="button" onClick={() => { if (window.confirm(t(locale, 'worldSaveResetConfirm'))) save.resetInvalid(); }}>{t(locale, 'worldSaveStartAgain')}</button>
  </div> : null;
  if (save.phase === 'idle') return unreadable;
  const message = save.phase === 'saving' ? 'worldKeeping'
    : save.phase === 'removed' ? 'worldSaveRemoved'
    : save.phase === 'storage_error' ? 'worldSaveStorageFailed'
    : save.phase === 'rejected' ? 'worldSaveRejected'
    : save.phase === 'diverged' ? 'worldSaveDiverged'
    : 'worldSaveUncertain';
  return <>{unreadable}<div className="jar-source-status" role="status" data-jar-chrome="1">
    <span>{save.phase === 'rejected' && save.pending?.validationMessage ? save.pending.validationMessage : t(locale, message)}</span>
    {/* A refusal gives the person back everything the save carried. */}
    {save.phase === 'rejected' ? <button type="button" onClick={save.editRejected}>{t(locale, 'worldSaveEditDraft')}</button>
      /* THE PERSON CHOOSES whether edited words become a second inspiration.
         The earlier save is kept and still sent either way. */
      : save.phase === 'diverged' && !save.busy ? <>
        <button type="button" onClick={() => { if (onResave) onResave(); else save.saveAsNew(); }}>{t(locale, 'worldSaveAsNew')}</button>
        <button type="button" onClick={() => { void save.keepEarlier(); }}>{t(locale, 'worldSaveCheckEarlier')}</button>
      </>
      : save.pending && !save.busy ? <button type="button" onClick={(event) => {
        event.currentTarget.closest<HTMLElement>('[data-jar-surface]')?.focus({ preventScroll: true });
        void save.retry();
      }}>{t(locale, 'worldSourceRetry')}</button>
      : !save.pending && !save.busy ? <button type="button" aria-label={t(locale, 'worldSourceDismiss')} onClick={save.dismiss}>×</button> : null}
  </div></>;
}
