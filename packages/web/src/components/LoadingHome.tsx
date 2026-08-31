/**
 * THE LOADING SCREEN IS THE WORLD, EARLY.
 *
 * Two founder rulings, 2026-08-27: "loading page should be this black color"
 * (pointing at the world's own ground) and "can we have the character already
 * there in the loading screen? and continue your draft should say LOADING
 * instead". Loading used to be a white page with a word on it — the product
 * changing clothes twice on the way in. Now the way in looks like arriving:
 * the ground is already the ground, the companion is already home, and the
 * one line under it says the only fact there is. When the world wakes, the
 * real being stands where this one stood.
 *
 * Inline styles, deliberately and only here: this face renders BEFORE `.jar`
 * exists, outside the subtree that defines every `--jar-*` token (the drawer
 * once portalled to `document.body` and lost the whole palette the same way),
 * so `var()` would resolve to nothing. The values mirror the world's: the
 * ground is `--jar-atmos`'s value, the glow is the warm note's, the body is
 * the being's ivory as the bake renders it.
 */

import { readStoredLocale, t } from "../lib/locales";

const ground = "#06080d";
const ivoryHigh = "#ece7db";
const ivoryLow = "#d9d3c5";
const nub = "#d9d4c8";
const eye = "#141412";

export function LoadingHome(): JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="loading"
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
      <div style={{ position: "relative", width: 240, height: 190 }}>
        {/* the same warm halo the bake gives the resting being */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: -110,
            background:
              "radial-gradient(circle at 50% 46%, rgba(255,242,220,0.14), rgba(255,242,220,0) 62%)",
          }}
        />
        {/* the hands, tucked at the cheeks the way the bake rests them */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: -4,
            bottom: 26,
            width: 46,
            height: 46,
            borderRadius: "50%",
            background: nub,
          }}
        />
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            right: -4,
            bottom: 26,
            width: 46,
            height: 46,
            borderRadius: "50%",
            background: nub,
          }}
        />
        {/* the dome, lit from above the way the world lights it */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 10,
            right: 10,
            top: 0,
            bottom: 0,
            borderRadius: "52% 52% 46% 46% / 62% 62% 40% 40%",
            background: `radial-gradient(ellipse at 50% 26%, ${ivoryHigh}, ${ivoryLow} 78%)`,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: "33%",
              top: "39%",
              width: 13,
              height: 13,
              borderRadius: "50%",
              background: eye,
            }}
          />
          <div
            style={{
              position: "absolute",
              right: "33%",
              top: "39%",
              width: 13,
              height: 13,
              borderRadius: "50%",
              background: eye,
            }}
          />
        </div>
      </div>
      {/* the resting line's slot, wearing the label register's face; the word
          is the only honest one this early */}
      <div
        style={{
          marginTop: 96,
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

export default LoadingHome;
