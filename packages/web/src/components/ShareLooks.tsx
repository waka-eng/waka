/**
 * FOUR LOOKS, SHOWN RATHER THAN NAMED.
 *
 * The share sheet asked for a size from one dropdown and a style from
 * another — two form fields to answer one question, "what will it look
 * like", and the answer was two words that had to be imagined. Every card
 * product people actually post from shows the options as small versions of
 * themselves: the shape is the size and the colour is the style, and the
 * choice is one press.
 *
 * So: dark square, light square, dark story, light story. Each swatch is
 * drawn at the card's own proportions in the card's own ground, and its name
 * is spoken to assistive technology and shown on hover. The chosen one is
 * the one in full light — the press earns the light, as everywhere else.
 */
import type { ArtifactAppearance, ArtifactFormat } from "../lib/principle-artifact";
import { t, type SupportedLocale } from "../lib/locales";

const LOOKS: Array<{ appearance: ArtifactAppearance; format: ArtifactFormat }> = [
  { appearance: "dark", format: "square" },
  { appearance: "light", format: "square" },
  { appearance: "dark", format: "portrait" },
  { appearance: "light", format: "portrait" },
];

export function ShareLooks({ appearance, format, disabled, locale, onChange }: {
  appearance: ArtifactAppearance;
  format: ArtifactFormat;
  disabled?: boolean;
  locale: SupportedLocale;
  onChange: (look: { appearance: ArtifactAppearance; format: ArtifactFormat }) => void;
}) {
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  return (
    <div className="jar-share-looks" role="group" aria-label={say("worldShareLook")}>
      {LOOKS.map((look) => {
        const chosen = look.appearance === appearance && look.format === format;
        const label = `${say(look.appearance === "dark" ? "worldShareDark" : "worldShareLight")} · ${say(look.format === "square" ? "worldShareLookSquare" : "worldShareLookStory")}`;
        return (
          <button
            key={`${look.appearance}-${look.format}`}
            type="button"
            className="jar-share-look"
            aria-pressed={chosen}
            aria-label={label}
            title={label}
            disabled={disabled}
            onClick={() => onChange(look)}
          >
            <span className={`jar-share-swatch jar-share-swatch--${look.appearance} jar-share-swatch--${look.format}`} aria-hidden="true">
              <span className="jar-share-swatch-line" />
              <span className="jar-share-swatch-line jar-share-swatch-line--short" />
            </span>
          </button>
        );
      })}
    </div>
  );
}
