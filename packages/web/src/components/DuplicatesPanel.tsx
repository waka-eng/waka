/**
 * THE GARDENER'S ASKS — pairs of standing patterns the weekly pass judged
 * to name ONE thing, waiting on the owner.
 *
 * The third machinery door, beside the reading and the antechamber: the
 * reading is the rules, the antechamber is what the loop refused, and this
 * is what the loop suspects but will not act on — a merge moves a person's
 * memory, so the machine records and only the person moves (goal: the
 * gardener, waka#294). Both statements stand side by side; the verbs are the
 * owner's two answers. Merging is two-step — a memory-moving word is never
 * beside its own yes — and `keep apart` is a standing answer the gardener
 * respects forever.
 *
 * A chrome panel; the world behind it does not move. Honest empty, like
 * the antechamber's: a gardener with nothing to ask says so.
 *
 * ── WHAT CHANGED WHEN IT CAME BACK (2026-10-11) ──────────────────────────
 *
 * IT HAS A NAME ON IT NOW. The other two passed `aria-label` to the
 * surface; this one was the only `DialogSurface` in the product opening as
 * `role="dialog"` with nothing naming it, so a screen reader announced "a
 * dialog" and then read two statements and four verbs with no idea whose
 * question they answered. The visible heading already says it — the label
 * repeats that one string rather than inventing a second.
 *
 * The locale is a prop (see `ReadingPanel`'s header) and the two inline
 * pixel margins are the shared `.jar-machinery` frame. Its `.jar-duplicates`
 * cap is new: the class was on the element the whole time with no rule
 * behind it, so a long list of asks scrolled the page instead of the panel.
 */
import { useState } from "react";

import type { ApiSignalDuplicate } from "../lib/api";
import { t, type SupportedLocale } from "../lib/locales";
import { DialogSurface } from "./DialogSurface";

export interface DuplicatesPanelProps {
  locale: SupportedLocale;
  /** null until the fetch lands */
  rows: ApiSignalDuplicate[] | null;
  onClose: () => void;
  /** resolve one ask; resolves when the server has recorded the answer */
  onResolve: (id: string, act: "merge" | "keep_apart") => void;
  /** asks answered this session, so rows respond at once */
  resolvedIds: ReadonlySet<string>;
}

export function DuplicatesPanel({
  locale,
  rows,
  onClose,
  onResolve,
  resolvedIds,
}: DuplicatesPanelProps): JSX.Element {
  /* the two-step: which ask has its merge armed */
  const [merging, setMerging] = useState<string | null>(null);
  const open = (rows ?? []).filter((row) => !resolvedIds.has(row.id));

  return (
    <DialogSurface className="jar-roomform jar-machinery jar-duplicates" data-jar-chrome="1"
      aria-label={t(locale, "worldGardenerAsks")} onClose={onClose}>
      <div className="jar-label">{t(locale, "worldGardenerAsks")}</div>
      {rows === null ? (
        <p className="jar-ante-candidate">{t(locale, "worldStillFetchingAsks")}</p>
      ) : open.length === 0 ? (
        <p className="jar-ante-candidate">{t(locale, "worldGardenerQuiet")}</p>
      ) : (
        open.map((row) => (
          <div key={row.id} className="jar-ante-row">
            <p className="jar-ante-candidate">{row.a.statement}</p>
            <p className="jar-ante-candidate">{row.b.statement}</p>
            <p className="jar-ask">
              {merging === row.id ? (
                <>
                  <span className="jar-ante-anchor-words">
                    {t(locale, "worldMergeExplain")}
                  </span>
                  <span aria-hidden="true"> · </span>
                  <button
                    type="button"
                    onClick={() => {
                      setMerging(null);
                      onResolve(row.id, "merge");
                    }}
                  >
                    {t(locale, "worldYesMerge")}
                  </button>
                  <span aria-hidden="true"> · </span>
                  <button type="button" onClick={() => setMerging(null)}>
                    {t(locale, "worldNotNow")}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => setMerging(row.id)}>
                    {t(locale, "worldTheseAreOne")}
                  </button>
                  <span aria-hidden="true"> · </span>
                  <button type="button" onClick={() => onResolve(row.id, "keep_apart")}>
                    {t(locale, "worldKeepApart")}
                  </button>
                </>
              )}
            </p>
          </div>
        ))
      )}
      <p className="jar-ask">
        <button type="button" onClick={onClose}>
          {t(locale, "worldClose")}
        </button>
      </p>
    </DialogSurface>
  );
}
