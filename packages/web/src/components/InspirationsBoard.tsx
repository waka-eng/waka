/**
 * <InspirationsBoard /> — top-level composition of the authenticated
 * inspirations workspace.
 *
 * Sub-AC 4.3.4 lifts every primitive that earlier sub-ACs ported out of
 * the prototype's `index.html` and assembles them into the full home-page
 * tree. Its job is *composition only* — the constituent components own
 * their visual contract; this component owns the layout class hierarchy
 * and the local presentational state that wires the primitives together.
 *
 * Layout / class hierarchy mirrored from the prototype (index.html lines
 * 2109–2163):
 *
 *   <body>                                         ← AppShell siblings:
 *     <div class="bg-field" />                     ←   <BackgroundField />
 *     <div class="noise" />                        ←   (inside <BackgroundField />)
 *     <div class="drop-overlay" />                 ←   <DropOverlay />
 *     <div class="history-overlay">…</div>         ←   <HistoryPanel />
 *     <main class="wrap">                          ←   <main className="wrap">
 *       <header>…</header>                         ←     <AppHeader />
 *       <section class="grid home-grid">           ←     <ClusterGrid>
 *         …8× <div class="wm-card …">              ←       <ClusterSection /> × 8
 *         <div class="cell capture">…</div>        ←       <CaptureCell />
 *       </section>                                 ←     </ClusterGrid>
 *       <div class="close-confirm">…</div>         ←     <CloseConfirmModal />
 *     </main>                                      ←   </main>
 *   </body>
 *
 * Why pull this together into one component?
 *
 *   - Earlier sub-ACs deliberately produced presentational primitives
 *     with no opinions about each other. The resulting tree was strewn
 *     across `<HomePage>` with a single `<ClusterGrid>` placeholder.
 *     Composing them here gives the home page a single, named, tested
 *     point of integration — and isolates the eventual API wiring (data
 *     fetch, capture POST, queue subscription) so it lands in *one*
 *     component instead of being threaded through five.
 *
 *   - The prototype's CSS targets specific descendant chains
 *     (`.grid.home-grid > .cell.capture`, `.wm-card .description`, …).
 *     Putting the children behind a single composed shell keeps that
 *     descendant chain honest at the type level — a future sub-AC
 *     cannot accidentally reorder a card around the capture cell and
 *     have it typecheck silently.
 *
 *   - The prototype's `HOME_CARDS` list (index.html lines 3729–3751)
 *     drove the prototype grid. The authenticated app derives the
 *     same shape from the user's own saves (grouped by cluster) and
 *     passes them in via `homeCards`. The default is an empty list,
 *     so an unauthenticated mount or a brand-new account never sees
 *     someone else's prototype copy on the home page.
 *
 * State that lives *inside* this composition:
 *
 *   - `noteValue`           — controlled value for the capture textarea.
 *   - `saveVisible`         — derived from note + attachment presence so
 *                              the save pill matches the prototype's
 *                              "show only when there's something to save"
 *                              affordance.
 *   - `focused`             — capture-cell focus mode (cover the grid).
 *   - `dragover`            — drop-target highlight while a file is
 *                              hovering. (Reserved — drag-and-drop wiring
 *                              lands when we hook the `<DropOverlay>` into
 *                              real upload events.)
 *   - `closeConfirmOpen`    — discard-confirmation modal visibility.
 *
 * State that is delegated *up* via props:
 *
 *   - `inspirations`        — the saved-inspirations list rendered inside
 *                              the history drawer. The parent owns the
 *                              data fetch so this component stays
 *                              decoupled from the API surface.
 *   - `homeCards`           — cluster-tile definitions derived by the
 *                              parent from the user's own saves.
 *                              Defaults to `[]` so the grid is empty
 *                              until the parent has data to show.
 *   - `onSaveCapture`       — fires when the user clicks the save pill
 *                              with a non-empty note. Receives the
 *                              current note text. The parent decides
 *                              whether to call the API and how to clear
 *                              local state on success.
 *   - `onSelectInspiration` — fires when a history-list card is
 *                              activated. The parent decides whether to
 *                              open a detail view, route somewhere, etc.
 *   - `onSelectCluster`     — fires when a cluster tile is activated.
 *                              Reserved for the wow-moment overlay
 *                              wiring in a later sub-AC.
 *
 * Visual parity rule (per Sub-AC 4.3.4): identical DOM and class names
 * as the prototype. The composition adds *no* new wrapper elements; it
 * delegates to the primitives that already preserve the contract.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  CaptureForm,
  CloseConfirmModal,
  type CaptureView,
  type PendingInspiration,
  type PersistedResult,
} from "./capture";
import type { ApiError } from "../lib/api";
import type { SupportedLocale } from "../lib/locales";
import { InspirationCard, type InspirationCardData } from "./InspirationCard";
import {
  AppShell,
  ClusterGrid,
  ClusterSection,
  type ClusterKind,
} from "./layout";

/* ============================================================
 * Cluster tile shape
 * ============================================================
 *
 * One entry per cluster the user has at least one save in. The home
 * grid renders these as `wm-card` tiles. The parent (`<HomePage>`)
 * derives the list from the user's own saves grouped by cluster — this
 * file no longer ships any prototype fixtures, so the grid is empty
 * until real saves exist (and the seed's "no mock SEED_INSPIRATIONS"
 * AC stays satisfied even on first paint).
 */
export interface HomeCardData {
  /** Cluster kind — drives `wm-{kind}` modifier class. */
  kind: ClusterKind;
  /** Save count surfaced in the `.count` chip. */
  count: number;
  /** Cluster topic copy rendered inside `.description`. */
  topic: string;
  /** Optional excerpt rendered inside `.artifact`. */
  artifact?: string | null;
  /**
   * Whether the tile renders in its lit "awake" state. The prototype
   * hand-picked four of nine to glow; with a derived grid the parent
   * decides — typically "any cluster the user has saves in".
   */
  awake?: boolean;
}

/**
 * The capture cell sits in the *center* of the 3×3 grid. CSS handles
 * placement via `grid-column / grid-row: span 2`, so we just need to
 * make sure the capture cell follows the first four tiles in DOM order
 * — exactly what the prototype does in `renderPhase3` by inserting each
 * `wm-card` *before* the existing `.cell.capture` (which is the last
 * child of `<section class="grid">`). We mirror that order here.
 */
const CAPTURE_INSERTION_INDEX = 4;

/* ============================================================
 * Component
 * ============================================================ */

export interface InspirationsBoardProps {
  /**
   * Saved inspirations to render in the history drawer. Empty array
   * (the default) preserves the prototype's "Nothing saved yet"
   * empty-state copy via `<HistoryPanel>`.
   */
  inspirations?: InspirationCardData[];

  /**
   * Optional detail view rendered inside the history drawer. The parent
   * mounts `<InspirationDetail>` here when the user activates a saved
   * row; the board forwards it through `<AppShell>` → `<HistoryPanel>`
   * without inspecting the contents.
   */
  historyDetail?: import("react").ReactNode;

  /**
   * Cluster tiles to render on the home grid. The parent derives
   * these from the user's own saves; defaults to `[]` so a fresh
   * mount never shows another user's data.
   */
  homeCards?: ReadonlyArray<HomeCardData>;

  /**
   * Optional total inspiration count for the header meta counter.
   * When omitted, falls back to `inspirations?.length ?? 0`. Accepting
   * an explicit prop lets the parent surface the *server-side* count
   * even when only a paginated slice has been fetched into the list.
   */
  totalInspirations?: number;

  /**
   * `true` while the parent's first `GET /inspirations` is in flight.
   * Drives the skeleton state (header counter "…", dimmed placeholder
   * tiles) so the page never reads "0 INSPIRATIONS SAVED" before the
   * server has answered.
   */
  loading?: boolean;

  /**
   * Fires *after* the user clicks Save and the save round-trip has
   * resolved successfully. The parent uses this to swap the optimistic
   * row for the canonical server payload. Optional — when omitted, the
   * board still saves correctly but the parent simply won't see the
   * canonical row.
   */
  onPersisted?: (tempId: string, result: PersistedResult) => void;

  /**
   * Fires immediately when Save is clicked with content present, so the
   * parent can render an optimistic "saving…" entry in the history list
   * before the API resolves.
   */
  onOptimisticAdd?: (pending: PendingInspiration) => void;

  /** Surfaces a hard failure (the inspirations POST itself failed). */
  onPersistError?: (tempId: string, error: ApiError) => void;

  /** Fires when the user activates a saved-inspiration card. */
  onSelectInspiration?: (id: string) => void;

  /**
   * Fires when the user activates a cluster tile. Receives the tile's
   * data. Reserved for the wow-moment overlay wiring in a later sub-AC.
   */
  onSelectCluster?: (card: HomeCardData, index: number) => void;

  /** Optional content rendered inside the page well before the home grid. */
  beforeGridContent?: ReactNode;

  /** Optional content rendered inside the page well after the home grid. */
  afterGridContent?: ReactNode;

  /**
   * Renders capture as the first content block instead of inside the home grid.
   * Used by Inspiration First so capture is the top-most action and the archive
   * follows below it.
   */
  captureFirst?: boolean;

  /**
   * Monotonic request token from a parent that wants the capture surface
   * opened/focused immediately after the board mounts or re-renders.
   */
  autoFocusCaptureRequest?: number;

  /** Current UI locale for shared shell copy. */
  locale?: SupportedLocale;
  /** Called when the shared header language selector changes. */
  onLocaleChange?: (locale: SupportedLocale) => void;
}

export function InspirationsBoard({
  inspirations = [],
  historyDetail,
  homeCards = [],
  totalInspirations,
  loading = false,
  onPersisted,
  onOptimisticAdd,
  onPersistError,
  onSelectInspiration,
  onSelectCluster,
  beforeGridContent,
  afterGridContent,
  captureFirst = false,
  autoFocusCaptureRequest,
  locale,
  onLocaleChange,
}: InspirationsBoardProps): JSX.Element {
  // ---------------------------------------------------------------
  // Capture-cell local state
  // ---------------------------------------------------------------
  //
  // The capture textarea / attachments / save round-trip are owned by
  // the wired `<CaptureForm>` below — we only manage the modifiers that
  // the *board* layout needs to drive (focus mode, drop highlight, the
  // close-confirm modal). Note state stays inside the form so the
  // optimistic-update contract is single-owned.

  /**
   * Focus mode mirrors the prototype's `enterFocus()/exitFocus()` pair
   * — the capture cell expands to cover the grid. We track only the
   * boolean here; the entrance/exit keyframes are CSS-driven and the
   * `focusEntering / focusExiting` flags would only matter once the
   * keyframe-end listener is wired (a later sub-AC).
   */
  const [focused, setFocused] = useState(false);

  /**
   * Drop-target highlight. Reserved hook for the drag-and-drop wiring
   * that the prototype binds on `<body>`. Kept in state so a future
   * sub-AC can flip it from a sibling component (the `<DropOverlay>`)
   * via context if needed.
   */
  const [dragover] = useState(false);

  /**
   * Discard-confirmation modal. The prototype shows this when the
   * user tries to dismiss the capture cell while it has unsaved
   * content. We keep the state local because no other component
   * needs to read it.
   */
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);

  // The reflection sub-view is mounted but inert in this composition —
  // wiring lands when the reflection API is hooked up. Kept as state
  // (instead of a constant) so the eventual sub-AC only swaps
  // `useState` for `useReducer`.
  const [view] = useState<CaptureView>("note");

  /**
   * "Wow moment" — the capture cell pulses (`save-flash`) the instant a
   * save round-trip resolves successfully. Cleared on a timer matching
   * the keyframe duration (`capPulse`, see `global.css`). The flag is
   * additive: it can co-exist with `focused` while the cell is closing.
   */
  const [saveFlash, setSaveFlash] = useState(false);
  const saveFlashTimerRef = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (saveFlashTimerRef.current !== null) {
        window.clearTimeout(saveFlashTimerRef.current);
      }
    };
  }, []);

  /**
   * Track which cluster kinds were on the grid in the previous render.
   * When a kind appears that wasn't there before — typically because the
   * classifier just labelled the user's first save in that cluster — we
   * tag the new tile with `waking` so the `cardWake` keyframe fires and
   * the user gets the prototype's signature ring-pulse reveal.
   *
   * The set is kept in a ref so updating it doesn't itself cause a
   * re-render. We only mutate it inside a layout-safe `useEffect`.
   */
  const prevKindsRef = useRef<Set<ClusterKind>>(new Set());
  const [wakingKinds, setWakingKinds] = useState<Set<ClusterKind>>(new Set());
  const wakingTimersRef = useRef<Map<ClusterKind, number>>(new Map());
  useEffect(() => {
    return () => {
      for (const id of wakingTimersRef.current.values()) {
        window.clearTimeout(id);
      }
      wakingTimersRef.current.clear();
    };
  }, []);

  // ---------------------------------------------------------------
  // Derived flags
  // ---------------------------------------------------------------

  /**
   * Header meta counter: prefer the explicit total when supplied so a
   * paginated UI doesn't lie to the user about how many saves exist.
   */
  const metaCount = totalInspirations ?? inspirations.length;

  // ---------------------------------------------------------------
  // Cluster tiles
  // ---------------------------------------------------------------
  //
  // Memoise the card list so the render stays referentially stable
  // across keystrokes in the capture textarea — important because the
  // wm-shape glyphs are non-trivial subtrees and re-keying them on
  // every keystroke would visibly thrash the wake animation.

  const clusterNodes = useMemo(() => {
    return homeCards.map((card, index) => (
      <ClusterSection
        key={`${card.kind}-${index}`}
        kind={card.kind}
        count={card.count}
        topic={card.topic}
        artifact={card.artifact ?? null}
        awake={card.awake ?? true}
        className={wakingKinds.has(card.kind) ? "waking" : undefined}
        // Stagger the status-dot pulse so a wall of tiles reads as a
        // population. Matches the prototype's
        // `--dotDelay: ${(idx * 0.3).toFixed(2)}s` line.
        dotDelay={`${(index * 0.3).toFixed(2)}s`}
        onClick={() => onSelectCluster?.(card, index)}
        dataId={`cluster-${index}`}
      />
    ));
  }, [homeCards, onSelectCluster, wakingKinds]);

  /**
   * Detect newly-added cluster kinds across renders and schedule the
   * `waking` class to drop off after the `cardWake` keyframe finishes
   * (1.4 s — matches the `.grid.home-grid .wm-card.waking` rule). The
   * effect runs *after* commit so the freshly-mounted tile gets the
   * class on the very next render and animates in.
   */
  useEffect(() => {
    const currentKinds = new Set(homeCards.map((c) => c.kind));
    const newlyAdded: ClusterKind[] = [];
    for (const kind of currentKinds) {
      if (!prevKindsRef.current.has(kind)) newlyAdded.push(kind);
    }
    prevKindsRef.current = currentKinds;
    if (newlyAdded.length === 0) return;
    setWakingKinds((prev) => {
      const next = new Set(prev);
      for (const k of newlyAdded) next.add(k);
      return next;
    });
    for (const kind of newlyAdded) {
      const existing = wakingTimersRef.current.get(kind);
      if (existing !== undefined) window.clearTimeout(existing);
      const id = window.setTimeout(() => {
        setWakingKinds((prev) => {
          if (!prev.has(kind)) return prev;
          const next = new Set(prev);
          next.delete(kind);
          return next;
        });
        wakingTimersRef.current.delete(kind);
      }, 1400);
      wakingTimersRef.current.set(kind, id);
    }
  }, [homeCards]);

  // ---------------------------------------------------------------
  // History drawer content
  // ---------------------------------------------------------------
  //
  // The prototype renders saves in reverse chronological order
  // (`[...savedItems].reverse().forEach…`). We do the same so the
  // composition is byte-identical with the prototype when the parent
  // hands us a chronological array. Callers who already pre-sorted
  // can simply pass `inspirations` as-is — `[...arr].reverse()` is
  // idempotent in the sense that two reverses cancel.

  const historyContent = useMemo(() => {
    if (inspirations.length === 0) {
      // `<HistoryPanel>` already emits the prototype's empty-state copy
      // when given no children, so we surface `undefined` here to let
      // the panel's default carry through.
      return undefined;
    }
    const ordered = [...inspirations].reverse();
    return ordered.map((item) => (
      <InspirationCard
        key={item.id}
        item={item}
        locale={locale}
        onSelect={onSelectInspiration}
      />
    ));
  }, [inspirations, onSelectInspiration]);

  // ---------------------------------------------------------------
  // Capture handlers
  // ---------------------------------------------------------------

  /**
   * Header capture trigger and the (future) drop overlay both want a
   * single way to "open" the capture surface. The prototype reaches
   * this via `enterFocus()`; we mirror by flipping focus mode on.
   * Held in a ref so a future imperative consumer (e.g. global hotkey)
   * can call `captureRef.current?.focus()` without restating the
   * policy.
   */
  const captureRef = useRef<HTMLDivElement>(null);

  const handleHeaderCapture = useCallback(() => {
    setFocused(true);
    // Defer the focus call so it lands after React commits the
    // `focused` class — otherwise the textarea grabs focus before the
    // expand keyframe starts and the visual rhythm reads off.
    queueMicrotask(() => {
      captureRef.current?.querySelector<HTMLTextAreaElement>("#capNote")?.focus();
    });
  }, []);

  const lastAutoFocusCaptureRequestRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (autoFocusCaptureRequest === undefined) return;
    if (lastAutoFocusCaptureRequestRef.current === autoFocusCaptureRequest) {
      return;
    }
    lastAutoFocusCaptureRequestRef.current = autoFocusCaptureRequest;
    handleHeaderCapture();
  }, [autoFocusCaptureRequest, handleHeaderCapture]);

  const handleToggleFocus = useCallback((next: boolean) => {
    // The CaptureForm owns the unsaved-content state, so the
    // close-confirm policy lives there in a future iteration. For now,
    // toggling focus simply flips the layout modifier — the form's own
    // unmount-side effect revokes any pending blob URLs if the parent
    // ever destroys it. The close-confirm modal stays wired to the
    // discard affordance below for parity.
    setFocused(next);
  }, []);

  useEffect(() => {
    if (!focused) return;

    const handleEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setFocused(false);
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [focused]);

  const handleDiscard = useCallback(() => {
    setCloseConfirmOpen(false);
    setFocused(false);
  }, []);

  const handleCancelDiscard = useCallback(() => {
    setCloseConfirmOpen(false);
  }, []);

  /**
   * Wrap the parent's `onPersisted` to fire the capture cell's pulse
   * animation. The flag clears itself on a timer (matches the
   * `capPulse` keyframe duration in `global.css`). We forward to the
   * parent unconditionally so the data flow is unchanged.
   */
  const handlePersisted = useCallback(
    (tempId: string, result: PersistedResult): void => {
      setSaveFlash(true);
      if (saveFlashTimerRef.current !== null) {
        window.clearTimeout(saveFlashTimerRef.current);
      }
      saveFlashTimerRef.current = window.setTimeout(() => {
        setSaveFlash(false);
        saveFlashTimerRef.current = null;
      }, 700);
      onPersisted?.(tempId, result);
    },
    [onPersisted],
  );

  const captureForm = (
    <CaptureForm
      ref={captureRef}
      view={view}
      visualState={{
        dragover,
        focused,
        saveFlash,
      }}
      focused={focused}
      onToggleFocus={handleToggleFocus}
      onOptimisticAdd={onOptimisticAdd}
      onPersisted={handlePersisted}
      onPersistError={onPersistError}
      locale={locale}
    />
  );

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------

  return (
    <AppShell
      count={metaCount}
      loading={loading}
      onCaptureClick={handleHeaderCapture}
      historyContent={historyContent}
      historyDetail={historyDetail}
      locale={locale}
      onLocaleChange={onLocaleChange}
    >
      {captureFirst ? (
        <div className="inspiration-first-capture">{captureForm}</div>
      ) : null}

      {beforeGridContent}

      {captureFirst ? null : (
        <ClusterGrid
          empty={!loading && clusterNodes.length === 0}
          loading={loading}
        >
          {/*
            Insert the capture cell at the center of the 3×3 grid. The
            prototype builds the grid by inserting each cluster tile
            *before* `.cell.capture`, so the capture cell ends up as the
            5th child (index 4). We mirror by slicing the cluster list
            around the capture insertion index.
          */}
          {clusterNodes.slice(0, CAPTURE_INSERTION_INDEX)}
          {captureForm}
          {clusterNodes.slice(CAPTURE_INSERTION_INDEX)}
        </ClusterGrid>
      )}

      {afterGridContent}

      {/*
        `<CloseConfirmModal>` is rendered as a sibling of the grid
        inside `<main className="wrap">` — matching the prototype
        DOM (index.html lines 2154–2163). Its visibility is purely
        class-driven, so leaving it permanently mounted is what makes
        the fade transition smooth on first open.
      */}
      <CloseConfirmModal
        open={closeConfirmOpen}
        onCancel={handleCancelDiscard}
        onDiscard={handleDiscard}
      />
    </AppShell>
  );
}

export default InspirationsBoard;
