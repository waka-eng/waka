/**
 * ═══ ONE CREATURE, THE WHOLE WAY THROUGH ═════════════════════════════════
 *
 * Founder: "the character should move etc continuously rather than each
 * screen feeling like its own", and of the hand-off into the first question,
 * "the character stays in place and slightly jumps to the middle".
 *
 * So onboarding has exactly ONE creature, drawn here, above every screen. A
 * screen does not draw it; it leaves a SLOT where it should stand
 * (`CreatureSlot` — an empty box the size of the frame's creature) and says
 * how it should look there (size, eyes, the frame's idle motion). When the
 * slot moves — another intro beat, the next screen, the photo question's
 * small avatar — the creature hops there along one arc of the world's own
 * keep hop (`character/hop.ts`) instead of the screen cutting to a new one.
 * Under reduced motion it is simply there.
 *
 * WHERE IT STANDS IS OBSERVED, NOT READ ONCE (Law 6): the slot, its parent and
 * its screen are watched with a ResizeObserver, and the window's resize, so a
 * keyboard opening or a bubble growing carries the creature with the layout.
 *
 * `acknowledge()` is the keep: the two bounces and the flare a save gets at
 * home, for an answer landing in it.
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { HOP_MS, hopArc, hopLift } from "../../character/hop";
import { easeInOut } from "../../lib/num";
import { Companion } from "../Companion";
import { rampFromCss, rasterGrain } from "../../canvas/palette";
import { GRAIN_PX, GRAIN_TILE } from "../../canvas/sprites";
import { prefersStillness } from "../../lib/motion";

export type CreatureSize = "tiny" | "small" | "medium" | "large";

/** The frame's footprint for the creature, and the body's width inside it. */
export const FOOTPRINT: Record<CreatureSize, { w: number; h: number; body: number }> = {
  tiny: { w: 40, h: 32, body: 34 },
  small: { w: 76, h: 56, body: 66 },
  medium: { w: 100, h: 76, body: 88 },
  large: { w: 116, h: 86, body: 100 },
};
/** The body is drawn once at this size and scaled to each slot. */
const DRAWN = FOOTPRINT.large.body;
/** How long a hop from one place to the next takes. */
export const TRAVEL_MS = 600;

export interface SlotLook {
  size: CreatureSize;
  eyes?: "open" | "closed";
  /** One of the frames' idle motions: "catch", "lift", "lean". */
  motion?: string;
  /** The reading glasses it wears at home while reviewing your saves — on
      while it asks you something and while it reads your three. Changing
      them never moves the creature (`dress`, not `claim`). */
  glasses?: boolean;
}

interface Claim extends SlotLook { id: number; node: HTMLElement }

interface Stage {
  claim: (claim: Claim) => void;
  release: (id: number) => void;
  /** Glasses on or off where it already stands: no hop. */
  dress: (id: number, glasses: boolean) => void;
  /** Where its body's centre is on screen right now, for things that fly into it. */
  center: () => { x: number; y: number } | null;
  /** The keep: two bounces and a flare. */
  acknowledge: () => void;
}

const StageContext = createContext<Stage | null>(null);
let nextId = 1;


/** Where the creature should stand, and how — rendered by each screen. */
export function CreatureSlot({ size, eyes = "open", motion, glasses = false, place, className = "", style }: SlotLook & {
  /** Anything that moves the slot without resizing it (an intro beat). */
  place?: string | number;
  className?: string;
  style?: React.CSSProperties;
}): JSX.Element {
  const stage = useContext(StageContext);
  const node = useRef<HTMLSpanElement>(null);
  const id = useRef(0);
  if (!id.current) id.current = nextId++;
  useLayoutEffect(() => {
    if (!stage || !node.current) return undefined;
    stage.claim({ id: id.current, node: node.current, size, eyes, motion, glasses });
    return undefined;
    /* glasses are not a reason to re-claim: they go on via `dress`, which never hops */
  }, [stage, size, eyes, motion, place]);
  useLayoutEffect(() => { stage?.dress(id.current, glasses); }, [stage, glasses]);
  useLayoutEffect(() => () => { stage?.release(id.current); }, [stage]);
  const f = FOOTPRINT[size];
  return <span ref={node} className={`onb-slot ${className}`.trim()} aria-hidden="true" data-creature-slot={size}
    style={{ width: f.w, height: f.h, ...style }} />;
}

export function useCreatureStage(): Stage | null {
  return useContext(StageContext);
}

interface Spot { x: number; y: number; scale: number }

function spotOf(claim: Claim): Spot | null {
  const box = claim.node.getBoundingClientRect();
  if (!box.width || !box.height) return null;
  const f = FOOTPRINT[claim.size];
  /* the slot may be scaled (the intro's plate fits small phones), so the
     body's size on screen is read off the slot's own rendered width */
  return { x: box.left + box.width / 2, y: box.top + box.height / 2, scale: (box.width / f.w) * (f.body / DRAWN) };
}

export function CreatureStage({ children, fading = false }: { children: ReactNode; fading?: boolean }): JSX.Element {
  const [claim, setClaim] = useState<Claim | null>(null);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [lift, setLift] = useState(0);
  const [flareKey, setFlareKey] = useState(0);
  const at = useRef<Spot | null>(null);
  const motion = useRef({ frame: 0 });
  const current = useRef<Claim | null>(null);

  const stop = () => { cancelAnimationFrame(motion.current.frame); motion.current.frame = 0; };
  const place = (next: Spot) => { at.current = next; setSpot(next); };

  /* Travel from where it is to the slot, on one arc of the keep's hop. */
  const travel = useCallback((to: Spot) => {
    stop();
    const from = at.current;
    if (!from || prefersStillness() || typeof requestAnimationFrame !== "function") { setLift(0); place(to); return; }
    const began = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - began) / TRAVEL_MS);
      const e = easeInOut(t);
      place({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, scale: from.scale + (to.scale - from.scale) * e });
      setLift(hopArc(t, DRAWN * Math.max(from.scale, to.scale)));
      if (t < 1) motion.current.frame = requestAnimationFrame(step);
      else { motion.current.frame = 0; setLift(0); }
    };
    motion.current.frame = requestAnimationFrame(step);
  }, []);

  const follow = useCallback(() => {
    const c = current.current;
    const next = c ? spotOf(c) : null;
    if (next && !motion.current.frame) place(next);
  }, []);

  const stage = useMemo<Stage>(() => ({
    claim: (next) => {
      current.current = next;
      setClaim(next);
      const to = spotOf(next);
      if (to) travel(to);
    },
    release: (id) => {
      if (current.current?.id === id) { current.current = null; setClaim(null); }
    },
    dress: (id, glasses) => {
      const c = current.current;
      if (c?.id !== id || Boolean(c.glasses) === glasses) return;
      current.current = { ...c, glasses };
      setClaim(current.current);
    },
    center: () => at.current ? { x: at.current.x, y: at.current.y } : null,
    acknowledge: () => {
      setFlareKey((key) => key + 1);
      if (prefersStillness() || typeof requestAnimationFrame !== "function") return;
      stop();
      const began = performance.now();
      const size = DRAWN * (at.current?.scale ?? 1);
      const step = (now: number) => {
        const t = Math.min(1, (now - began) / HOP_MS);
        setLift(hopLift(t, size));
        if (t < 1) motion.current.frame = requestAnimationFrame(step);
        else { motion.current.frame = 0; setLift(0); }
      };
      motion.current.frame = requestAnimationFrame(step);
    },
  }), [travel]);

  /* Keep standing in the slot as the layout around it changes. */
  useEffect(() => {
    if (!claim) return undefined;
    const watched = [claim.node, claim.node.parentElement, claim.node.closest(".onb-stage")].filter(Boolean) as Element[];
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => follow());
    watched.forEach((node) => observer?.observe(node));
    window.addEventListener("resize", follow);
    return () => { observer?.disconnect(); window.removeEventListener("resize", follow); };
  }, [claim, follow]);
  useEffect(() => () => stop(), []);

  /* THE FILM, FOR THE BUBBLES. Home's bubble wears the world's grain through
     `--jar-grain`, which home publishes when its world is built — and this
     page has no world. So the stage bakes the same tile from the same
     generator (`rasterGrain` on the ramp's dorm cast, as the world and
     `Companion` do) and publishes it the same way, for its own subtree. */
  const scene = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = scene.current;
    if (!node) return;
    try {
      const tile = rasterGrain(rampFromCss(document.documentElement).dorm);
      if (!tile) return;
      node.style.setProperty("--jar-grain", `url(${tile.toDataURL()})`);
      node.style.setProperty("--jar-grain-size", `${GRAIN_PX * GRAIN_TILE}px`);
    } catch { /* no film is a smoother bubble, not a broken one */ }
  }, []);

  return (
    <StageContext.Provider value={stage}>
      <div ref={scene} className={`onb-scene${fading ? " onb-scene--out" : ""}`}>
      {children}
      {claim && spot ? (
        <div className="onb-lead" data-testid="onboarding-creature"
          style={{ transform: `translate(${spot.x}px, ${spot.y + lift}px) translate(-50%, -50%) scale(${spot.scale})` }}>
          <span className={`onb-lead-pose${claim.motion ? ` onb-lead--${claim.motion}` : ""}`}>
            <span className="onb-creature-real">
              <Companion size={DRAWN} eyes={claim.eyes === "closed" ? "shut" : "open"} glasses={Boolean(claim.glasses)} flareKey={flareKey} />
            </span>
          </span>
        </div>
      ) : null}
      </div>
    </StageContext.Provider>
  );
}
