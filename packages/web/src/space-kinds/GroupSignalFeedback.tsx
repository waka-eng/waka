import { useEffect, useRef, useState } from 'react';
import type { ApiFeedbackValue, ApiGroupWallSignal } from '../lib/api';
import { t, type SupportedLocale } from '../lib/locales';

export interface GroupSignalFeedbackProps {
  groupId: string;
  viewerProfileId: string | null;
  signals: ApiGroupWallSignal[];
  locale: SupportedLocale;
  onSubmit: (signalId: string, value: ApiFeedbackValue, revision: string) => Promise<void>;
  onRefresh: () => Promise<boolean>;
}

/** These are reactions to room statements, never to the raw captures beneath. */
export function GroupSignalFeedback(props: GroupSignalFeedbackProps) {
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<'saved' | 'unknown' | 'changed' | null>(null);
  const [confirmed, setConfirmed] = useState<{ id: string; revision: string; value: ApiFeedbackValue } | null>(null);
  const mounted = useRef(true), latest = useRef(props);
  const sequence = useRef(0), pendingRequest = useRef(false);
  const pendingWords = useRef<{ id: string; revision: string } | null>(null);
  latest.current = props;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    sequence.current += 1; pendingRequest.current = false;
    pendingWords.current = null;
    setPending(null); setNotice(null); setConfirmed(null);
  }, [props.groupId, props.viewerProfileId]);
  useEffect(() => {
    const current = (word: { id: string; revision: string }) => props.signals.some((row) => row.signalId === word.id && row.statementRevision === word.revision);
    if (pendingWords.current && !current(pendingWords.current)) {
      sequence.current += 1; pendingRequest.current = false; pendingWords.current = null; setPending(null);
    }
    if (confirmed && !current(confirmed)) { setConfirmed(null); setNotice(null); }
  }, [props.signals, confirmed]);
  const submit = async (signal: ApiGroupWallSignal, value: ApiFeedbackValue) => {
    if (pendingRequest.current || !signal.statementRevision || !props.viewerProfileId) return;
    pendingRequest.current = true;
    const request = ++sequence.current;
    const group = props.groupId, viewer = props.viewerProfileId, revision = signal.statementRevision;
    pendingWords.current = { id: signal.signalId, revision };
    const sameScope = () => mounted.current && sequence.current === request && latest.current.groupId === group && latest.current.viewerProfileId === viewer;
    const sameWords = () => sameScope() && latest.current.signals.some((row) => row.signalId === signal.signalId && row.statementRevision === revision);
    setPending(signal.signalId); setNotice(null);
    try {
      await props.onSubmit(signal.signalId, value, revision);
      if (!sameWords()) return;
      setConfirmed({ id: signal.signalId, revision, value }); setNotice('saved');
      // Read failure cannot turn an acknowledged write into "not saved".
      await props.onRefresh().catch(() => false);
    } catch (error) {
      if (!sameScope()) return;
      const changed = (error as { code?: string })?.code === 'feedback_target_changed';
      setNotice(changed ? 'changed' : 'unknown');
      if (changed) await props.onRefresh().catch(() => false);
    } finally { if (sameScope()) { pendingRequest.current = false; pendingWords.current = null; setPending(null); } }
  };
  if (!props.signals.length) return null;
  return <section className="jar-room-patterns" aria-label={t(props.locale, 'worldRoomPatterns')}>
    <p className="jar-label">{t(props.locale, 'worldRoomPatterns')}</p>
    <ul>
      {props.signals.map((signal) => {
        const mine = confirmed?.id === signal.signalId && confirmed.revision === signal.statementRevision ? confirmed.value
          : signal.reactions.find((row) => row.profileId === props.viewerProfileId)?.value;
        return <li key={signal.signalId}>
          <p>{signal.statement}</p>
          {props.viewerProfileId && signal.statementRevision ? <div className="jar-room-pattern-actions">
            {(['true', 'partly', 'not_true'] as const).map((value) => <button key={value} type="button"
              aria-pressed={mine === value} aria-disabled={pending !== null || undefined}
              onClick={() => void submit(signal, value)}>
              {t(props.locale, value === 'true' ? 'worldYes' : value === 'partly' ? 'worldPartly' : 'worldNotTrue')}
            </button>)}
          </div> : null}
        </li>;
      })}
    </ul>
    {pending ? <p role="status">{t(props.locale, 'worldKeeping')}</p> : notice ? <p role="status">
      {t(props.locale, notice === 'saved' ? 'worldRoomResponseSaved' : notice === 'changed' ? 'worldRoomResponseChanged' : 'worldRoomResponseUnknown')}
      {notice !== 'saved' ? <button type="button" onClick={() => void props.onRefresh().catch(() => false)}>{t(props.locale, 'worldRoomResponseCheck')}</button> : null}
    </p> : null}
  </section>;
}
