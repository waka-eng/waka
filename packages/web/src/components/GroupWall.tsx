/**
 * The wall — what a room reads, right now.
 *
 * Pulled out of Home.tsx unchanged. The cards themselves are still rendered by
 * Home and handed over as nodes: they depend on most of Home's state, and
 * threading that through would be a rewrite rather than a move. What lives
 * here is the surface they sit on — the stage, its travel states, and the
 * branching between loading, empty, and populated.
 *
 * That boundary is the point. The room timeline turns this surface into a
 * position on the room's life: a time rail along its edge, a scrub position,
 * and a fourth state — "what this room read then" — that the branching below
 * has to grow to hold. None of that belongs in a 5,600-line page component,
 * and all of it belongs here.
 */

import type { ReactNode } from "react";

/** Where the wall is in a room-to-room transition; null when it is still. */
export type WallTravel = "out" | "in" | null;

export interface GroupWallCopy {
  regionLabel: string;
  /** Your own wall is still loading its notes. */
  loadingThoughts: string;
  /** Your own wall has nothing on it yet. */
  emptyThoughts: string;
  firstRunTitle: string;
  firstRunSteps: string[];
  /** A room's board is still being gathered. */
  groupLoading: string;
  /** A room exists but nothing has been shared into it yet. */
  groupEmpty: string;
  groupEmptyLabel: string;
}

export interface GroupWallProps {
  copy: GroupWallCopy;
  travel: WallTravel;
  /** True when a room's board is showing rather than your own wall. */
  isGroupBoardActive: boolean;
  groupBoardLoading: boolean;
  ownBoardLoading: boolean;
  ownBoardError: string | null;
  /** How many cards there are — decides populated vs empty without rendering. */
  cardCount: number;
  /**
   * The note cards, rendered by their owner. A function rather than an array
   * so cards are only built in the branch that shows them, exactly as when
   * this lived inline in Home.
   */
  renderCards: () => ReactNode[];
  /** Legacy US-051 conversation-room card, when its flag is on. */
  legacySurface?: ReactNode;
}

export function GroupWall({
  copy,
  travel,
  isGroupBoardActive,
  groupBoardLoading,
  ownBoardLoading,
  ownBoardError,
  cardCount,
  renderCards,
  legacySurface,
}: GroupWallProps): JSX.Element {
  return (
    <section
      className={`nc-stage nc-stage--top-of-mind-wall${
        travel === "out"
          ? " nc-stage--travelling-out"
          : travel === "in"
            ? " nc-stage--travelling-in"
            : ""
      }`}
      aria-label={copy.regionLabel}
    >
      {legacySurface}
      {isGroupBoardActive && groupBoardLoading ? (
        <p className="nc-loading">{copy.groupLoading}</p>
      ) : !isGroupBoardActive && ownBoardLoading ? (
        <p className="nc-loading">{copy.loadingThoughts}</p>
      ) : !isGroupBoardActive && ownBoardError ? (
        <p className="nc-loading">{ownBoardError}</p>
      ) : cardCount > 0 ? (
        renderCards()
      ) : isGroupBoardActive ? (
        <div className="nc-first-run-guide" aria-label={copy.groupEmptyLabel}>
          <p className="nc-loading">{copy.groupEmpty}</p>
        </div>
      ) : (
        <div className="nc-first-run-guide" aria-label={copy.firstRunTitle}>
          <p className="nc-loading">{copy.emptyThoughts}</p>
          <div className="nc-first-run-card">
            <h2>{copy.firstRunTitle}</h2>
            <ol>
              {copy.firstRunSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </section>
  );
}
