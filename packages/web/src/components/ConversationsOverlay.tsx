/**
 * YOUR CONVERSATIONS — everything you have talked about, over the world.
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
 * WHY IT IS AN OVERLAY NOW AND NOT A CORNER SHEET. It spent a while as a
 * dropdown hanging off the top-left corner, which was right about where to
 * reach it from and wrong about what it is. The corner now asks one question
 * — what do you want to open — and your conversations are one of three
 * answers to it, beside your inspirations and your principles. Three things
 * of the same kind have to open the same way, or the corner is a list of
 * three rows where one of them behaves differently for no reason a person
 * could discover. See `components/OpenCorner`.
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

  return (
    <div className="waka-over-scrim" onClick={onClose}>
      <DialogSurface
        className="waka-over"
        aria-label={title}
        onClose={onClose}
        onClick={(event) => event.stopPropagation()}
      >
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
            not exist yet. */}
        <button
          type="button"
          className="waka-over-new"
          onClick={() => onOpen(null)}
        >
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
          <ul className="waka-talks">
            {rows.map((row) => (
              <li key={row.id} className="waka-talks-row">
                  <button type="button" className="waka-talks-open" onClick={() => onOpen(row.id)}>
                    <span className="waka-talks-words">
                      {/* THE FIRST LINE THAT HAS WORDS IN IT, with the markdown
                          stripped. A preview is for recognising which
                          conversation this is, and a leading blank line or a
                          stray backtick spends that recognition on punctuation. */}
                      {row.preview.trim()
                        ? row.preview
                            .split(/\r?\n/)
                            .find((line) => line.trim())!
                            .replace(/[*`]/g, "")
                            .slice(0, 80)
                        : say("worldConversationNew")}
                    </span>
                    <time className="waka-talks-when jar-label" dateTime={row.updatedAt}>
                      {new Date(row.updatedAt).toLocaleDateString(locale, { month: "short", day: "numeric" })}
                    </time>
                  </button>
                  {asking === row.id ? (
                    <span className="waka-talks-ask">
                      {failed === row.id ? (
                        /* PROSE, AND IT SAYS WHAT IS TRUE: the conversation is
                           still here. Beside the verb rather than in a sheet,
                           because nothing happened and nothing needs deciding
                           — pressing again is the whole recovery. */
                        <span className="waka-talks-warn">{say("worldDeleteFailed")}</span>
                      ) : null}
                      <button
                        type="button"
                        className="waka-talks-go"
                        disabled={going === row.id}
                        onClick={() => {
                          setGoing(row.id);
                          setFailed(null);
                          void deleteConversation(profileId!, row.id)
                            .then(() => {
                              /* The list holds what was loaded, so it has to
                                 agree without a refetch — otherwise the row
                                 you just removed is still sitting there. */
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
                    <button type="button" className="waka-talks-del" onClick={() => setAsking(row.id)}>
                      {say("worldDelete")}
                    </button>
                  )}
                </li>
            ))}
          </ul>
        )}
      </DialogSurface>
    </div>
  );
}
