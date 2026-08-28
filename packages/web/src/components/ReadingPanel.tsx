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

export interface ReadingPanelProps {
  /** null until the fetch lands; the panel says it is still being fetched */
  reading: ApiReading | null;
  onClose: () => void;
}

export function ReadingPanel({ reading, onClose }: ReadingPanelProps): JSX.Element {
  return (
    <div className="jar-roomform jar-reading" data-jar-chrome="1">
      <div className="jar-label" style={{ marginBottom: 14 }}>
        how it reads you
      </div>
      {reading ? (
        <>
          {reading.sentences.map((sentence) => (
            <p key={sentence} className="jar-reading-line">
              {sentence}
            </p>
          ))}
          {reading.coda ? (
            <p className="jar-reading-coda jar-label">{reading.coda}</p>
          ) : null}
        </>
      ) : (
        <p className="jar-reading-line">still fetching the reading…</p>
      )}
      <p className="jar-ask" style={{ marginTop: 14 }}>
        <button type="button" onClick={onClose}>
          close
        </button>
      </p>
    </div>
  );
}
