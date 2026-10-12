/**
 * ═══ WHAT THIS CONVERSATION IS ABOUT ════════════════════════════════════
 *
 * Founder: "I guess we could — let's have the right panel to show the
 * inspiration while you're chatting about it, and then let the user switch
 * inspirations while chatting about it." And, sharpening it: "I basically
 * want to have a good experience where user can pick an inspiration on the
 * right and then like chat about it, and then when the user specifically
 * brings that up then the agent can read it."
 *
 * THE SECOND SENTENCE IS THE WHOLE DESIGN. A panel that only DISPLAYS an
 * inspiration is decoration — you can already read your archive one press
 * away. What makes this worth building is that picking one changes what
 * the reply is allowed to read: the chosen keep is pinned into the reply's
 * sources rather than left to semantic retrieval's luck.
 *
 * So this is a CONTEXT PICKER that happens to show what it picked, not a
 * preview that happens to be beside a chat.
 *
 * ── WHY IT IS NOT A SECOND ARCHIVE ───────────────────────────────────────
 *
 * The obvious build is to put the archive in a sidebar: chapters, search,
 * ordinals, the lot. That would be the third surface in this product
 * listing the same rows, and the founder's standing rule — "only the most
 * absolutely necessary things should be shown" — has already removed one
 * duplicate list this week.
 *
 * What a person needs HERE is narrower: find one keep, by remembering a
 * few of its words. So the resting state is the most recent handful and a
 * field; there are no chapters, no ordinals, no categories and no tabs.
 * The archive remains the place you browse.
 *
 * ── WHAT IT LOOKS LIKE WHEN NOTHING IS PICKED ────────────────────────────
 *
 * Not an empty frame with a heading. A conversation with nothing pinned is
 * the ORDINARY case — WAKA answers from everything you have saved, which
 * is the product's actual claim — so the resting panel says that in one
 * line and offers the picker. Pinning is the exception, and the exception
 * is what gets the words.
 *
 * ── CLOSED UNTIL ASKED FOR ───────────────────────────────────────────────
 *
 * Founder: "the default should be that inspiration drawer is closed, but
 * the user can open it if they want."
 *
 * THIS OVERRULES THE FIRST BUILD, which had it permanently open and argued
 * that "a collapse toggle would be a control for hiding a column that
 * already yields its space when the window is small". That reasoning was
 * about SPACE and the objection is about ATTENTION: a chat is a page with
 * one thing on it, and a column of your own archive sitting beside every
 * conversation is a second thing to read whether or not you came to pick
 * anything. Most conversations never pin.
 *
 * THE TRIGGER IS IN THE COMPOSER'S FOOTER, at the start, opposite the send
 * actions. That row is the reference library's slot for contextual
 * controls, and it is the right place for a reason beyond convention: what
 * this panel changes is what the NEXT message can draw on, so the control
 * belongs where the next message is being written. It also means the
 * pinned keep is visible while typing without the panel being open —
 * the trigger carries its lead line, which is the chip the reference's
 * composer drawer uses for exactly this.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { loadInspirations, type Inspiration } from "../lib/data";
import { dateWords } from "../lib/words";
import { t, type SupportedLocale } from "../lib/locales";

export interface ChatAsideProps {
  locale: SupportedLocale;
  /** Closed by default; the composer's footer carries the trigger. */
  open: boolean;
  onClose: () => void;
  /** Whose archive to offer. The caller knows; this must never work it out. */
  profileId?: string | null;
  /** The keep this conversation is pinned to, if any. */
  pinned: { id: string; text: string } | null;
  /** Pin a keep, or clear the pin with `null`. */
  onPin: (id: string | null) => void;
  /** True while a pin is being written, so the list cannot be raced. */
  busy?: boolean;
}

/** How many keeps the resting panel offers before you have to search. */
const AT_REST = 8;

export function ChatAside({ locale, open, onClose, profileId, pinned, onPin, busy }: ChatAsideProps): JSX.Element | null {
  const say = useCallback((key: Parameters<typeof t>[1]) => t(locale, key), [locale]);
  const [rows, setRows] = useState<Inspiration[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const alive = useRef(true);

  /* LOADED ONCE, WHEN THE PANEL IS FIRST ON SCREEN. The archive is read
     through `loadInspirations` rather than the HTTP client for the reason
     that module's own note gives: it follows the cursor and translates the
     rows, and a second reader of layer 1 is a second thing that can
     disagree with the archive about what is in it. */
  useEffect(() => {
    if (!open) return;
    alive.current = true;
    loadInspirations(profileId ?? undefined)
      .then((field) => { if (alive.current) setRows(field.inspirations); })
      .catch(() => { if (alive.current) setFailed(true); });
    return () => { alive.current = false; };
  }, [open, profileId]);

  /* THE SAME CASE-FOLDED SUBSTRING THE ARCHIVE USES, over the preview —
     matching text a person cannot see would return rows with no visible
     reason for being there. */
  const needle = query.trim().toLowerCase();
  const shown = useMemo(() => {
    const all = rows ?? [];
    const hits = needle ? all.filter((row) => row.preview.toLowerCase().includes(needle)) : all;
    return needle ? hits : hits.slice(0, AT_REST);
  }, [rows, needle]);

  const now = useMemo(() => Date.now(), [rows]);

  if (!open) return null;

  return (
    <aside className="chat-aside" aria-label={say("worldChatAboutTitle")}>
      {/* THE WAY OUT IS ON THE PANEL, not only on the trigger that opened
          it. On a narrow screen this covers the transcript, and a surface
          that covers what you were reading has to say how to get back —
          Law 2, which this product has a gate for. */}
      <button type="button" className="chat-aside-close" onClick={onClose}>
        {say("worldChatAboutClose")}
      </button>
      {pinned ? (
        /* ═══ PINNED: THE KEEP ITSELF, AND ONE WAY TO CHANGE IT ══════════
           The words are the panel. No card, no border, no heading above
           them repeating what the label already says — the same blank-page
           treatment an opened note gets, at this column's width. */
        <div className="chat-aside-pinned">
          <p className="chat-aside-label">{say("worldChatAboutTitle")}</p>
          <p className="chat-aside-text">{pinned.text}</p>
          {/* ONE CONTROL, AND IT UNPINS. Changing to a different keep is
              unpinning and picking again — two presses for a rare act,
              against a permanently-open picker under a permanently-open
              keep, which is the panel trying to be two things. */}
          <button type="button" className="chat-aside-unpin" disabled={busy} onClick={() => onPin(null)}>
            {say("worldChatAboutClear")}
          </button>
        </div>
      ) : (
        <>
          {/* THE ORDINARY CASE, SAID PLAINLY. Nothing pinned is not an
              empty state — it is WAKA reading from everything, which is
              what this product promises on its own door. */}
          <p className="chat-aside-label">{say("worldChatAboutNone")}</p>
          {failed ? (
            <p className="chat-aside-note" role="alert">{say("worldInspirationsFail")}</p>
          ) : rows === null ? (
            <p className="chat-aside-note" role="status">{say("worldInspirationsLoad")}</p>
          ) : rows.length === 0 ? (
            <p className="chat-aside-note">{say("worldInspirationsEmpty")}</p>
          ) : (
            <>
              {/* THE FIELD APPEARS ONLY WHEN THERE IS MORE THAN THE PANEL
                  SHOWS. Below that the list IS the search — the same
                  threshold argument the archive's own field makes. */}
              {rows.length > AT_REST ? (
                <label className="chat-aside-find">
                  <span className="sr-only">{say("worldInspirationsSearch")}</span>
                  <input type="search" value={query} placeholder={say("worldInspirationsSearch")}
                    onChange={(event) => setQuery(event.currentTarget.value)} />
                </label>
              ) : null}
              {shown.length === 0 ? (
                <p className="chat-aside-note">{say("worldInspirationsNoHits")}</p>
              ) : (
                <ul className="chat-aside-rows">
                  {shown.map((row) => {
                    const words = row.preview.trim();
                    const breakAt = words.indexOf("\n");
                    const lead = (breakAt > 0 ? words.slice(0, breakAt) : words).trim();
                    return (
                      <li key={row.id}>
                        <button type="button" disabled={busy} onClick={() => onPin(row.id)}>
                          <span className="chat-aside-lead">{lead}</span>
                          <span className="chat-aside-when">{dateWords(row.capturedMs, now, locale)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </aside>
  );
}
