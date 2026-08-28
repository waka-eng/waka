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
 * mean something, which is this product's one law about meaning. The four
 * layers are drawn as a ramp of brightening light rather than as a numbered
 * list, because that is literally what they are: `lib/aliveness.ts` bakes the
 * same ascent into how bright a memory is drawn, and a landing page that
 * numbered them 1-4 would be teaching a vocabulary the product never uses.
 *
 * NO NUMERALS ON THE SCREEN, for the same reason. "States render, numerals
 * never" is a founder law, and it is why there is no counter, no percentage
 * and no bar here. The two numbers that DO appear — three memories, and
 * forty-five days — are written as words in prose, and they are here because
 * they are the most credible thing about the product: the mechanics are real,
 * they are documented in `docs/generation.md`, and CI fails if the numbers in
 * that document and the numbers in the code ever disagree.
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
 * property, because the brightness IS the content of this element — the four
 * of them together are the only place on the page that says the layers are
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
   * The same thought, at this layer. One example runs the whole ascent — the
   * line you typed becomes the pattern WAKA names, becomes an entry in your
   * reading, becomes the directive underneath all three — because four
   * abstract definitions describe a data model and one worked example
   * describes a product. It is the chain `docs/generation.md` opens with, in
   * the words that document uses.
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

      <section className="lp-hero">
        <WatchfulCompanion scale={0.72} />
        <h1 className="lp-headline">Keep what moves you.</h1>
        <p className="lp-lede">
          WAKA reads what you keep, names the patterns underneath, and distils
          the ones that last into how you actually choose.
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

      {/* THE ASCENT — `docs/data-model.md`'s four layers, and the numbers are
          `docs/generation.md`'s, which CI pins against the implementation. */}
      <section className="lp-section lp-ascent" aria-labelledby="lp-ascent-title">
        <p className="lp-label">how it works</p>
        <h2 id="lp-ascent-title" className="lp-section-title">
          Four layers, and you only ever touch the first.
        </h2>
        <p className="lp-prose lp-wide">
          One thought, all the way up: the line you typed, and the three things
          WAKA made of it.
        </p>
        <ol className="lp-rungs">
          <Rung
            light={0.22}
            label="you keep"
            title="A memory"
            example="“Turned down the platform-team offer. I keep choosing depth over breadth.”"
          >
            A line, a link, a photograph — whatever moved you, in whatever
            words you had at the time. It stays yours: private by default,
            editable, and deletable.
          </Rung>
          <Rung
            light={0.48}
            label="waka reads"
            title="A pattern"
            example="“You keep choosing depth over breadth.” — standing on this memory, the blog you abandoned, and the piano you quit."
          >
            WAKA reads across everything you have kept, including the save from
            months ago you had forgotten, and proposes what it sees. One
            mention is a thought. Three is a pattern — and only then does it
            say so out loud.
          </Rung>
          <Rung
            light={0.74}
            label="it synthesises"
            title="Your top of mind"
            example="“You are protecting depth at a cost you have not named yet.”"
          >
            The strongest patterns become one artifact: what matters now, what
            you believe, and what is still in question. It is rewritten whole
            each time and kept as a version, so nothing is ever quietly edited
            underneath you.
          </Rung>
          <Rung
            light={1}
            label="what survives"
            title="A principle"
            example="“Go deeper before you go wider.” — and every agent you work with can read it."
          >
            What is still standing after forty-five days and five readings
            stops being a mood. Strip the situation out of it and what is left
            is a directive — how you choose, rather than what you chose.
          </Rung>
        </ol>
      </section>

      {/* Each of these is a founder ruling or a documented invariant, not a
          promise: fading (`generation.md`, the decay terms), evidence never
          crossing and contested pairs (`data-model.md`, the 2026-08-23
          rulings), and citation validation (`generation.md` §4). */}
      <section className="lp-section" aria-labelledby="lp-laws-title">
        <p className="lp-label">the rules it keeps</p>
        <h2 id="lp-laws-title" className="lp-section-title">
          A memory is only worth having if you can trust how it behaves.
        </h2>
        <ul className="lp-laws">
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
          <Law title="It never settles an argument about you.">
            When WAKA ends up holding two opposing beliefs about you, both
            stand, marked, until you rule on them. No weight of evidence gets
            to decide which version of you is right.
          </Law>
          <Law title="Every claim cites your own words.">
            A reading that cites nothing is a horoscope. Every line WAKA writes
            about you is checked, in code, against the memories it rests on —
            and you can always walk back down to them.
          </Law>
        </ul>
      </section>

      {/* `data-model.md`: agent profiles own a full stack; read + capture on
          the human profile, never edit. `principles.md` / the canonical
          machine rendering: one deterministic document, byte-identical. */}
      <section className="lp-section" aria-labelledby="lp-agents-title">
        <p className="lp-label">and your agents</p>
        <h2 id="lp-agents-title" className="lp-section-title">
          The tools deciding on your behalf can finally know how you decide.
        </h2>
        <p className="lp-prose lp-wide">
          An agent working alongside you gets a memory of its own — its
          observations, its lessons, its own four layers — plus permission to
          read yours and add to it. It can never rewrite what you kept.
        </p>
        <p className="lp-prose lp-wide">
          And it can read your principles: one plain document, served the same
          way to every tool, so an assistant choosing something for you can
          name the principle it leaned on. Your answer to a question you have
          answered a hundred times stops being something you have to type
          again.
        </p>
      </section>

      {/* The 2026-08-24 ruling: a room distils its own signals from pooled
          public memories, and needs two distinct members' memories under a
          statement before it may wear the room's name. */}
      <section className="lp-section" aria-labelledby="lp-rooms-title">
        <p className="lp-label">together</p>
        <h2 id="lp-rooms-title" className="lp-section-title">
          A room remembers what a team keeps coming back to.
        </h2>
        <p className="lp-prose lp-wide">
          Put a memory out loud and it joins the ground of the rooms you are
          in, where the same pipeline runs over what everybody made public. A
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
          back when something else does.
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
