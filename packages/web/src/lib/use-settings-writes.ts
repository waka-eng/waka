/**
 * THE NAME AND THE LANGUAGE, WRITTEN FROM THE SETTINGS PANEL.
 *
 * Lifted out of `Home.tsx` so the ordering rules below can be tested on
 * their own; the page holds no copy of them.
 *
 * ONE QUEUE FOR BOTH WRITES. The name endpoint is a replace, not a patch —
 * `PATCH /auth/me/profile` requires `preferredLocale` beside the name — so a
 * name write carries a language too. Sent side by side, a name write that
 * left before a language change could land after it and put the old
 * language back; two name writes could land out of order and leave the
 * older name on the account. So every write waits for the one before it,
 * and a name write reads the language the person CURRENTLY wants at the
 * moment it is sent, not the one that was showing when they typed.
 *
 * ONLY THE NEWEST WRITE OF EACH KIND SPEAKS. Busy, failed and the field are
 * decided by the latest name write and the latest language write; an older
 * one settling first neither clears "busy" early nor reports a failure the
 * newer write has already superseded.
 *
 * THE FIELD CONVERGES ON WHAT WAS LAST SENT, NOT ON THE ACCOUNT. Typing the
 * old name back while a rename is out used to be skipped as "no change" —
 * it matched `accountName`, which had not updated yet — and the rename then
 * landed, leaving the account on the name the person had just typed away.
 * The comparison is with the last name SENT, so typing back schedules a
 * write back.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { SupportedLocale } from "./locales";

export interface SettingsWritesInput {
  accountName: string;
  /** The language the account holds now. */
  locale: SupportedLocale;
  updateName: (name: string, preferredLocale: SupportedLocale) => Promise<unknown>;
  updateLocale: (preferredLocale: SupportedLocale) => Promise<unknown>;
  /** How long the field must be still before its name is written. */
  settleMs: number;
}

export function useSettingsWrites(input: SettingsWritesInput) {
  const [typed, setTyped] = useState<string | null>(null);
  const [nameBusy, setNameBusy] = useState(false);
  const [localeBusy, setLocaleBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const live = useRef(input);
  live.current = input;
  const chain = useRef<Promise<void>>(Promise.resolve());
  const nameToken = useRef(0), localeToken = useRef(0), localePending = useRef(0);
  const lastSent = useRef<string | null>(null);
  const wantedLocale = useRef(input.locale);
  /* With no language write out, the language wanted is the one the account
     holds — which another tab may have changed. */
  if (localePending.current === 0) wantedLocale.current = input.locale;
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  /** Run after every write already queued; never rejects the queue itself. */
  const enqueue = useCallback(<T,>(write: () => Promise<T>): Promise<T> => {
    const run = chain.current.then(write);
    chain.current = run.then(() => undefined, () => undefined);
    return run;
  }, []);

  const onName = useCallback((value: string) => {
    setTyped(value); setFailed(false);
    if (timer.current !== null) window.clearTimeout(timer.current);
    const trimmed = value.trim();
    /* AN EMPTY NAME IS NOT A RENAME. The field may be empty while somebody
       clears it to type a new one; writing that would blank the account
       between two keystrokes. */
    if (!trimmed || trimmed === (lastSent.current ?? live.current.accountName)) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const mine = ++nameToken.current;
      lastSent.current = trimmed;
      setNameBusy(true);
      void enqueue(() => live.current.updateName(trimmed, wantedLocale.current))
        .then(
          /* Hand the field back to the account's name ONLY if it still holds
             what was sent: whatever was typed while the write was out stays. */
          () => { if (mine === nameToken.current) setTyped(current => (current === value ? null : current)); },
          () => {
            if (mine !== nameToken.current) return;
            /* the account did not change, so "last sent" is not a fact any
               more — the next comparison is with the account again */
            lastSent.current = null;
            setFailed(true);
          },
        )
        .finally(() => { if (mine === nameToken.current) setNameBusy(false); });
    }, live.current.settleMs);
  }, [enqueue]);

  const onLocale = useCallback((next: SupportedLocale) => {
    const mine = ++localeToken.current;
    wantedLocale.current = next;
    localePending.current += 1;
    setLocaleBusy(true); setFailed(false);
    void enqueue(() => live.current.updateLocale(next))
      .then(undefined, () => { if (mine === localeToken.current) setFailed(true); })
      .finally(() => {
        localePending.current -= 1;
        if (mine === localeToken.current) setLocaleBusy(false);
      });
  }, [enqueue]);

  return { name: typed ?? input.accountName, nameBusy, localeBusy, failed, onName, onLocale };
}
