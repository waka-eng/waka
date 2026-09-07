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
 * THE COPY LIVES IN THE CATALOGUE, and it did not when this page was written.
 * The argument then was that the world's own surfaces wrote their sentences
 * inline and English was the product's only language, so forty marketing keys
 * would be forty keys pretending a translation was coming.
 *
 * Both halves of that stopped being true on 2026-08-31, when the founder
 * reversed the English-only ruling: Korean came back, and the same work moved
 * every sentence in the world into `lib/i18n` (`worldTheAntechamber`,
 * `worldNothingRefused`, and four hundred more). This page was the last
 * surface writing English into JSX.
 *
 * That is not a style point, and no gate would have caught it —
 * `copy.test.ts` checks JSX text for canon words and the catalogue for dead
 * keys, and this page passed both. It is a defect a person meets:
 * `readStoredLocale` falls back to the BROWSER's language, so somebody
 * arriving from a Korean machine got Korean chrome on every other surface and
 * an entirely English page explaining what the product is. The one screen
 * whose whole job is to be understood by a stranger was the one screen that
 * could not speak to them.
 */

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { Companion, LOOKING_AHEAD } from "../components/Companion";
import type { CompanionGaze } from "../components/Companion";
import { readStoredLocale, t } from "../lib/locales";

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
  body,
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
  body: string;
}): JSX.Element {
  return (
    <li className="lp-rung" style={{ ["--rung-light" as string]: String(light) }}>
      <span className="lp-rung-light" aria-hidden="true" />
      <div className="lp-rung-said">
        <p className="lp-label">{label}</p>
        <h3 className="lp-rung-title">{title}</h3>
        <p className="lp-prose">{body}</p>
        <p className="lp-rung-eg">{example}</p>
      </div>
    </li>
  );
}

function Law({ title, body }: { title: string; body: string }): JSX.Element {
  return (
    <li className="lp-law">
      <h3 className="lp-law-title">{title}</h3>
      <p className="lp-prose">{body}</p>
    </li>
  );
}

export default function LandingPage(): JSX.Element {
  /* Read once, at render. A stranger has chosen nothing yet, so
     `readStoredLocale` falls back to the browser's own language — which is
     exactly right here: this page's whole job is to be understood by somebody
     who has never told us anything about themselves. */
  const locale = readStoredLocale();
  return (
    <main className="lp">
      <header className="lp-top">
        <p className="lp-label lp-mark">{t(locale, "loginEyebrow")}</p>
        {/* The returning person's way past all of this, in the corner every
            product puts it in — and it is the door's own word for it, read
            from the door's own key, so the two can never drift apart. */}
        <Link className="lp-quiet-verb" to="/login">
          {t(locale, "loginTab")}
        </Link>
      </header>

      <section className="lp-hero">
        <WatchfulCompanion scale={0.72} />
        <h1 className="lp-headline">{t(locale, "landingHeadline")}</h1>
        <p className="lp-lede">{t(locale, "landingLede")}</p>
        <div className="lp-acts">
          {/* `?begin` opens the door on its `begin` side. A query rather than
              router state so the link survives being copied, shared and
              bookmarked — which is the whole job of a link on this page. */}
          <Link className="lp-act" to="/login?begin">
            {t(locale, "signupTab")}
          </Link>
          {/* A fact about the product, not a claim about the business. The
              first draft of this line said "free while it is being built",
              which nothing in this repository knows to be true — an invented
              price is the one kind of sentence a landing page must never
              carry, because it is the one a stranger would act on. */}
          <span className="lp-act-aside">{t(locale, "landingAsidePrivate")}</span>
        </div>
      </section>

      {/* THE ASCENT — `docs/data-model.md`'s four layers, and the numbers are
          `docs/generation.md`'s, which CI pins against the implementation. */}
      <section className="lp-section lp-ascent" aria-labelledby="lp-ascent-title">
        <p className="lp-label">{t(locale, "landingAscentLabel")}</p>
        <h2 id="lp-ascent-title" className="lp-section-title">
          {t(locale, "landingAscentTitle")}
        </h2>
        <p className="lp-prose lp-wide">{t(locale, "landingAscentLede")}</p>
        <ol className="lp-rungs">
          <Rung
            light={0.22}
            label={t(locale, "landingKeepLabel")}
            title={t(locale, "landingKeepTitle")}
            body={t(locale, "landingKeepBody")}
            example={t(locale, "landingKeepExample")}
          />
          <Rung
            light={0.48}
            label={t(locale, "landingPatternLabel")}
            title={t(locale, "landingPatternTitle")}
            body={t(locale, "landingPatternBody")}
            example={t(locale, "landingPatternExample")}
          />
          <Rung
            light={0.74}
            label={t(locale, "landingTopOfMindLabel")}
            title={t(locale, "landingTopOfMindTitle")}
            body={t(locale, "landingTopOfMindBody")}
            example={t(locale, "landingTopOfMindExample")}
          />
          <Rung
            light={1}
            label={t(locale, "landingPrincipleLabel")}
            title={t(locale, "landingPrincipleTitle")}
            body={t(locale, "landingPrincipleBody")}
            example={t(locale, "landingPrincipleExample")}
          />
        </ol>
      </section>

      {/* Each of these is a founder ruling or a documented invariant, not a
          promise: fading (`generation.md`, the decay terms), evidence never
          crossing and contested pairs (`data-model.md`, the 2026-08-23
          rulings), and citation validation (`generation.md` §4). */}
      <section className="lp-section" aria-labelledby="lp-laws-title">
        <p className="lp-label">{t(locale, "landingLawsLabel")}</p>
        <h2 id="lp-laws-title" className="lp-section-title">
          {t(locale, "landingLawsTitle")}
        </h2>
        <ul className="lp-laws">
          <Law
            title={t(locale, "landingLawFadingTitle")}
            body={t(locale, "landingLawFadingBody")}
          />
          <Law
            title={t(locale, "landingLawCrossingTitle")}
            body={t(locale, "landingLawCrossingBody")}
          />
          <Law
            title={t(locale, "landingLawArgumentTitle")}
            body={t(locale, "landingLawArgumentBody")}
          />
          <Law
            title={t(locale, "landingLawCitesTitle")}
            body={t(locale, "landingLawCitesBody")}
          />
        </ul>
      </section>

      {/* `data-model.md`: agent profiles own a full stack; read + capture on
          the human profile, never edit. `principles.md` / the canonical
          machine rendering: one deterministic document, byte-identical. */}
      <section className="lp-section" aria-labelledby="lp-agents-title">
        <p className="lp-label">{t(locale, "landingAgentsLabel")}</p>
        <h2 id="lp-agents-title" className="lp-section-title">
          {t(locale, "landingAgentsTitle")}
        </h2>
        <p className="lp-prose lp-wide">{t(locale, "landingAgentsBodyOwn")}</p>
        <p className="lp-prose lp-wide">{t(locale, "landingAgentsBodyRead")}</p>
      </section>

      {/* The 2026-08-24 ruling: a room distils its own signals from pooled
          public memories, and needs two distinct members' memories under a
          statement before it may wear the room's name. */}
      <section className="lp-section" aria-labelledby="lp-rooms-title">
        <p className="lp-label">{t(locale, "landingRoomsLabel")}</p>
        <h2 id="lp-rooms-title" className="lp-section-title">
          {t(locale, "landingRoomsTitle")}
        </h2>
        <p className="lp-prose lp-wide">{t(locale, "landingRoomsBody")}</p>
      </section>

      <section className="lp-section lp-close" aria-labelledby="lp-close-title">
        <h2 id="lp-close-title" className="lp-section-title lp-close-title">
          {t(locale, "loginBegin")}
        </h2>
        <p className="lp-prose lp-wide">{t(locale, "landingCloseBody")}</p>
        <div className="lp-acts">
          <Link className="lp-act" to="/login?begin">
            {t(locale, "signupTab")}
          </Link>
          <Link className="lp-quiet-verb" to="/login">
            {t(locale, "landingCloseContinue")}
          </Link>
        </div>
      </section>
    </main>
  );
}
