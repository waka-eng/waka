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
 */
import type { ApiReading } from "../lib/api";
import { DialogSurface } from "./DialogSurface";
import { useOptionalAuth } from "../lib/auth-context";
import { normalizeSupportedLocale, t } from "../lib/locales";
import { asSentence } from "../lib/words";

export interface ReadingPanelProps {
  /** null until the fetch lands; the panel says it is still being fetched */
  reading: ApiReading | null;
  onClose: () => void;
}

export function ReadingPanel({ reading, onClose }: ReadingPanelProps): JSX.Element {
  const locale = normalizeSupportedLocale(useOptionalAuth()?.profile?.preferredLocale);
  return (
    <DialogSurface className="jar-roomform jar-reading" data-jar-chrome="1"
      aria-label={t(locale, "worldHowItReadsYou")} onClose={onClose}>
      <div className="jar-label" style={{ marginBottom: 14 }}>
        {t(locale, "worldHowItReadsYou")}
      </div>
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
      <p className="jar-ask" style={{ marginTop: 14 }}>
        <button type="button" onClick={onClose}>
          {t(locale, "worldClose")}
        </button>
      </p>
    </DialogSurface>
  );
}
