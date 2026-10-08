/**
 * THE CHARACTER, AS A BULB.
 *
 * Founder ruling: the character is a lightbulb, and the less inspired you have
 * been, the dimmer it burns. That is the founder law — light is the only
 * meaning channel — stated as an object rather than as a rule, which is why
 * this is the right shape for the thing in the middle of the screen. The
 * previous character was decorative: it narrated the weather and said "saved".
 * This one carries a fact about the person, in the only channel the product
 * trusts.
 *
 * THE ONE INPUT IS SILENCE. `bulbGlow` reads days since the last thing was
 * kept, decayed on `FIELD_DECAY_HALF_LIFE_DAYS` — the same curve the field of
 * memories dims on, deliberately not a second tunable. It never reaches dark,
 * because fading never deletes and a dark bulb reads as broken rather than as
 * quiet.
 *
 * NO HUE, EVER. Brightness is the whole channel: the glass warms toward the
 * page's ink and the halo grows. A bulb that went blue when you were away
 * would be inventing a second channel to say a thing the first one already
 * said.
 *
 * MOTION EXPLAINS, NEVER DECORATES. The only animation is the transition
 * between two glows, so a change you caused is visible as a change. It is
 * dropped entirely under `prefers-reduced-motion`.
 */
import { bulbGlow } from "../lib/aliveness";
import { t, type SupportedLocale } from "../lib/locales";

export interface BulbProps {
  locale: SupportedLocale;
  /**
   * Days since this person last kept anything. `null` while unknown — the bulb
   * burns full rather than dark, because an unfinished fetch is not evidence
   * that someone has been away.
   */
  quietDays: number | null;
}

export function Bulb({ locale, quietDays }: BulbProps): JSX.Element {
  const glow = bulbGlow(quietDays ?? 0);

  return (
    <div
      className="waka-bulb"
      /* The glow is one number and the stylesheet spends it, so every visual
         consequence of "how lit are you" stays in one place. */
      style={{ "--waka-glow": glow.toFixed(4) } as React.CSSProperties}
      role="img"
      aria-label={t(locale, "worldBulbLabel")}
    >
      <svg viewBox="0 0 120 150" width="120" height="150" aria-hidden="true" focusable="false">
        {/* The halo: the part that actually reads as brightness at a glance. */}
        <circle className="waka-bulb-halo" cx="60" cy="56" r="52" />
        {/* The glass, always drawn at full strength — the SHAPE is constant, so
            only the light inside it is saying anything. */}
        <path
          className="waka-bulb-glass"
          d="M60 10c-19.9 0-36 16.1-36 36 0 13.6 7.5 25.4 18.6 31.5 2.6 1.4 4.4 4.1 4.4 7.1v3.4h26v-3.4c0-3 1.8-5.7 4.4-7.1C88.5 71.4 96 59.6 96 46c0-19.9-16.1-36-36-36z"
        />
        {/* The filament: the lit interior. This is what the glow drives. */}
        <path
          className="waka-bulb-filament"
          d="M48 60c0-8 4-10 4-18s8-8 8 0 4 10 4 18"
        />
        {/* The cap. Structure, never meaning. */}
        <path className="waka-bulb-cap" d="M47 92h26M49 101h22M52 110h16" />
      </svg>
    </div>
  );
}
