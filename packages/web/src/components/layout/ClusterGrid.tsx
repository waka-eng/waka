/**
 * <ClusterGrid /> — the 3×3 home-grid container that hosts cluster cards.
 *
 * Reproduces:
 *
 *   <section class="grid home-grid" id="grid">
 *     …cluster cards + capture cell…
 *   </section>
 *
 * The grid lives at the heart of the home page. The CSS in `index.html`
 * targets `.grid.home-grid` (and its descendants `.cell.capture`,
 * `.wm-card`, etc.) for layout, hover, and the wake animation. This shell
 * provides the stable container so future sub-ACs can mount cluster cards
 * and the capture overlay without re-deriving the markup chain.
 *
 * The component is deliberately dumb: it forwards children and preserves
 * the `id="grid"` hook so any imperative selectors that later sub-ACs need
 * (drag-drop drop targets, e.g.) keep working.
 */

import type { ReactNode } from "react";

export interface ClusterGridProps {
  /** Cluster cards + the capture cell. */
  children?: ReactNode;
  /**
   * Whether the user has zero classified saves and so the cluster row
   * has no `<ClusterSection>` children to render. The prototype's home
   * grid hides the inline capture cell (capture opens via the header
   * pill into an absolute overlay). With no cluster cards that
   * affordance leaves the page visually empty, so we surface
   * `home-grid--empty` here and let CSS centre the capture cell as a
   * square first-run target.
   */
  empty?: boolean;
  /**
   * Whether the inspirations list is still being hydrated. While
   * loading we render a row of dimmed skeleton tiles in addition to
   * the parent's children, so the page never momentarily reads as
   * empty before the fetch resolves. Mutually independent of `empty`
   * — the parent should pass `loading=true` and `empty=false` while
   * the first fetch is in flight, then flip to `empty=true` only if
   * the response is genuinely empty.
   */
  loading?: boolean;
}

/**
 * Rendered as overlayed placeholder children when `loading` is true.
 * Six dimmed tiles roughly trace the eventual cluster layout so the
 * skeleton has the same visual rhythm as the populated grid.
 */
const SKELETON_COUNT = 6;

export function ClusterGrid({
  children,
  empty = false,
  loading = false,
}: ClusterGridProps): JSX.Element {
  const className = [
    "grid",
    "home-grid",
    empty ? "home-grid--empty" : null,
    loading ? "home-grid--loading" : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <section className={className} id="grid">
      {loading
        ? Array.from({ length: SKELETON_COUNT }).map((_, i) => (
            <div
              key={`skeleton-${i}`}
              className="wm-card wm-skeleton"
              aria-hidden="true"
            />
          ))
        : null}
      {children}
    </section>
  );
}

export default ClusterGrid;
