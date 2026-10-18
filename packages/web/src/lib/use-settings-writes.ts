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
 * and a name write carries the last language the SERVER ACCEPTED at the
 * moment it is sent — not the one showing when they typed, and not one a
 * language write queued BEHIND it still only wants: that write may yet be
 * refused, and the rename would already have put it on the account.
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
 * write back. "Last sent" is dropped once that write lands — from then on
 * the name the SERVER CONFIRMED is the comparison and what the field shows,
 * because the account's name in the session may not have been re-applied
 * yet — and both are dropped when the account's name changes.
 *
 * A REFUSED LANGUAGE IS NOT CARRIED. Only a language write's success moves
 * the accepted language, and it does so INSIDE the queued task, before the
 * queue moves on — so a rename waiting behind it carries that language, and
 * a refused one is never carried.
 *
 * TWO FAILURE FLAGS. A language write succeeding must not hide a rename
 * that is still failed, and the other way round.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { SupportedLocale } from "./locales";

export interface SettingsWritesInput {
  accountName: string;
  /** The language the account holds now. */
  locale: SupportedLocale;
  /** Writes the name; resolves with the name the server confirmed. */
  updateName: (name: string, preferredLocale: SupportedLocale) => Promise<string | undefined>;
  updateLocale: (preferredLocale: SupportedLocale) => Promise<unknown>;
  /** How long the field must be still before its name is written. */
  settleMs: number;
}

export function useSettingsWrites(input: SettingsWritesInput) {
  const [typed, setTyped] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [nameBusy, setNameBusy] = useState(false);
  const [localeBusy, setLocaleBusy] = useState(false);
  const [nameFailed, setNameFailed] = useState(false);
  const [localeFailed, setLocaleFailed] = useState(false);

  const live = useRef(input);
  live.current = input;
  const chain = useRef<Promise<void>>(Promise.resolve());
  const nameToken = useRef(0), localeToken = useRef(0), localePending = useRef(0), namePending = useRef(0);
  const lastSent = useRef<string | null>(null);
  const confirmedRef = useRef<string | null>(null);
  const acceptedLocale = useRef(input.locale);
  /* With no language write out, the accepted language is the one the account
     holds — which another tab may have changed. */
  if (localePending.current === 0) acceptedLocale.current = input.locale;
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  /* The account's name moved (this write re-applied, or another tab): it is
     the truth again, and nothing remembered here outranks it. */
  useEffect(() => {
    /* NOT while a rename is still out: an OLDER rename landing re-applies the
       account's name while a newer one is queued, and forgetting the newer
       one here would make typing the older name back look like "no change" —
       and the queued rename would then land over it. */
    if (namePending.current > 0) return;
    lastSent.current = null;
    confirmedRef.current = null;
    setConfirmed(null);
  }, [input.accountName]);

  /** Run after every write already queued; never rejects the queue itself. */
  const enqueue = useCallback(<T,>(write: () => Promise<T>): Promise<T> => {
    const run = chain.current.then(write);
    chain.current = run.then(() => undefined, () => undefined);
    return run;
  }, []);

  const onName = useCallback((value: string) => {
    setTyped(value); setNameFailed(false);
    if (timer.current !== null) window.clearTimeout(timer.current);
    const trimmed = value.trim();
    /* AN EMPTY NAME IS NOT A RENAME. The field may be empty while somebody
       clears it to type a new one; writing that would blank the account
       between two keystrokes. */
    if (!trimmed || trimmed === (lastSent.current ?? confirmedRef.current ?? live.current.accountName)) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const mine = ++nameToken.current;
      lastSent.current = trimmed;
      namePending.current += 1;
      setNameBusy(true);
      void enqueue(() => live.current.updateName(trimmed, acceptedLocale.current))
        .then(
          (serverName) => {
            /* Only the NEWEST rename's landing settles what was sent; an older
               one landing while a newer is queued changes nothing here. */
            if (mine !== nameToken.current) return;
            const landed = serverName ?? trimmed;
            lastSent.current = null;
            confirmedRef.current = landed;
            setConfirmed(landed);
            /* Hand the field back ONLY if it still holds what was sent:
               whatever was typed while the write was out stays. */
            setTyped(current => (current === value ? null : current));
          },
          () => {
            if (mine !== nameToken.current) return;
            lastSent.current = null;
            setNameFailed(true);
          },
        )
        .finally(() => {
          namePending.current -= 1;
          if (mine === nameToken.current) setNameBusy(false);
        });
    }, live.current.settleMs);
  }, [enqueue]);

  const onLocale = useCallback((next: SupportedLocale) => {
    const mine = ++localeToken.current;
    localePending.current += 1;
    setLocaleBusy(true); setLocaleFailed(false);
    void enqueue(() => live.current.updateLocale(next).then(
      /* inside the task, so it happens before the queue moves on */
      (result) => { acceptedLocale.current = next; return result; },
    ))
      .then(undefined, () => { if (mine === localeToken.current) setLocaleFailed(true); })
      .finally(() => {
        localePending.current -= 1;
        if (mine === localeToken.current) setLocaleBusy(false);
      });
  }, [enqueue]);

  return {
    name: typed ?? confirmed ?? input.accountName,
    nameBusy,
    localeBusy,
    failed: nameFailed || localeFailed,
    onName,
    onLocale,
  };
}
