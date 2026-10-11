/**
 * TALKING, AND EVERYTHING YOU HAVE TALKED ABOUT.
 *
 * Founder: "where do I see all my past chat history is unclear. Maybe the top
 * left button should be a chat button that shows the past chats."
 *
 * It was genuinely unreachable. A conversation could be started two ways —
 * from the box, and from the receipt after a save — and both of them START
 * one. Nothing led back. Every conversation this product has ever held was
 * one URL away and no door away, which is the same as not existing.
 *
 * SO THE CORNER IS A LIST, NOT A SHORTCUT. A button that opened a blank
 * conversation would have been a third way to begin and still no way to
 * return. What a person wants from this corner is almost always "the one
 * about X, from last week" — so the list is the control and starting a new
 * one is its first row.
 *
 * AND IT DOES NOT TAKE THE CORNER FROM ROOMS. Switching between me and my
 * agent moved onto the creature, where identity belongs; when rooms come back
 * they are places, which is the view switcher's question, not this one. See
 * the note where the form switch is rendered.
 */
import { useEffect, useRef, useState } from "react";

import { listConversations, type ConversationSummary } from "../lib/api/conversations";
import { DialogSurface } from "./DialogSurface";
import { t, type SupportedLocale } from "../lib/locales";

type Phase = "idle" | "loading" | "ready" | "failed";

export function ChatCorner({
  locale,
  profileId,
  onOpen,
}: {
  locale: SupportedLocale;
  /** Whose conversations — the stance, so an agent's talks are its own. */
  profileId: string | null | undefined;
  onOpen: (conversationId: string | null) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ConversationSummary[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  /* Fetched on OPEN, never on mount: this sits on every screen, and a list
     nobody has asked for is a request every page load pays for. */
  useEffect(() => {
    if (!open || !profileId) return;
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
  }, [open, profileId]);

  const say = (key: Parameters<typeof t>[1]) => t(locale, key);

  return (
    <span className="waka-corner-place">
      <button
        type="button"
        className="waka-corner"
        aria-label={say("worldConversationHistory")}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {/* A speech bubble: the corner is one act, so the glyph says which
            act rather than "there is more". */}
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            d="M17 11.5a2.5 2.5 0 0 1-2.5 2.5H8.2L4.5 16.8a.4.4 0 0 1-.64-.32V14h-.36A2.5 2.5 0 0 1 1 11.5v-7A2.5 2.5 0 0 1 3.5 2h11A2.5 2.5 0 0 1 17 4.5z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </button>

      {open ? (
        <DialogSurface
          className="waka-chats"
          aria-label={say("worldConversationHistory")}
          onClose={() => setOpen(false)}
        >
          <header>
            <h2 className="jar-label">{say("worldConversationHistory")}</h2>
            <button type="button" onClick={() => setOpen(false)}>
              {say("worldClose")}
            </button>
          </header>

          {/* Starting one is the first row, not a separate control: it is the
              same act as opening an old one, aimed at a conversation that
              does not exist yet. */}
          <button
            type="button"
            className="waka-chats-new"
            onClick={() => {
              setOpen(false);
              onOpen(null);
            }}
          >
            {say("worldConversationNew")}
          </button>

          {phase === "loading" ? (
            <p role="status">{say("worldChatLoading")}</p>
          ) : phase === "failed" ? (
            <p role="alert">{say("worldChatHistoryFailed")}</p>
          ) : rows.length === 0 ? (
            /* Honest rather than empty: nothing has been talked about, which
               is a fact and not a failure. */
            <p>{say("worldConversationFirst")}</p>
          ) : (
            <nav aria-label={say("worldConversationHistory")}>
              <ul>
                {rows.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onOpen(row.id);
                      }}
                    >
                      <span>
                        {row.preview.trim()
                          ? row.preview
                              .split(/\r?\n/)
                              .find((line) => line.trim())!
                              .replace(/[*`]/g, "")
                              .slice(0, 80)
                          : say("worldConversationNew")}
                      </span>
                      <time dateTime={row.updatedAt}>
                        {new Date(row.updatedAt).toLocaleDateString(locale, {
                          month: "short",
                          day: "numeric",
                        })}
                      </time>
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </DialogSurface>
      ) : null}
    </span>
  );
}
