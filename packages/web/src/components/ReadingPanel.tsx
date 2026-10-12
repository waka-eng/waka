/**
 * THE READING — how WAKA reads you, one tap from the poster.
 *
 * The loop's rules as sentences, exactly as `/api/reading.md` serves them —
 * this panel rewords nothing, because the whole point of the surface is that
 * its words are drift-pinned to the code (`the-reading.test.ts`, API side).
 * The vague-explanation research (docs/craft/the-legible-loop.md, finding
 * 8) is why: an explanation disconnected from mechanism costs more trust
 * than silence, so the mechanism is the copy.
 *
 * A chrome panel like the group's own: the world behind it does not move.
 * States render, numerals never — the served sentences carry constants as
 * words, and the panel's own test re-asserts not one digit gets through.
 *
 * ── WHAT CHANGED WHEN IT CAME BACK (2026-10-11) ──────────────────────────
 *
 * It was deleted with `/profile` in the morning and is reached from the "i"
 * in the top corner now, which is the home `SettingsPanel`'s header asked
 * for: "next to the top of mind rather than next to a language picker". The
 * surface itself is unchanged — it was already wearing `--jar-*`, already a
 * `DialogSurface`, already opening over a world that does not move.
 *
 * ITS TWO INLINE MARGINS ARE CSS NOW. `style={{ marginBottom: 14 }}` on the
 * label and `marginTop: 14` on the close were two raw pixel values no gate
 * can see — the type scale reads stylesheets, not JSX — and all three doors
 * carried the same pair. They share a `.jar-machinery` frame instead, which
 * is one rule for one shape and the only place a reader has to look to
 * change the air inside these panels.
 *
 * ITS LOCALE IS NOW A PROP rather than a reach into the auth context. The
 * card that opens it already holds the locale, and a panel that resolves
 * the same question a second way is a second answer that can disagree —
 * which on a surface whose entire claim is "these words are pinned" is the
 * one kind of drift it cannot afford.
 */
import type { ApiReading } from "../lib/api";
import { DialogSurface } from "./DialogSurface";
import { t, type SupportedLocale } from "../lib/locales";
import { asSentence } from "../lib/words";

export interface ReadingPanelProps {
  locale: SupportedLocale;
  /** null until the fetch lands; the panel says it is still being fetched */
  reading: ApiReading | null;
  onClose: () => void;
}

export function ReadingPanel({ locale, reading, onClose }: ReadingPanelProps): JSX.Element {
  return (
    <DialogSurface className="jar-roomform jar-machinery jar-reading" data-jar-chrome="1"
      aria-label={t(locale, "worldHowItReadsYou")} onClose={onClose}>
      <div className="jar-label">{t(locale, "worldHowItReadsYou")}</div>
      {reading ? (
        <>
          {/* ONE PER LINE IS ONE SENTENCE EACH, so each takes a capital.
              The API writes these as clauses, lower case, because they are
              designed to be joined; printed on their own lines they are
              sentences, and the founder's ruling covers every sentence a
              person reads. `capitalized.test.ts` cannot see them — they are
              assembled on the server, not drawn from the catalogue it
              reads. */}
          {reading.sentences.map((sentence) => (
            <p key={sentence} className="jar-reading-line">
              {asSentence(sentence, locale)}
            </p>
          ))}
          {reading.coda ? (
            <p className="jar-reading-coda jar-label">{reading.coda}</p>
          ) : null}
        </>
      ) : (
        <p className="jar-reading-line">{t(locale, "worldStillFetchingReading")}</p>
      )}
      <p className="jar-ask">
        <button type="button" onClick={onClose}>
          {t(locale, "worldClose")}
        </button>
      </p>
    </DialogSurface>
  );
}
