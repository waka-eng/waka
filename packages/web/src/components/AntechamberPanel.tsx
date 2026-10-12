/**
 * THE ANTECHAMBER — the dim place where read-but-not-kept candidates stand.
 *
 * goal: the-legible-loop, Phase 5. Every row here is a suppression record:
 * a candidate the ground refused because it stood too close to something
 * the person dismissed. The delta-view research (docs/craft/
 * the-legible-loop.md, finding 2) names this the single most
 * theory-correcting surface — seeing what the loop did NOT keep is what
 * corrects a person's working theory of the loop.
 *
 * Each refusal names its anchor, and the anchor is reachable: while it
 * still refuses, "put it back" is right there — the same restore verb the
 * sky offers in the seconds after a dismissal, given a permanent home. An
 * anchor that was since put back says so; an anchor that was truly deleted
 * leaves its words as a departed mark, never a dangling id.
 *
 * A chrome panel; the world behind it does not move. The candidates render
 * dim — light is the meaning channel, and these are the sentences that did
 * not come to be.
 *
 * ── WHY IT IS THE ONE DOOR OF THE THREE THAT LAW 11 LIKES ────────────────
 *
 * It shows sentences WAKA wrote about the person and then refused, and the
 * control beside each one is an answer rather than upkeep: "put it back" is
 * the person saying the ground was wrong about them. That is why it came
 * back with `restoreSignal` rather than as a read-only list — a refusal you
 * can only look at is the product telling you about yourself with no way to
 * reply.
 *
 * ── WHAT CHANGED WHEN IT CAME BACK (2026-10-11) ──────────────────────────
 *
 * The locale is a prop now (see `ReadingPanel`'s header for the argument)
 * and the two inline pixel margins are the shared `.jar-machinery` frame.
 * Nothing else: the surface was already wearing the product's material.
 */
import type { ApiAntechamberRow } from "../lib/api";
import { t, type SupportedLocale } from "../lib/locales";
import { DialogSurface } from "./DialogSurface";

export interface AntechamberPanelProps {
  locale: SupportedLocale;
  /** null until the fetch lands */
  rows: ApiAntechamberRow[] | null;
  onClose: () => void;
  /** restore the anchor — the refusals stop; resolves when the server has it */
  onRestoreAnchor: (anchorSignalId: string) => void;
  /** anchors this session has already put back, so the row answers at once */
  restoredAnchorIds: ReadonlySet<string>;
}

export function AntechamberPanel({
  locale,
  rows,
  onClose,
  onRestoreAnchor,
  restoredAnchorIds,
}: AntechamberPanelProps): JSX.Element {
  return (
    <DialogSurface className="jar-roomform jar-machinery jar-antechamber" data-jar-chrome="1"
      aria-label={t(locale, "worldTheAntechamber")} onClose={onClose}>
      <div className="jar-label">{t(locale, "worldTheAntechamber")}</div>
      {rows === null ? (
        <p className="jar-ante-candidate">{t(locale, "worldStillFetchingRefusals")}</p>
      ) : rows.length === 0 ? (
        <p className="jar-ante-candidate">{t(locale, "worldNothingRefused")}</p>
      ) : (
        rows.map((row) => {
          const restored =
            row.anchorSignalId !== null && restoredAnchorIds.has(row.anchorSignalId);
          const stillRefusing = row.anchorStillRefusing && !restored;
          return (
            <div key={row.id} className="jar-ante-row">
              <p className="jar-ante-candidate">{row.candidateStatement}</p>
              <p className="jar-ante-anchor jar-label">
                {t(locale, "worldTooCloseTo")}
                <span className="jar-ante-anchor-words">{row.anchorStatement}</span>
                {row.anchorSignalId === null ? (
                  <span className="jar-ante-standing">{t(locale, "worldSinceRemoved")}</span>
                ) : stillRefusing ? (
                  <>
                    {" — "}
                    <button
                      type="button"
                      className="jar-ante-restore"
                      onClick={() => onRestoreAnchor(row.anchorSignalId!)}
                    >
                      {t(locale, "worldPutItBack")}
                    </button>
                  </>
                ) : (
                  <span className="jar-ante-standing">{t(locale, "worldStandsAgain")}</span>
                )}
              </p>
            </div>
          );
        })
      )}
      <p className="jar-ask">
        <button type="button" onClick={onClose}>
          {t(locale, "worldClose")}
        </button>
      </p>
    </DialogSurface>
  );
}
