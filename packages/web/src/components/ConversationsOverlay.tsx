/**
 * YOUR CONVERSATIONS — a sidebar down the left, grouped by the day.
 *
 * Founder: "where do I see all my past chat history is unclear."
 *
 * It was genuinely unreachable for a while. A conversation could be started
 * two ways — from the box, and from the receipt after a save — and both of
 * them START one. Nothing led back. Every conversation this product had ever
 * held was one URL away and no door away, which is the same as not existing.
 *
 * SO IT IS A LIST, NOT A SHORTCUT. A control that opened a blank conversation
 * would have been a third way to begin and still no way to return. What a
 * person wants here is almost always "the one about X, from last week" — so
 * the list is the surface and starting a new one is its first row.
 *
 * WHY A SIDEBAR AND NOT THE CENTRED SHEET THE OTHER TWO USE.
 *
 * Founder: "When clicking on the top left chat icon, let's open up a left
 * sidebar to show the past chats. And let's just like follow basically what
 * we have in the cloud like this" — with a reference showing a left rail
 * grouped Oct 8 / Oct 7 / Oct 6 / Older.
 *
 * Your inspirations and your principles are things you HOLD UP and read, so
 * they open centred over the world: a grid and a set of cards both want the
 * middle of the screen and both are a destination in themselves. A
 * conversation list is not read, it is SCANNED — you arrive already knowing
 * you want "the one about X, from last week" — and a list you scan wants to
 * be tall and narrow and off to one side, beside the thing you are about to
 * bring it back into rather than on top of it.
 *
 * It is also the shape every chat history anyone has used already has, which
 * is the entire argument: a person who has opened one before knows where
 * their own conversation went without being taught.
 *
 * GROUPED BY DAY, BECAUSE THAT IS HOW THE QUESTION IS ASKED. Nobody looks for
 * a conversation by its title; they look for it by WHEN — "that was Tuesday".
 * The rows stop carrying their own date because the heading above them does,
 * which also gets a date off every single line of a list whose job is to be
 * scanned quickly.
 */
import { useEffect, useRef, useState } from "react";

import { deleteConversation, listConversations, type ConversationSummary } from "../lib/api/conversations";
import { DialogSurface } from "./DialogSurface";
import { t, type SupportedLocale } from "../lib/locales";

type Phase = "loading" | "ready" | "failed";

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
  }, [profileId]);

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
              ? when.toLocaleDateString(locale, { month: "short", day: "numeric" })
              : say("worldChatsOlder");
      const last = out[out.length - 1];
      if (last && last.label === label) last.rows.push(row);
      else out.push({ label, rows: [row] });
    }
    return out;
  })();

  /* ═══ IT IS A PAGE NOW, NOT A RAIL ═══════════════════════════════════
     Founder: "conversation still opens the side panel first", in a list of
     corrections whose through-line is that the four places in the dock should
     be four pages of the same kind.

     The rail's own argument — a list you SCAN wants to be tall and narrow and
     off to one side, beside the thing you are about to bring it back into —
     was good while this list was reached from a corner icon over a world you
     were still standing in. It is a dock destination now, beside three other
     dock destinations, and arriving at one of four peers by a different
     mechanism from the other three is the inconsistency being reported. The
     grouping by day, which is the part that made the rail work, is kept
     exactly as it was. */
  return (
    <div className="waka-page">
      <DialogSurface className="waka-over" aria-label={title} onClose={onClose}>
        <header className="waka-over-head">
          <h2 className="waka-over-title">{title}</h2>
          <button type="button" className="waka-over-close" aria-label={say("worldCardClose")} onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
              <path d="M2 2l8 8M10 2l-8 8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {/* Starting one is the first row, not a separate control: it is the
            same act as opening an old one, aimed at a conversation that does
            not exist yet. The dock's plus offers the same move from anywhere;
            this one is here because a person already looking at their past
            conversations should not have to travel to start another. */}
        <button type="button" className="waka-rail-new" onClick={() => onOpen(null)}>
          {say("worldConversationNew")}
        </button>

        {phase === "loading" ? (
          <p className="waka-over-status" role="status">{say("worldChatLoading")}</p>
        ) : phase === "failed" ? (
          <p className="waka-over-status" role="alert">{say("worldChatHistoryFailed")}</p>
        ) : rows.length === 0 ? (
          /* Honest rather than empty: nothing has been talked about, which is
             a fact and not a failure. */
          <p className="waka-over-status">{say("worldConversationFirst")}</p>
        ) : (
          <nav className="waka-rail-list" aria-label={title}>
            {groups.map((group) => (
              <section key={group.label}>
                <h3 className="waka-rail-day jar-label">{group.label}</h3>
                <ul>
                  {group.rows.map((row) => (
                    <li key={row.id} className="waka-rail-item">
                      <button type="button" className="waka-rail-row" onClick={() => onOpen(row.id)}>
                        {/* THE FIRST LINE THAT HAS WORDS IN IT, with the
                            markdown stripped. A preview is for recognising
                            which conversation this is, and a leading blank
                            line or a stray backtick spends that recognition
                            on punctuation. */}
                        {row.preview.trim()
                          ? row.preview
                              .split(/\r?\n/)
                              .find((line) => line.trim())!
                              .replace(/[*`]/g, "")
                              .slice(0, 80)
                          : say("worldConversationNew")}
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
