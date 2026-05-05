/**
 * <BackgroundField /> — fixed-position decorative background layer.
 *
 * Reproduces the three-blob parchment wash + grain noise overlay from the
 * original `index.html`:
 *
 *   <div class="bg-field" aria-hidden="true">
 *     <div class="bg-blob b1" id="blob1"></div>
 *     <div class="bg-blob b2" id="blob2"></div>
 *     <div class="bg-blob b3" id="blob3"></div>
 *   </div>
 *   <div class="noise" aria-hidden="true"></div>
 *
 * The blobs sit at z-index 0, the noise at z-index 1, and content layers
 * (`.wrap`) at z-index 2. The fade/scale animation is driven by adding the
 * `dropped` class to <body> when an inspiration save lands; that hook is
 * preserved so future sub-ACs can wire it in without modifying this shell.
 *
 * Decorative only — `aria-hidden` shields the whole stack from assistive
 * tech, matching the prototype.
 */

export function BackgroundField(): JSX.Element {
  return (
    <>
      <div className="bg-field" aria-hidden="true">
        {/*
          IDs preserved from the prototype (`blob1`/`blob2`/`blob3`) in case
          imperative animation hooks reach for them by id. The CSS targets
          the class names (`.bg-blob.b1` …), so the IDs are pure breadcrumbs.
        */}
        <div className="bg-blob b1" id="blob1" />
        <div className="bg-blob b2" id="blob2" />
        <div className="bg-blob b3" id="blob3" />
      </div>
      <div className="noise" aria-hidden="true" />
    </>
  );
}

export default BackgroundField;
