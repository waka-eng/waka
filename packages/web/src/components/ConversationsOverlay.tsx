/**
 * YOUR CHATS — one of four destinations, wearing what the other three wear.
 *
 * Founder: "where do I see all my past chat history is unclear."
 *
 * It was genuinely unreachable for a while. A conversation could be started
 * two ways — from the box, and from the receipt after a save — and both of
 * them START one. Nothing led back. Every conversation this product had ever
 * held was one URL away and no door away, which is the same as not existing.
 *
 * IT WAS A LEFT SIDEBAR, AND THE HEADER SAYING SO OUTLIVED IT BY TWO
 * REWRITES. The argument was good at the time — a list you SCAN wants to be
 * tall and narrow and off to one side, beside the thing you are about to
 * bring it back into — and it stopped being true the moment this became one
 * of four peers in the dock. Founder: "conversation still opens the side
 * panel first." The rail's geometry went then. Its TYPE did not, which is
 * why this file is being edited again: the two lists in the bar were still
 * disagreeing about every measurable property a list row has.
 *
 * Founder, this time: "chat and inspirations should have same look and feel
 * and workflow and experience."
 *
 * So the row is `SavesOverlay`'s row — `.waka-list-*`, lead line and then
 * its meta — and what is left here is only what a chat genuinely has that a
 * save does not.
 *
 * GROUPED BY DAY, BECAUSE THAT IS HOW THE QUESTION IS ASKED. Nobody looks
 * for a conversation by its title; they look for it by WHEN — "that was
 * Tuesday". This is the one part of the rail that was never about being a
 * rail, and it is kept exactly as it was: the archive groups by chapter
 * because a save is remembered by roughly how long ago, a chat by the day
 * it happened on.
 */
import { useEffect, useRef, useState } from "react";

import { deleteConversation, listConversations, type ConversationSummary } from "../lib/api/conversations";
import { DialogSurface } from "./DialogSurface";
import { t, type SupportedLocale } from "../lib/locales";
import { dateWords, timeOf } from "../lib/words";

type Phase = "loading" | "ready" | "failed";

/* THE SAME TWO LINES THE ARCHIVE'S ROW IS MADE OF, read off a conversation
   rather than off a save. `SavesOverlay` splits a kept thing at its first
   newline — the first line is the title nobody had to write, the rest is the
   second line — and a transcript preview answers to exactly that shape once
   the markdown is off it. One anatomy, two readers. */
function plain(row: ConversationSummary): string[] {
  return row.preview
    /* `\u0060` IS A BACKTICK, written as an escape on purpose.
       `scripts/check-vocabulary.mjs` hand-scans this file for identifiers and
       treats a bare backtick as the start of a template literal — which, for
       one inside a character class, means it blanks everything up to the next
       backtick anywhere in the file and then reads prose out of a comment as
       code. The escape is the same character to the regex engine and not a
       delimiter to the scanner. */
    .replace(/[*\u0060]/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function lead(row: ConversationSummary): string {
  return plain(row)[0]?.slice(0, 80) ?? "";
}

function rest(row: ConversationSummary): string {
  return plain(row).slice(1).join(" ");
}

/**
 * THE HOUR, which is the only thing that tells two chats on one day apart —
 * the heading above them has already said which day it was.
 *
 * `timeOf` RATHER THAN THIS FILE'S OWN `toLocaleTimeString`. The two agreed,
 * character for character, in both languages on the day this was changed —
 * which is exactly why it was worth changing. `timeOf` delegates to `Intl`
 * for English and hand-builds the Korean (`오전 7:05`), and the hand-built
 * string happening to match the platform's is a coincidence of today's ICU,
 * not a property this project holds. The transcript's own timestamps already
 * come from `timeOf`; a chat row and a chat message printing the same minute
 * two different ways is the drift this import makes impossible.
 *
 * WHAT STAYS LOCAL: that an unparseable `updatedAt` yields an empty string
 * rather than a phrase. That is a decision about a broken row on this list,
 * not about how this world says a time.
 */
function clock(row: ConversationSummary, locale: SupportedLocale): string {
  const when = new Date(row.updatedAt);
  return Number.isNaN(when.getTime()) ? "" : timeOf(when.getTime(), locale);
}

export function ConversationsOverlay({ locale, profileId, title, onClose, onOpen }: {
  locale: SupportedLocale;
  /** Whose conversations — so an agent's talks are its own. */
  profileId: string | null | undefined;
  title: string;
  onClose: () => void;
  onOpen: (conversationId: string | null) => void;
}): JSX.Element {
  const [rows, setRows] = useState<ConversationSummary[]>([]);
  const [phase, setPhase] = useState<Phase>("loading");
  /**
   * ERASING ONE — asked on the row, never on the row's own press.
   *
   * This verb had no home in the product at all for a while. It used to live
   * in a `···` menu inside the conversation you were reading, which the chat
   * sweep removed for a good reason the founder gave: "so many different
   * buttons that I have no idea what its supposed to do" — and inside the
   * thing you are reading, "delete" sits one slip away from "send".
   *
   * It belongs here, beside the row it would remove, and it asks first. The
   * ask is INLINE rather than a sheet: a sheet over a list makes you lose
   * your place in the list to answer a question about one line of it, and
   * `worldDeleteItAnyway` is already this product's word for the second
   * press. `failed` is per-row because a failure belongs beside the thing
   * that failed, and because the honest message is "it is still here" —
   * which is only true of one row.
   */
  const [asking, setAsking] = useState<string | null>(null);
  const [going, setGoing] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const live = useRef(true);
  /* BUMPED BY "Try again". The list is fetched by the effect below, so a
     retry is that effect running again rather than a second copy of it. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  /* Fetched when this opens, which is now the only time it exists. As a
     corner sheet it sat mounted on every screen and had to be careful not to
     fetch a list nobody had asked for; an overlay is unmounted until asked
     for, so the care is structural. */
  useEffect(() => {
    if (!profileId) return;
    const controller = new AbortController();
    setPhase("loading");
    void listConversations(profileId, controller.signal)
      .then((body) => {
        if (!live.current || controller.signal.aborted) return;
        setRows(body.conversations);
        setPhase("ready");
      })
      .catch(() => {
        if (live.current && !controller.signal.aborted) setPhase("failed");
      });
    return () => controller.abort();
  }, [profileId, attempt]);

  const say = (key: Parameters<typeof t>[1]) => t(locale, key);

  /**
   * TODAY, YESTERDAY, THE DAY ITSELF, THEN OLDER.
   *
   * Named days for the week a person can still place from memory, the date
   * for the rest of the recent past, and one bucket beyond it — because past
   * a week "the 14th" stops being a memory and starts being a lookup, and a
   * heading nobody can use is a line of noise between two rows they can.
   *
   * Built once per render from the rows themselves, so a day with nothing in
   * it never appears — the headings describe what is there rather than a
   * calendar the list is being fitted into.
   */
  const groups = (() => {
    const startOfDay = (value: Date): number =>
      new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
    const today = startOfDay(new Date());
    const out: Array<{ label: string; rows: ConversationSummary[] }> = [];
    for (const row of rows) {
      const when = new Date(row.updatedAt);
      const daysAgo = Number.isNaN(when.getTime())
        ? Number.POSITIVE_INFINITY
        : Math.round((today - startOfDay(when)) / 86_400_000);
      const label =
        daysAgo <= 0
          ? say("worldChatsToday")
          : daysAgo === 1
            ? say("worldChatsYesterday")
            : daysAgo <= 7
              /* `dateWords` RATHER THAN A FOURTH OPTION BAG. This heading
                 printed `Oct 11` / `10월 11일` out of its own
                 `toLocaleDateString`, which is the same string `dateWords`
                 returns — so nothing a person sees moves, and the phrasing
                 stops being this file's to get wrong.

                 AND NOT `dateStamp`, WHICH WAS THE SUGGESTION. That one
                 always carries its year ("Oct 11, 2026") because a memory
                 product's dates are read across years. A heading over chats
                 from inside the last week is the one place that argument does
                 not reach: the year is never in doubt there, every heading on
                 screen would wear the same one, and the paragraph above this
                 block is about headings a person can USE — "past a week 'the
                 14th' stops being a memory and starts being a lookup". A
                 year printed four times down a list nobody needs it in is
                 the same noise, one rung smaller. `dateWords` is the
                 function whose stated rule is "the year is only there when it
                 is not this one", which is this heading's rule exactly. */
              ? dateWords(when.getTime(), today, locale)
              : say("worldChatsOlder");
      const last = out[out.length - 1];
      if (last && last.label === label) last.rows.push(row);
      else out.push({ label, rows: [row] });
    }
    return out;
  })();

  return (
    <div className="waka-page">
      {/* A PAGE, NOT A DIALOG — `modal={false}`. The bar's "Chats" row is
          what this list is reached by and what it is left by; it was
          declaring `aria-modal` over that row, so a screen reader was told
          the row did not exist and Tab wrapped back into the list rather
          than walking out to it. See `DialogSurface`'s header: the exemption
          in `test/way-out.test.ts` rests on the bar being reachable, and
          until this prop it was not. Nothing else about this surface
          changes — Escape still leaves, and there is no scrim to press
          away on, because `.waka-page` is the ground rather than a film
          over one. */}
      <DialogSurface className="waka-over" motion="modal" aria-label={title} modal={false} onClose={onClose}>
        <header className="waka-over-head">
          <h2 className="waka-over-title">{title}</h2>
        </header>

        {/* "NEW CHAT" WAS A BORDERED PILL AT THE TOP OF THIS ONE SURFACE,
            and it is gone. Its argument — "nothing led back, so starting one
            is the first row" — was written when this list was unreachable
            and a conversation could only ever be begun, never found. The
            dock's plus offers both things this product makes, from every
            screen, which is the general answer that argument was asking for.
            It was also the only boxed control on any of the four
            destinations: one surface in four wearing a button nobody else
            wears is the inconsistency the founder reported, in miniature. */}
        {phase === "loading" ? (
          <p className="waka-over-status" role="status">{say("worldChatLoading")}</p>
        ) : phase === "failed" ? (
          /* A FAILURE WITH A WAY ON. This sentence used to be the whole
             screen, and the only thing that could ever change it was leaving
             and coming back — which is a retry the person has to invent. */
          <>
            <p className="waka-over-status" role="alert">{say("worldChatHistoryFailed")}</p>
            <button type="button" className="waka-over-retry" onClick={() => setAttempt((n) => n + 1)}>
              {say("worldRetry")}
            </button>
          </>
        ) : rows.length === 0 ? (
          /* Honest rather than empty: nothing has been talked about, which is
             a fact and not a failure. AND THE QUESTION IS A DOOR NOW. "What
             would you like to explore?" was asked over a page with nowhere
             to type an answer — the dock's plus could start one, but nothing
             under the question said so. `onOpen(null)` is the same new chat
             that plus opens. */
          <>
            <p className="waka-over-status">{say("worldConversationFirst")}</p>
            <button type="button" className="waka-over-new" onClick={() => onOpen(null)}>
              {say("worldConversationNew")}
            </button>
          </>
        ) : (
          /* ═══ THE SAME LIST THE ARCHIVE IS ═══════════════════════════
              Founder: "chat and inspirations should have same look and feel
              and workflow and experience."

              This wore `.waka-rail-*` — the register of a left sidebar that
              was deleted when this became one of four peer destinations —
              so the two lists disagreed about the size, the weight, the
              casing and the ground of every part they both have. They share
              `.waka-list-*` now, and the row has the anatomy the archive's
              row has: the line you recognise it by, and under it the facts
              that tell you whether this is the one.

              WHAT IS STILL ITS OWN, because a chat is not a save: the
              headings are days rather than chapters (nobody looks for a
              conversation by "Previous 30 Days"), there is no ordinal
              (a conversation is not a numbered thing you collected), and
              a row can be erased. */
          <nav className="waka-list" aria-label={title}>
            {groups.map((group) => (
              <section key={group.label} className="waka-list-chapter">
                <h3 className="waka-list-when">{group.label}</h3>
                <ul className="waka-list-rows">
                  {group.rows.map((row) => (
                    <li key={row.id} className="waka-rail-item">
                      <button type="button" className="waka-list-row" onClick={() => onOpen(row.id)}>
                        {/* THE FIRST LINE THAT HAS WORDS IN IT, with the
                            markdown stripped. A preview is for recognising
                            which conversation this is, and a leading blank
                            line or a stray backtick spends that recognition
                            on punctuation. */}
                        <span className="waka-list-lead">
                          {lead(row) || say("worldConversationNew")}
                        </span>
                        {/* THE SECOND LINE IS THE ONE THAT DECIDES IT, the
                            same as in the archive: when, and then whatever
                            did not fit on the first line. The day heading
                            carries the date, so this carries the time —
                            which is the thing that distinguishes two chats
                            on one day, and the only reason this list ever
                            needed a second line. */}
                        <span className="waka-list-meta">
                          <span className="waka-list-date">{clock(row, locale)}</span>
                          {rest(row) ? <span className="waka-list-rest">{rest(row)}</span> : null}
                        </span>
                      </button>
                      {/* ERASING ONE, ASKED ON THE ROW. This verb had no home
                          in the product at all for a while: it lived in a
                          `···` menu inside the conversation you were reading,
                          where "delete" sits one slip from "send", and the
                          sweep that cut that menu left the capability
                          homeless. It belongs beside the row it removes, and
                          it asks first — inline, because a sheet over a list
                          makes you lose your place in the list to answer a
                          question about one line of it. */}
                      {asking === row.id ? (
                        <span className="waka-rail-ask">
                          {failed === row.id ? (
                            <span className="waka-rail-warn">{say("worldDeleteFailed")}</span>
                          ) : null}
                          <button
                            type="button"
                            className="waka-rail-go"
                            disabled={going === row.id}
                            onClick={() => {
                              setGoing(row.id);
                              setFailed(null);
                              void deleteConversation(profileId!, row.id)
                                .then(() => {
                                  /* The list holds what was loaded, so it has
                                     to agree without a refetch — otherwise the
                                     row you just removed is still sitting
                                     there. */
                                  setRows((all) => all.filter((item) => item.id !== row.id));
                                  setAsking(null);
                                })
                                .catch(() => setFailed(row.id))
                                .finally(() => setGoing(null));
                            }}
                          >
                            {say(going === row.id ? "worldDeleting" : "worldDeleteItAnyway")}
                          </button>
                          <button type="button" onClick={() => { setAsking(null); setFailed(null); }}>
                            {say("worldNotNow")}
                          </button>
                        </span>
                      ) : (
                        <button type="button" className="waka-rail-del" onClick={() => setAsking(row.id)}>
                          {say("worldDelete")}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </nav>
        )}
      </DialogSurface>
    </div>
  );
}
