/** Native writers and panels own input before the spatial world's shortcuts. */
const SURFACE_SELECTOR = [
  "[data-jar-surface]", "[role='dialog']", "[role='menu']", "[data-jar-interactive]",
  ".jar-panel", ".jar-mouth", ".jar-mouth-slot--note", ".jar-roomform",
  ".jar-seek", ".jar-settings", ".jar-prov-room", ".jar-dial",
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
