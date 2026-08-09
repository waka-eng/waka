/**
 * The wall as an orbit: the room's readings circle its adopted ambition.
 *
 * The geometry is the product's thesis drawn literally — post-its are
 * ingredients, the one ambition at the center is the dish, and the ring puts
 * the ingredients in motion around it. Back tiles pass behind the center
 * ghosted and blurred; front tiles pass below it crisp. Drag anywhere spins
 * the ring with inertia; a click brings a note to the front to be read.
 *
 * Prototype scope (goal/two-modes, slice 1): read-only. The expanded note
 * shows its sentence, hands and grounding — pin / take-down / correction stay
 * on the flat wall until the orbit earns them.
 *
 * Rendering is imperative on purpose: one rAF loop writes transforms to DOM
 * nodes through refs. Running the ring through React state would re-render
 * the tree at 60fps to move nine divs.
 *
 * Stacking: every moving piece is a DIRECT child of the container, which has
 * no transform/filter/fixed positioning of its own — so children's z-indexes
 * genuinely interleave (back tiles behind the center text, expanded note
 * above the veil). The mock's first cut wrapped tiles in a `position: fixed`
 * layer, which is a stacking context, and the veil covered every tile
 * regardless of z-index. Do not reintroduce a positioned wrapper here.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { contributorColor, contributorInitials } from "./faces";

export interface OrbitBoardNote {
  id: string;
  text: string;
  hands: string[];
  evidenceCount: number;
  isPinned: boolean;
}

export interface OrbitBoardCenter {
  label: string;
  /** The adopted ambition — null renders the honest forming state. */
  ambition: string | null;
  meta: string | null;
}

/* slow + subtle — the founder's picks from the B1 mock, baked in. */
const IDLE_SPEED = (Math.PI * 2) / 95; // rad/s
const MIN_OPACITY = 0.42;
const MAX_BLUR = 2.5;

/*
  Real depth, not a scale trick. The ring lives in the container's
  `perspective`: a note's z position does the shrinking and the parallax,
  and each sheet carries its own small fixed tilt so the field reads as
  papers hanging in a space rather than cards on a turntable — the
  bleibtgleich look, with CSS projection instead of three.js.
*/
/* (the projection itself is .ob's `perspective: 1200px` in orbit.css) */
const DRIFT_X = 26; // how far the cursor leans the camera, px at z=0
const DRIFT_Y = 16;

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

interface TileMotion {
  base: number;
  breathRate: number;
  breathPhase: number;
  /** This sheet's own hang: fixed tilt and vertical scatter, decided once. */
  tiltX: number;
  tiltY: number;
  yOff: number;
  cur: { x: number; y: number; z: number; rx: number; ry: number; op: number; bl: number } | null;
}

export function groundingCopy(evidenceCount: number, hands: string[]): string {
  const saves = `grounded in ${evidenceCount} ${evidenceCount === 1 ? "save" : "saves"}`;
  if (hands.length === 0) return saves;
  return `${saves} · ${hands.join(", ")}`;
}

export function OrbitBoard(props: {
  notes: OrbitBoardNote[];
  center: OrbitBoardCenter;
}) {
  const { notes, center } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef(new Map<string, HTMLElement>());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const expandedRef = useRef<string | null>(null);
  expandedRef.current = expandedId;

  /* Per-note motion state survives re-renders and note reordering; a note
     keeps its breathing phase when the wall refreshes around it. */
  const motions = useRef(new Map<string, TileMotion>());
  const noteIds = notes.map((n) => n.id).join("|");
  useMemo(() => {
    notes.forEach((n, i) => {
      const existing = motions.current.get(n.id);
      const base = (i / Math.max(notes.length, 1)) * Math.PI * 2;
      if (existing) {
        existing.base = base;
      } else {
        motions.current.set(n.id, {
          base,
          breathRate: 0.9 + Math.random() * 0.5,
          breathPhase: Math.random() * Math.PI * 2,
          tiltX: (Math.random() - 0.5) * 14,
          tiltY: (Math.random() - 0.5) * 26,
          yOff: (Math.random() - 0.5) * 2 * 0.55,
          cur: null,
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteIds]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    let rx = 0;
    let ry = 0;
    let rz = 0;
    const measure = () => {
      const rect = container.getBoundingClientRect();
      rx = Math.min(rect.width * 0.36, 560);
      ry = Math.min(rect.height * 0.26, 190);
      rz = Math.min(rect.height * 0.6, 430);
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(container);

    let rotation = 0;
    let vel = 0;
    let dragging = false;
    let lastX = 0;
    let lastT = 0;
    let movedRun = 0;

    /* The camera leans toward the cursor — bleibtgleich's drift. Raw mouse
       in [-1, 1], smoothed in the loop so it arrives like weight, not a
       cursor-follower. */
    let mouseX = 0;
    let mouseY = 0;
    let driftX = 0;
    let driftY = 0;
    const onHover = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouseY = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    };
    container.addEventListener("pointermove", onHover);

    const onDown = (event: PointerEvent) => {
      if (expandedRef.current) return;
      if ((event.target as HTMLElement).closest("button")) return;
      dragging = true;
      movedRun = 0;
      lastX = event.clientX;
      lastT = performance.now();
      vel = 0;
      container.classList.add("ob--dragging");
    };
    const onMove = (event: PointerEvent) => {
      if (!dragging) return;
      const now = performance.now();
      const dx = event.clientX - lastX;
      movedRun += Math.abs(dx);
      const dr = dx * 0.0032;
      rotation += dr;
      const dt = Math.max(now - lastT, 1) / 1000;
      vel = vel * 0.6 + (dr / dt) * 0.4;
      lastX = event.clientX;
      lastT = now;
    };
    const onUp = () => {
      dragging = false;
      container.classList.remove("ob--dragging");
    };
    container.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);

    /* A real click, not the tail of a drag. Read where the loop can see it. */
    container.dataset.obMoved = "0";
    const onClickCapture = () => {
      container.dataset.obMoved = movedRun > 6 ? "1" : "0";
    };
    container.addEventListener("click", onClickCapture, true);

    let prev = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min((now - prev) / 1000, 0.05);
      prev = now;
      const expanded = expandedRef.current;

      if (!dragging && !expanded) {
        rotation += IDLE_SPEED * dt; // the room's resting pulse
        rotation += vel * dt; // inertia from the last throw
        vel *= Math.pow(0.94, dt * 60);
        if (Math.abs(vel) < 0.002) vel = 0;
      }

      const t = now / 1000;

      /* The camera's lean arrives slowly, and rests when a note is held. */
      driftX = lerp(driftX, expanded ? 0 : mouseX, 0.06);
      driftY = lerp(driftY, expanded ? 0 : mouseY, 0.06);

      for (const [id, motion] of motions.current) {
        const el = tileRefs.current.get(id);
        if (!el) continue;
        const isEx = expanded === id;
        const th = motion.base + rotation;
        const s = (Math.cos(th) + 1) / 2; // 1 = front, 0 = back
        const eased = Math.pow(s, 1.3);
        const breath = Math.sin(t * motion.breathRate + motion.breathPhase) * 4;
        /* The sheet's hang sways a few degrees on its own breath. */
        const sway = Math.sin(t * motion.breathRate * 0.6 + motion.breathPhase) * 3;

        let target;
        if (isEx) {
          target = { x: 0, y: breath * 0.5, z: 250, rx: 0, ry: 0, op: 1, bl: 0 };
        } else {
          const z = Math.cos(th) * rz;
          /* Parallax: nearer sheets lean further with the cursor, which is
             what makes the depth legible even before anything spins. */
          const lean = 1 + z / rz;
          target = {
            x: Math.sin(th) * rx + driftX * DRIFT_X * lean,
            y: motion.yOff * ry + breath + driftY * DRIFT_Y * lean,
            z,
            rx: motion.tiltX + sway * 0.6,
            ry: motion.tiltY + sway,
            op: lerp(MIN_OPACITY, 1, eased) * (expanded ? 0.12 : 1),
            bl: lerp(MAX_BLUR, 0, eased),
          };
        }

        const cur = motion.cur ?? (motion.cur = { ...target });
        const k = isEx || expanded ? 0.14 : 0.45;
        /* Opacity and blur recover faster than position on expand, so the
           note solidifies while it travels instead of arriving translucent. */
        const kOp = isEx ? 0.38 : k;
        cur.x = lerp(cur.x, target.x, k);
        cur.y = lerp(cur.y, target.y, k);
        cur.z = lerp(cur.z, target.z, k);
        cur.rx = lerp(cur.rx, target.rx, k);
        cur.ry = lerp(cur.ry, target.ry, k);
        cur.op = lerp(cur.op, target.op, kOp);
        cur.bl = lerp(cur.bl, target.bl, kOp);

        el.style.transform = `translate(-50%,-50%) translate3d(${cur.x.toFixed(1)}px,${cur.y.toFixed(1)}px,${cur.z.toFixed(1)}px) rotateX(${cur.rx.toFixed(2)}deg) rotateY(${cur.ry.toFixed(2)}deg)`;
        el.style.opacity = cur.op.toFixed(3);
        el.style.filter = cur.bl > 0.15 ? `blur(${cur.bl.toFixed(1)}px)` : "none";
        /* Interleaves with the center (500) and the veil (900): back tiles
           slip behind the ambition, the expanded note rides above the veil. */
        el.style.zIndex = String(
          isEx ? 1000 : Math.round(eased * 400) + (Math.cos(th) > 0 ? 600 : 0),
        );
      }

    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      container.removeEventListener("pointerdown", onDown);
      container.removeEventListener("click", onClickCapture, true);
      container.removeEventListener("pointermove", onHover);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  useEffect(() => {
    if (!expandedId) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpandedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandedId]);

  return (
    <div ref={containerRef} className="ob" aria-label="the wall, orbiting the room's ambition">
      <div
        className={`ob-veil${expandedId ? " on" : ""}`}
        onClick={() => setExpandedId(null)}
        aria-hidden="true"
      />

      <div className={`ob-center${expandedId ? " ob-center--receded" : ""}`}>
        <div className="ob-center-label">{center.label}</div>
        {center.ambition ? (
          <div className="ob-center-ambition">{center.ambition}</div>
        ) : (
          <div className="ob-center-forming">forming — no ambition adopted yet</div>
        )}
        {center.meta ? <div className="ob-center-meta">{center.meta}</div> : null}
      </div>

      {notes.map((note) => {
        const isEx = expandedId === note.id;
        return (
          <article
            key={note.id}
            ref={(el) => {
              if (el) tileRefs.current.set(note.id, el);
              else tileRefs.current.delete(note.id);
            }}
            className={`ob-note${isEx ? " ob-note--expanded" : ""}`}
            onClick={(event) => {
              if (containerRef.current?.dataset.obMoved === "1") return;
              if (isEx) return;
              event.stopPropagation();
              setExpandedId(note.id);
            }}
          >
            <div className="ob-note-text">{note.text}</div>
            {isEx ? <div className="ob-note-grounding">{groundingCopy(note.evidenceCount, note.hands)}</div> : null}
            <footer className="ob-note-foot">
              {note.hands.length > 0 ? (
                <span className="sf-faces">
                  {note.hands.map((name) => (
                    <span
                      key={name}
                      className="sf-face"
                      style={{ background: contributorColor(name) }}
                    >
                      {contributorInitials(name)}
                    </span>
                  ))}
                </span>
              ) : null}
              {note.isPinned ? <span className="ob-note-held">held</span> : null}
            </footer>
          </article>
        );
      })}


      <p className="ob-hint">drag to spin · click a note to read · click away to put it back</p>
    </div>
  );
}
