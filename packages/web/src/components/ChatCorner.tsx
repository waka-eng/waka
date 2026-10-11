/**
 * CHAT HISTORY — the left corner, and one press.
 *
 * Founder: "top left button should be chat history since moving between
 * inspirations, top of mind, principles is done with the middle center
 * dropdown (that should restore these 3 options)."
 *
 * This corner has been an agent switcher, then chat, then a three-row menu of
 * things to open, and now chat again — and the churn was not indecision, it
 * was the centre and the creature settling first. Conversations are not a
 * DEPTH of your own material (which is what the centre's three rows are) and
 * not an OWNER (which is what the creature's two faces are). They are a
 * history. Nothing else in the chrome answers that question, which is exactly
 * why they kept being squeezed into controls shaped for the other two.
 *
 * ONE PRESS, NOT A LIST, because it was a list for one commit and that was a
 * level too many: pressing a corner to get a menu to get a list of
 * conversations is two presses to reach a list, and the second press was
 * always "the one about X, from last week". The corner opens the
 * conversations overlay directly, and the list IS that overlay — where
 * starting a new one is its first row, because beginning is the same act as
 * opening an old one, aimed at a conversation that does not exist yet.
 *
 * WHAT IT WILL HAVE TO MAKE ROOM FOR. Founder: "I want to add the social
 * feature back soon." Rooms are places, which is the centre's axis, not this
 * corner's question — so they arrive without displacing anything here.
 */
import { t, type SupportedLocale } from "../lib/locales";

export function ChatCorner({ locale, onOpen }: {
  locale: SupportedLocale;
  /** Holds the conversations list up over the world. */
  onOpen: () => void;
}): JSX.Element {
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  return (
    <span className="waka-corner-place">
      <button
        type="button"
        className="waka-corner"
        aria-label={say("worldOpenConversations")}
        onClick={onOpen}
      >
        {/* A SPEECH BUBBLE: the corner is one act, so the glyph says which act
            rather than "there is more". It was three stacked sheets while this
            was a menu of three things, which was honest then and would be a
            lie now. */}
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
    </span>
  );
}
