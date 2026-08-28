/**
 * WHAT WAKA IS, IN ONE SCREEN THAT DOES NOT SCROLL.
 *
 * An anonymous visitor arriving at `/` used to be redirected to a sign-in
 * form, which is a door with no building drawn around it: it asks for a
 * password to a thing it never names. `lib/front-door.ts` decides who lands
 * here rather than there.
 *
 * ── ONE SCREEN, BY RULING (founder, 2026-08-28) ────────────────────────────
 *
 * "I want landing page to be a single screen, non scrollable. we need to sell
 * value concisely." So the page is exactly one viewport tall and hides its
 * overflow, and that constraint is the editor: everything here had to beat
 * something else to be here.
 *
 * What it cost, and why each cut was the right one:
 *
 *   THE ASCENT went. Three rungs explaining how a memory becomes a directive
 *   is the mechanism, and a stranger has not yet agreed to care how it works.
 *   Its one load-bearing sentence — that WAKA does the rereading — survives
 *   as the first point.
 *
 *   THE SIX RULES went to two. Correction and exit are the ones no platform
 *   offers; the other four (fading, crossing, contested pairs, evidence) are
 *   the reasons those two hold, and reasons belong past the door.
 *
 *   ROOMS went entirely. A stranger arriving alone cannot want a team feature
 *   yet, and it is the section furthest from why they would sign up today.
 *
 * WHAT SURVIVED IS THE ARGUMENT, IN THREE MOVES: something already decides
 * for you and is guessing; here is what would have to be true instead; here
 * are the two guarantees that make it true. Everything cut is still true and
 * still shipped — it is waiting one screen in, which is where a person who
 * has agreed to be interested reads it.
 *
 * ── IT SELLS BY BEING THE PRODUCT, NOT BY DESCRIBING IT ────────────────────
 *
 * The obvious landing page — gradient hero, three feature cards, a wall of
 * logos — would be the costume change this codebase has spent two rulings
 * removing (the loading frame, 2026-08-27; the door, 2026-08-28). A page that
 * looks like every other SaaS page is a page claiming WAKA is like every
 * other SaaS product, before a single word is read. So it is made of the same
 * material as everything else: the world's ground, the companion, the label
 * register, lowercase verbs.
 *
 * NO NUMERALS ON THE SCREEN. "States render, numerals never" is a founder
 * law, and it is why there is no counter, no percentage and no bar here.
 *
 * EVERY CLAIM ON THIS PAGE IS ONE THE CODE ACTUALLY KEEPS:
 *   - "does the rereading" — `lib/signal-derivation.ts`, run from the queue
 *     on every save; nothing is asked of the person.
 *   - "quotes ... rather than summarising" — `generation.md` §4: a citation
 *     the model invented is dropped, and an unverifiable quote cannot be
 *     stored at all.
 *   - "stays corrected" — the synthesis carry rules: an entry you wrote is
 *     restored from storage, never taken from the model's reply.
 *   - "leave with all of it" — `routes/export.ts`, one deterministic bundle.
 * If a claim here ever stops being true, this page is lying to strangers,
 * which is the worst place in a product to keep a stale sentence.
 *
 * THE COPY IS LITERAL JSX, NOT MESSAGE KEYS, which is the same choice the
 * world's own surfaces make. `lib/i18n` is the CHROME's catalogue — the door,
 * the account screen — and English is the product's only language by founder
 * ruling. Marketing keys in it would be keys pretending a translation is
 * coming. `copy.test.ts` reads JSX text nodes directly, so the canon
 * vocabulary gate covers these sentences either way.
 */

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { Companion, LOOKING_AHEAD } from "../components/Companion";
import type { CompanionGaze } from "../components/Companion";

import "../styles/landing.css";

/**
 * How far from the being the pointer has to be for its gaze to be fully
 * spent. Wide enough that the eyes drift rather than snap to the cursor —
 * this is a creature noticing you, not a crosshair following you.
 */
const GAZE_FALLOFF_PX = 340;

const clamp = (n: number): number => (n < -1 ? -1 : n > 1 ? 1 : n);

/**
 * THE BEING WATCHES THE POINTER, and it is its own component so that it is
 * the only thing re-rendering while it does. A gaze recomputed on every frame
 * of a `pointermove` would otherwise re-render the whole page around it.
 *
 * This is lawful under "the world never moves unless the user moved it" for
 * the plainest possible reason: moving the pointer IS the user moving. It is
 * the same channel the door spends on which field has your hands, pointed at
 * the one thing a landing page knows about its visitor.
 */
function WatchfulCompanion({ scale }: { scale: number }): JSX.Element {
  const [gaze, setGaze] = useState<CompanionGaze>(LOOKING_AHEAD);
  const home = useRef<HTMLDivElement>(null);

  useEffect(() => {
    /* Two ways to be excused from this. A coarse pointer has no hover
       position to follow — a finger is either touching or absent — and asking
       for one would leave the eyes wherever the last tap happened to land.
       And reduced motion is a request not to be followed by moving things;
       the being simply looks ahead, which is a complete state rather than a
       degraded one. */
    const coarse = window.matchMedia?.("(pointer: coarse)")?.matches;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (coarse || still) return;

    let frame = 0;
    const follow = (event: PointerEvent): void => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const box = home.current?.getBoundingClientRect();
        if (!box) return;
        setGaze({
          x: clamp((event.clientX - (box.left + box.width / 2)) / GAZE_FALLOFF_PX),
          y: clamp((event.clientY - (box.top + box.height / 2)) / GAZE_FALLOFF_PX),
        });
      });
    };

    window.addEventListener("pointermove", follow);
    return () => {
      window.removeEventListener("pointermove", follow);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="lp-being" ref={home}>
      <Companion scale={scale} gaze={gaze} />
    </div>
  );
}

/**
 * One of the three things the page has room to say.
 *
 * They are deliberately NOT a light ramp. The ramp on the old page meant
 * something — the layers are ordered, and brightness said so. These three are
 * not ordered, they are three faces of one claim, so giving them rising light
 * would be spending the meaning channel on nothing. Equal weight is the
 * honest rendering.
 */
function Point({ children }: { children: React.ReactNode }): JSX.Element {
  return <li className="lp-point">{children}</li>;
}

export default function LandingPage(): JSX.Element {
  return (
    <main className="lp">
      <header className="lp-top">
        <p className="lp-label lp-mark">WAKA</p>
        {/* The returning person's way past all of this, in the corner every
            product puts it in. `continue` is the door's own word for it. */}
        <Link className="lp-quiet-verb" to="/login">
          continue
        </Link>
      </header>

      {/* THE STAGE takes the rest of the screen and centres what is on it, so
          the page composes against the viewport rather than against its own
          content — which is what makes "one screen" hold at every height
          rather than only at the one it was written on. */}
      <div className="lp-stage">
        <WatchfulCompanion scale={0.56} />

        {/* THE TURN THIS PAGE IS BUILT ON: something already decides on your
            behalf, working from an account of you that you have never read.
            The answer is not a better guess — it is a record you can read,
            quote and correct. The headline is allowed to be this blunt only
            because the two points under it are checkable. */}
        <h1 className="lp-headline">Everything deciding for you is guessing about you.</h1>

        <p className="lp-lede">
          WAKA keeps one short, current account of what matters to you — built
          only from your own words, and read by whatever acts on your behalf.
        </p>

        <ul className="lp-points">
          <Point>
            You keep what moves you. WAKA does the rereading, and works out
            what you keep coming back to.
          </Point>
          <Point>
            It quotes you rather than summarising you. Every line it writes
            about you cites something you actually wrote.
          </Point>
          <Point>
            Correct one and it stays corrected — for good. Leave with all of
            it whenever you like.
          </Point>
        </ul>

        <div className="lp-acts">
          {/* `?begin` opens the door on its `begin` side. A query rather than
              router state so the link survives being copied, shared and
              bookmarked — which is the whole job of a link on this page. */}
          <Link className="lp-act" to="/login?begin">
            begin
          </Link>
          {/* A fact about the product, not a claim about the business. An
              earlier draft said "free while it is being built", which nothing
              in this repository knows to be true — an invented price is the
              one kind of sentence a landing page must never carry, because it
              is the one a stranger would act on. */}
          <span className="lp-act-aside">private by default</span>
        </div>
      </div>
    </main>
  );
}
