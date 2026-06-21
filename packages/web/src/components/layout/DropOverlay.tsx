/**
 * <DropOverlay /> — drag-and-drop hint overlay shell.
 *
 * Mirrors the prototype:
 *
 *   <div class="drop-overlay" aria-hidden="true">
 *     <div class="card">Drop anywhere — link, image, or note</div>
 *   </div>
 *
 * The overlay is invisible by default and fades in when `body.dragging` is
 * set (via dragenter/dragleave handlers wired up by a later sub-AC). Keeping
 * the structural shell here means the eventual drag handler only has to
 * toggle the body class — no DOM injection.
 */

interface DropOverlayProps {
  label?: string;
}

export function DropOverlay({ label = "Drop anywhere — link, image, or note" }: DropOverlayProps): JSX.Element {
  return (
    <div className="drop-overlay" aria-hidden="true">
      <div className="card">{label}</div>
    </div>
  );
}

export default DropOverlay;
