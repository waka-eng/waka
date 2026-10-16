/** Native writers and panels own input before the spatial world's shortcuts. */
/* `.jar-roomform` AND `.jar-settings` CAME OUT on 2026-10-15: both matched
   nothing. `closest()` needs a wearer, and no markup in `src` carries either
   bare class — only the suffixed `.jar-roomform-box` (and, when this was written,
   `.jar-settings-warn`, which has since gone the same way),
   which these selectors do not match. `.jar-roomform`'s only bare wearer was
   the deleted room form; `.jar-settings`'s were the deleted join sheet and
   space-settings panel. Behaviour is unchanged by their removal, which is
   exactly the point: they had been deciding nothing. */
const SURFACE_SELECTOR = [
  "[data-jar-surface]", "[role='dialog']", "[role='menu']", "[data-jar-interactive]",
  ".jar-panel", ".jar-mouth", ".jar-mouth-slot--note",
  ".jar-seek", ".jar-prov-room", ".jar-dial",
  ".jar-values-room", ".jar-reading", ".jar-antechamber",
].join(", ");

export function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && (
    target.closest("input, textarea, select, [role='textbox']") !== null ||
    (target instanceof HTMLElement && target.isContentEditable) ||
    target.closest('[contenteditable="true"], [contenteditable=""]') !== null
  );
}

export function isNativeSurface(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(SURFACE_SELECTOR) !== null;
}
