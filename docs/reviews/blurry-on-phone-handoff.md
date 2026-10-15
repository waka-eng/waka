# The creature looks blurry on a phone — what has been ruled out

Founder, 2026-10-12, from an iPhone: *"케릭터 화질 왜이래 휴대폰으로 볼때?"*
and, after the first wrong answer: *"에이전트 형태의 렌더링 문제가 아니라
그냥 이미지 자체가 흐릿하잖아."* Desktop is fine. Four attempts failed.

**This file exists so the next attempt does not repeat them.** Everything
below was measured, not reasoned.

## The sentence that kills most candidates

> **The defect does not reproduce in Chromium at deviceScaleFactor 3.**
> Therefore anything measurable in Chromium at dpr 3 is not the cause.

Three of the four attempts died on this, and the fourth died on it twice —
its own commit measured a magnification in Chromium while claiming Chromium
could not reproduce the symptom. Both cannot be true of one cause. Apply
this test to any new candidate before writing code.

## Ruled out, with evidence

| Candidate | Why it is not the cause |
|---|---|
| **Canvas backing store / pixel ratio** | Measured 1179×2556 on a 393×852 viewport at dpr 3 — ratio exactly 3.000. One drawn pixel per physical pixel. The 2026-09-08 fix in `canvas/scale.ts` holds. |
| **`imageSmoothingQuality` defaulting to "low"** | Compared byte for byte on the product's real configuration: **zero pixels differ** between "low" and "high" in **both Chromium and WebKit**, at 0.5×, 0.21× and 0.10×, at dpr 2 and dpr 3. The hint bites only on a `willReadFrequently` software raster, which this product never requests. It also cost 0.6–1.8 ms/frame, all on upscales. Reverted in `01ecbaab`. |
| **The body's 0.5× downscale** (`BODY_PX` 240 → `CHAR_SIZE` 120) | Baking at the drawn size instead measures **+1.5%**. Not a visible cause. |
| **The grain film being magnified 3×** | Real (measured exactly 3.00×) but cannot be the blur: the layer is `opacity: 0.035` at normal blend — a **9-out-of-255** perturbation. A 96.5%-transparent additive dither cannot soften anything beneath it. Sharpening it also made the dither **38–40% worse** and coarsened the creature's matte 45–61%. Reverted in `1b6e4d55`. |
| **The aura's bake dither being too weak** | Measured flat-run lengths against jitter amplitude on a phone-scale aura over near-black: none 3.87 → **±1 (current) 1.56** → ±2 1.27 → ±3 1.18. The current ±1 already does the work; raising it buys 19% and adds visible noise to the glow. |

## Genuinely fixed along the way (but not the cause)

- **`restPose` ignored dpr entirely** — `round(size / BODY_PX * 4)`, so at 88 CSS
  px and dpr 3 it baked 240px for a 264px paint. A true **magnification** of the
  login/onboarding companion, and the only one in the product. Fixed and gated
  (`bake-covers-paint.test.ts`). Note the earlier "7% softer" figure does **not**
  reproduce — it came from mean gradient.
- The loading screen at 190 CSS px/dpr 1 was baking 720px to paint 190 — a 0.264×
  reduction that **aliases**. Now ~2× more faithful for a ninth of the memory.

## Methodological warnings

- **Do not use mean gradient as a sharpness metric.** It rewards aliasing and
  calls it sharpness. Both discredited headline numbers came from it. Measure RMS
  against a ground truth baked at 4×/6×/8×/12× the paint and reduced in halving
  steps.
- **Desktop WebKit is available to Playwright** (`webkit-2287`) and says the
  filter hint is inert on an accelerated canvas. That is evidence, not proof, for
  iOS Safari — a different raster backend.
- The low-quality path can be forced in Chromium by redefining the
  `imageSmoothingQuality` accessor on the prototype in an init script. Useful for
  A/B without touching source.

## The leading unexplored candidate

**Near-black 8-bit contour banding in the companion's glow, visible on an OLED
phone and invisible on a desktop LCD.** It fits every constraint the ruled-out
candidates fail:

- Strip the dither and the glow carries flat luma runs up to **252 device px**.
- The glow is **529 CSS px wide — 135% of a 393px phone viewport, versus 37% of a
  1440px desktop.** On a phone the creature and its glow are essentially the whole
  visual field.
- `canvas/sprites.ts` already says the banding "lives IN the blacks" and that the
  remedy was tuned where it cannot be seen.
- It is **screen-technology dependent, not resolution dependent**, which is the
  only shape that explains desktop-fine / phone-blurry / Chromium-cannot-reproduce
  all at once.

Second candidate, which no bake arithmetic will fix: on a phone the thing filling
the screen is a smooth gradient with no detail in it, while on a desktop it is a
small object ringed by sharp type. *"이미지 자체가 흐릿하다"* is consistent with
"the thing filling my screen has no detail" — a design property, not a defect.

## What the next attempt needs first

**A photograph of the creature, taken on the actual phone, zoomed in.** It
separates the three remaining possibilities in one look:

- concentric rings in the glow → **banding**, chase the dither in the blacks
- everything uniformly soft, edges included → a **resample** still unfound
- edges crisp but the gradient coarse → **OLED/display**, not rendering

Do not ship a fifth attempt without it. Four were lost to reasoning from a symptom
nobody could reproduce.
