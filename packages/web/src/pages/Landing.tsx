/**
 * WHAT WAKA IS, SAID TO SOMEBODY WHO HAS NEVER HEARD OF IT.
 *
 * The product had no such page. An anonymous visitor arriving at `/` was
 * redirected to a sign-in form, which is a door with no building drawn around
 * it: it asks for a password to a thing it never names. `lib/front-door.ts`
 * decides who lands here rather than there.
 *
 * ── IT SELLS BY BEING THE PRODUCT, NOT BY DESCRIBING IT ────────────────────
 *
 * The obvious landing page — gradient hero, three feature cards, a wall of
 * logos — would be the costume change this codebase has spent two rulings
 * removing (the loading frame, 2026-08-27; the door, in the commit before
 * this one). A page that looks like every other SaaS page is a page claiming
 * WAKA is like every other SaaS product, before a single word is read.
 *
 * So it is made of the same material as everything else: the world's ground,
 * the companion, the label register, lowercase verbs — and it spends LIGHT to
 * mean something, which is this product's one law about meaning.
 *
 * ── IT SELLS THE OUTCOME, NOT THE MACHINE (founder, 2026-08-28) ────────────
 *
 * The first draft of this page opened "Keep what moves you." and its main
 * section was headed "Four layers, and you only ever touch the first." Both
 * described the mechanism, and the page read as one more second-brain app —
 * a category whose graveyard is well populated. The founder's direction was
 * to abstract it: nobody buys four layers.
 *
 * AND THE FOUR-LAYER ASCENT HAD STOPPED BEING TRUE OF THE PRODUCT ANYWAY.
 * Two rulings emptied it out from underneath. Signals — the old second rung —
 * are not a place a person stands in any more (founder, 2026-08-25; the
 * comment in `Home.tsx` that removed the sky says so in those words: "signals
 * are the machine's working material"). And layer 4 was never a fourth
 * region: `Home.tsx` draws principles as one quiet line under the top of
 * mind, "the same material, further along". So a page teaching four layers
 * was teaching a data model the world had already stopped drawing, and one of
 * its four rungs named something a visitor will never meet.
 *
 * The ascent is therefore THREE rungs, and they are the three places the
 * world actually has: what you keep, what you are holding now, and what is
 * left when the weather has passed. The recurrence rule that used to be its
 * own rung is where it belongs — inside the reading, as the reason the first
 * days are quiet.
 *
 * NO NUMERALS ON THE SCREEN. "States render, numerals never" is a founder
 * law, and it is why there is no counter, no percentage and no bar here.
 *
 * EVERY CLAIM ON THIS PAGE IS ONE THE CODE ACTUALLY KEEPS. That was the
 * writing rule, and it is the reason the copy is specific where marketing
 * copy is usually vague. Each section below cites the document it is true
 * because of. If a claim here ever stops being true, this page is lying to
 * strangers, which is the worst place in a product to keep a stale sentence.
 *
 * THE COPY IS LITERAL JSX, NOT MESSAGE KEYS, and that is the same choice the
 * world's own surfaces make (`AntechamberPanel` and the panels beside it write
 * their sentences inline). `lib/i18n` is the CHROME's catalogue — the door,
 * the account screen — and English is the product's only language by founder
 * ruling. Forty marketing keys in it would be forty keys pretending a
 * translation is coming. `copy.test.ts` reads JSX text nodes directly, so the
 * canon-vocabulary gate covers these sentences either way.
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
 * One rung of the ascent.
 *
 * `light` is a 0-1 position on the ramp and reaches the stylesheet as a custom
 * property, because the brightness IS the content of this element — the three
 * of them together are the only place on the page that says these are
 * ordered. See `styles/landing.css` for how it is spent.
 */
function Rung({
  light,
  label,
  title,
  example,
  children,
}: {
  light: number;
  label: string;
  title: string;
  /**
   * The same thought, at this stage. One example runs the whole ascent — the
   * line you typed becomes the account WAKA holds of you, becomes the
   * directive underneath it — because abstract definitions describe a data
   * model and one worked example describes a product.
   */
  example: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <li className="lp-rung" style={{ ["--rung-light" as string]: String(light) }}>
      <span className="lp-rung-light" aria-hidden="true" />
      <div className="lp-rung-said">
        <p className="lp-label">{label}</p>
        <h3 className="lp-rung-title">{title}</h3>
        <p className="lp-prose">{children}</p>
        <p className="lp-rung-eg">{example}</p>
      </div>
    </li>
  );
}

function Law({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <li className="lp-law">
      <h3 className="lp-law-title">{title}</h3>
      <p className="lp-prose">{children}</p>
    </li>
  );
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

      {/* THE TURN THIS PAGE IS BUILT ON: everything that acts for you is
          working from some account of who you are, and you have never read
          any of them. The answer is not a better guess — it is a record you
          can read, quote and correct. Both halves are shipped and cited in
          the sections below; the headline is allowed to be this blunt only
          because the page underneath it is checkable. */}
      <section className="lp-hero">
        <WatchfulCompanion scale={0.72} />
        <h1 className="lp-headline">Everything deciding for you is guessing about you.</h1>
        <p className="lp-lede">
          WAKA keeps one short, current account of what matters to you — built
          only from your own words, and readable by anything acting on your
          behalf. You will not be summarised. You will be quoted.
        </p>
        <div className="lp-acts">
          {/* `?begin` opens the door on its `begin` side. A query rather than
              router state so the link survives being copied, shared and
              bookmarked — which is the whole job of a link on this page. */}
          <Link className="lp-act" to="/login?begin">
            begin
          </Link>
          {/* A fact about the product, not a claim about the business. The
              first draft of this line said "free while it is being built",
              which nothing in this repository knows to be true — an invented
              price is the one kind of sentence a landing page must never
              carry, because it is the one a stranger would act on. */}
          <span className="lp-act-aside">private by default</span>
        </div>
      </section>

      {/* THE ASCENT — the three places the world draws, not the canon's four
          layers. `Home.tsx` on why: the sky stopped holding signals (founder,
          2026-08-25) and layer 4 "is not a fourth place". The recurrence rule
          lives inside the middle rung, where a visitor meets it. Numbers are
          `docs/generation.md`'s, which CI pins against the implementation. */}
      <section className="lp-section lp-ascent" aria-labelledby="lp-ascent-title">
        <p className="lp-label">how it works</p>
        <h2 id="lp-ascent-title" className="lp-section-title">
          You keep things. The reading happens without you.
        </h2>
        <p className="lp-prose lp-wide">
          One thought, all the way through: the line you typed, and what WAKA
          makes of it.
        </p>
        <ol className="lp-rungs">
          <Rung
            light={0.34}
            label="you keep"
            title="What you keep"
            example="“Turned down the platform-team offer. I keep choosing depth over breadth.”"
          >
            A line, a link, a photograph — whatever moved you, in whatever
            words you had at the time. Nothing to tag, nothing to file, no
            weekly review to fall behind on. It stays yours: private by
            default, editable, and deletable.
          </Rung>
          <Rung
            light={0.67}
            label="waka reads"
            title="What matters now"
            example="“You are protecting depth at a cost you have not named yet.” — standing on this memory, the blog you abandoned, and the piano you quit."
          >
            WAKA reads back over everything you have kept, including the save
            from months ago you had forgotten, and holds one short account of
            what matters to you now. Nothing is said back to you on a single
            mention — a thing has to return, in separate moments, before it
            counts. That is why the first days are quiet, and it is why what
            arrives later is worth having.
          </Rung>
          <Rung
            light={1}
            label="what survives"
            title="What lasts"
            example="“Go deeper before you go wider.” — and every agent you work with can read it."
          >
            What is still standing months later, after the account has been
            rewritten around it many times over, stops being a mood. Strip the
            situation out of it and what is left is a directive — how you
            choose, rather than what you chose.
          </Rung>
        </ol>
      </section>

      {/* Each of these is a founder ruling or a documented invariant, not a
          promise: carried entries (`generation.md`, the synthesis carry
          rules), citation validation (`generation.md` §4), contested pairs and
          evidence never crossing (`data-model.md`, the 2026-08-23 rulings),
          the decay terms, and `routes/export.ts`. */}
      <section className="lp-section" aria-labelledby="lp-laws-title">
        <p className="lp-label">the rules it keeps</p>
        <h2 id="lp-laws-title" className="lp-section-title">
          A memory is only worth having if you can trust how it behaves.
        </h2>
        <ul className="lp-laws">
          <Law title="Your own words are never rewritten.">
            Correct a sentence and it is yours from then on. It comes back
            through every rewrite exactly as you typed it — restored from what
            you saved, because the machine is asked to reproduce it and then
            not trusted to. Hand it back whenever you like.
          </Law>
          <Law title="Every claim cites your own words.">
            A reading that cites nothing is a horoscope. Every line WAKA writes
            about you is checked, in code, against the memories it rests on —
            you can always walk back down to them, and a quote it cannot find
            in what you actually wrote cannot be stored at all.
          </Law>
          <Law title="It never settles an argument about you.">
            When WAKA ends up holding two opposing beliefs about you, both
            stand, marked, until you rule on them. No weight of evidence gets
            to decide which of them is you.
          </Law>
          <Law title="Fading never deletes.">
            A pattern you stop feeding sinks on its own, quietly, without
            anybody dismissing it. It is never removed — and it surfaces again
            the moment you come back to it.
          </Law>
          <Law title="Nothing crosses without you.">
            Everything is private until you say otherwise, one memory at a
            time. And the evidence — the exact words underneath a pattern —
            never crosses to another person at all, whatever else you share.
          </Law>
          <Law title="You can leave with all of it.">
            One export hands you the whole of it: every memory, every statement
            WAKA drew from them, the words underneath each one, and everything
            it used to say before it said this. Not a summary of what it
            remembers. All of it.
          </Law>
        </ul>
      </section>

      {/* `data-model.md`: agent profiles own a full stack; read + capture on
          the human profile, never edit. `routes/consultations`: every agent
          read is written down. `principles.md` / the canonical machine
          rendering: one deterministic document, byte-identical. */}
      <section className="lp-section" aria-labelledby="lp-agents-title">
        <p className="lp-label">and your agents</p>
        <h2 id="lp-agents-title" className="lp-section-title">
          The tools deciding on your behalf can finally know how you decide.
        </h2>
        <p className="lp-prose lp-wide">
          An agent working alongside you gets a memory of its own — its
          observations, its lessons, its own account of what it has learned —
          plus permission to read yours and add to it. It can never rewrite
          what you kept.
        </p>
        <p className="lp-prose lp-wide">
          And it can read your principles: one plain document, served the same
          way to every tool, so an assistant choosing something for you can
          name the principle it leaned on. Every time one reads you, that read
          is written down — so what your agents were told about you is
          something you look up rather than reconstruct.
        </p>
      </section>

      {/* The 2026-08-24 ruling: a room distils its own signals from pooled
          public memories, and needs two distinct members' memories under a
          statement before it may wear the room's name. Driven end to end on
          real Postgres by `lib/room-derivation.db.test.ts`. */}
      <section className="lp-section" aria-labelledby="lp-rooms-title">
        <p className="lp-label">together</p>
        <h2 id="lp-rooms-title" className="lp-section-title">
          A room remembers what a team keeps coming back to.
        </h2>
        <p className="lp-prose lp-wide">
          Put a memory out loud and it joins the ground of the rooms you are
          in, where the same reading runs over what everybody made public. A
          room only speaks a pattern once two different people's memories stand
          under it — so everything it says about itself is genuinely
          collective, and never one person's view wearing the room's name.
        </p>
      </section>

      <section className="lp-section lp-close" aria-labelledby="lp-close-title">
        <h2 id="lp-close-title" className="lp-section-title lp-close-title">
          Begin your archive.
        </h2>
        <p className="lp-prose lp-wide">
          Nothing is there yet. Keep the first thing that moves you, and come
          back when something else does. Nothing else is asked of you.
        </p>
        <div className="lp-acts">
          <Link className="lp-act" to="/login?begin">
            begin
          </Link>
          <Link className="lp-quiet-verb" to="/login">
            or continue where you left off
          </Link>
        </div>
      </section>
    </main>
  );
}
