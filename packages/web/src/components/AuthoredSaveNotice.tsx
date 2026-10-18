import type { useAuthoredSave } from '../lib/use-authored-save';
import { formatMessage, t, type SupportedLocale } from '../lib/i18n';

/** `onResave` rebuilds the save from what is on screen at the press — so
    "Save as new" keeps the words as they are NOW, not as they were when the
    question first appeared (review). Without it, the stashed words are used.
    `onRestore` puts a released save's words back when the composer no longer
    holds them (`currentText` is what it holds now). */
export function AuthoredSaveNotice({ save, locale, onResave, onRestore, currentText = '' }: {
  save: ReturnType<typeof useAuthoredSave>; locale: SupportedLocale; onResave?: () => void;
  onRestore?: (text: string) => void; currentText?: string;
}) {
  if (save.phase === 'idle') return null;
  /* AN EARLIER SAVE THAT DID NOT LAND, WHOSE WORDS ARE NO LONGER ON SCREEN —
     the one "Save as new" stepped past. Its words are named and offered back
     rather than said to be "still here" when they are not. */
  const lostWords = save.phase === 'unsent' && save.unsent?.displaced && save.unsent.input.text.trim() &&
    !currentText.includes(save.unsent.input.text.trim()) ? save.unsent.input.text.trim() : null;
  const message = save.phase === 'checking' ? 'worldSaveChecking' : save.phase === 'saving' ? 'worldKeeping'
    : save.phase === 'removed' ? 'worldSaveRemoved' : save.phase === 'invalid' ? 'worldSaveInvalid'
    : save.phase === 'storage_error' ? 'worldSaveStorageFailed' : save.phase === 'unsupported' ? 'worldSaveUnavailable'
    : save.phase === 'rejected' ? 'worldSaveRejected'
    : save.phase === 'unsent' ? 'worldSaveUnsent'
    : save.phase === 'diverged' ? 'worldSaveDiverged'
    : save.pending?.acknowledged ? 'worldSaveKeptCheckFailed' : 'worldSaveUncertain';
  const words = lostWords ? formatMessage(locale, 'worldSaveUnsentEarlier', { preview: lostWords.length > 60 ? `${lostWords.slice(0, 59)}…` : lostWords })
    : save.phase === 'rejected' && save.pending?.validationMessage ? save.pending.validationMessage : t(locale, message);
  return <div className="jar-source-status" role="status" data-jar-chrome="1">
    <span>{words}</span>
    {save.phase === 'invalid' ? <button type="button" onClick={() => { if (window.confirm(t(locale, 'worldSaveResetConfirm'))) save.resetInvalid(); }}>{t(locale, 'worldSaveStartAgain')}</button>
      : save.phase === 'rejected' ? <button type="button" onClick={save.editRejected}>{t(locale, 'worldSaveEditDraft')}</button>
      /* THE PERSON CHOOSES whether edited words become a second inspiration
         while the first is not confirmed; the first is kept and still checked
         either way, so choosing never drops it. */
      : save.phase === 'diverged' && !save.busy ? <>
        <button type="button" onClick={() => { if (!onResave) { save.saveAsNew(); return; } if (save.prepareNew()) onResave(); }}>{t(locale, 'worldSaveAsNew')}</button>
        <button type="button" onClick={() => { void save.keepEarlier(); }}>{t(locale, 'worldSaveCheckEarlier')}</button>
      </>
      : lostWords && onRestore ? <>
        <button type="button" onClick={() => { onRestore(lostWords); save.dismiss(); }}>{t(locale, 'worldSaveRestore')}</button>
        <button type="button" aria-label={t(locale, 'worldSourceDismiss')} onClick={save.dismiss}>×</button>
      </>
      : save.pending && !save.busy ? <button type="button" onClick={(event) => {
        event.currentTarget.closest<HTMLElement>('[data-jar-surface]')?.focus({ preventScroll: true });
        void save.retry();
      }}>{t(locale, 'worldSourceRetry')}</button>
      : !save.pending && !save.busy ? <button type="button" aria-label={t(locale, 'worldSourceDismiss')} onClick={save.dismiss}>×</button> : null}
  </div>;
}
