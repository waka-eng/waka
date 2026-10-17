/**
 * THE LOADING SCREEN IS THE WORLD, EARLY.
 *
 * Two founder rulings, 2026-08-27: "loading page should be this black color"
 * (pointing at the world's own ground) and "can we have the character already
 * there in the loading screen? and continue your draft should say LOADING
 * instead". Loading used to be a white page with a word on it — the product
 * changing clothes twice on the way in. Now the way in looks like arriving:
 * the ground is already the ground, the companion is already home, and the
 * one line under it says the only fact there is.
 *
 * ═══ AND IT IS THE REAL COMPANION NOW, NOT A LIKENESS ═══════════════════
 *
 * Founder, with this screen beside the world: "current loading page is so
 * ugly. Why can't it not be the same character that we see here in the
 * loading screen as well?"
 *
 * WHAT WAS HERE: six absolutely-positioned divs with their own geometry —
 * a dome built from a four-value border-radius, two nubs at `bottom: 26`,
 * eyes at `33%`, and five hex literals. A hand-drawn SECOND OPINION about
 * the anatomy, which is precisely the class of thing `rest-pose.test.ts`
 * exists to prevent between the loop and `restPose`, written before that
 * function existed and never revisited after it did. It did not match, and
 * the mismatch is the complaint: the nubs sat low and overlapped the chin,
 * the dome was an ellipse rather than the baked body, and the whole face was
 * smooth where the real one carries the emulsion.
 *
 * SO IT DRAWS THE SAME POSE THE PAGES DRAW. `Companion` is `restPose` with
 * every behaviour at zero, built from the anatomy constants the frame loop
 * imports, so there is now exactly one creature in this product and three
 * places that ask for it.
 *
 * THE COST, STATED. `Companion` pulls the raster and the body bake into the
 * entry chunk, where before this screen cost six divs. It is the right
 * trade: the alternative is a drawing that is wrong, and wrong on the first
 * screen anybody sees. The bake is a few hundred lines of arithmetic over a
 * canvas the size of the creature, which is not what anyone is waiting for.
 *
 * WHAT IS STILL INLINE, AND WHY. The ground and the word. This renders
 * BEFORE `.jar` exists, outside the subtree that defines every `--jar-*`
 * token, so `var()` would resolve to nothing — the drawer once portalled to
 * `document.body` and lost the whole palette the same way. `Companion` reads
 * the ramp through `getComputedStyle` WITH FALLBACKS that match `home.css`,
 * so it is correct here by design rather than by luck.
 */

import { Companion } from "./Companion";
import { REST_BLEED } from "../character/raster";
import { readStoredLocale, t } from "../lib/locales";

/* `--jar-atmos`'s own value. One night across the world and the pages —
   founder: "I like the darker shade shown in Now" — and this is the first
   thing anybody sees of it, so it cannot be the old lighter literal. */
const ground = "#05080f";

/** How large the creature is drawn here. */
const CREATURE = 190;
/**
 * THE DRAWN BOX, which is the creature plus the room its nubs need.
 *
 * `Companion` pads by `REST_BLEED` on each side so the nubs are not clipped
 * — see the constant in `character/raster.ts` — and that padded figure is
 * what it sets as `--waka-companion-size`. The word below is placed from
 * the body's own half-height, so it has to use the same number rather than
 * `CREATURE`, or it would sit four pixels into the creature's chin.
 */
const BODY = CREATURE + Math.ceil(CREATURE * REST_BLEED) * 2;

export function LoadingHome(): JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading"
      style={{
        position: "fixed",
        inset: 0,
        background: ground,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* THE SIZE THE OLD DRAWING OCCUPIED, so the screen it replaces does
          not jump in scale between a build and the next one. */}
      <Companion size={CREATURE} />
      {/* the resting line's slot, wearing the label register's face; the word
          is the only honest one this early */}
      <div
        style={{
          /* ═══ OUT OF THE FLOW, SO THE CREATURE IS ACTUALLY CENTRED ══════
              `.waka-companion` is four times the creature so its falloff is
              not clipped, and it occupies that space — which is correct
              everywhere and awkward here, on the one screen that is a short
              centred column. At 190px the wrapper is 760 tall, so a word
              96px under it landed off the bottom of the viewport and the
              pair, centred together, put the creature well above the middle.

              THE FIRST FIX WAS A NEGATIVE MARGIN ON THE COMPANION ITSELF,
              and it was wrong in a way worth recording: shrinking that box's
              footprint does not shrink what it PAINTS, so every other
              caller's neighbour slid up underneath a creature still drawn at
              full reach. Founder, with the empty chat: "character is
              covering the text and then the glow is also cut off."

              THE SECOND FIX WAS A NEGATIVE MARGIN ON THE WORD, which is
              local and did stop it falling off the screen — and measured in
              a browser it put the creature 93px BELOW the middle. A column
              is centred by its own height, and a 792px box with a 201px
              pull-up under it has its centre nowhere near the body's.
              Founder, on exactly that: "I wanted the character to be at the
              very very center."

              So the word leaves the flow. The companion is then the only
              thing being centred and lands dead centre by definition, and
              the word hangs off the middle at a distance measured from the
              BODY — half the padded box, then air — rather than from a lamp
              three times its size. */
          position: "absolute",
          left: 0,
          right: 0,
          /* THE PARENT'S `alignItems` DOES NOT REACH IT ANY MORE. An
             absolutely positioned child is out of the flex flow, so the
             column's centring stopped applying and the word went to the
             left edge. It spans the viewport and centres its own text. */
          textAlign: "center",
          top: `calc(50% + ${BODY / 2 + 96}px)`,
          fontFamily:
            'Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Segoe UI", Roboto, sans-serif',
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: "0.3em",
          textTransform: "uppercase",
          color: "rgba(214,222,234,0.45)",
        }}
      >
        {t(readStoredLocale(), "loading")}
      </div>
    </div>
  );
}
