import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type HTMLAttributes } from "react";

interface DialogSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  onClose: () => void;
  active?: boolean;
}

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(
    'button, a[href], input, textarea, select, summary, [tabindex]',
  )).filter((element) => {
    if (element.tabIndex < 0 || element.matches(":disabled") ||
      element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    let at: HTMLElement | null = element;
    while (at && at !== root) {
      const style = window.getComputedStyle(at);
      if (style.display === "none" || style.visibility === "hidden") return false;
      at = at.parentElement;
    }
    return true;
  });
}

/** A native reading/writing surface owns focus, dismissal and scrolling. */
export const DialogSurface = forwardRef<HTMLDivElement, DialogSurfaceProps>(function DialogSurface(
  { active = true, onClose, onKeyDown, children, ...props }, forwardedRef,
) {
  const surface = useRef<HTMLDivElement>(null);
  const opener = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useImperativeHandle(forwardedRef, () => surface.current!, []);
  useLayoutEffect(() => {
    const node = surface.current, viewport = window.visualViewport;
    if (!active || !node || !viewport) return;
    // iOS keeps the layout viewport behind the keyboard. Only opt-in centered
    // writing sheets use these values; anchored menus keep their own position.
    const update = () => {
      if (!Number.isFinite(viewport.height) || viewport.height <= 0 || !Number.isFinite(viewport.offsetTop)) return;
      node.style.setProperty('--dialog-visible-height', `${viewport.height}px`);
      node.style.setProperty('--dialog-visible-top', `${viewport.offsetTop}px`);
      node.dataset.visualViewport = 'true';
    };
    update(); viewport.addEventListener('resize', update); viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update); viewport.removeEventListener('scroll', update);
      delete node.dataset.visualViewport;
      node.style.removeProperty('--dialog-visible-height'); node.style.removeProperty('--dialog-visible-top');
    };
  }, [active]);
  useLayoutEffect(() => {
    const node = surface.current;
    if (!active || !node) return;
    if (!node.contains(document.activeElement)) {
      (focusableWithin(node)[0] ?? node).focus({ preventScroll: true });
    }
    return () => {
      if (opener.current?.isConnected &&
        (node.contains(document.activeElement) || document.activeElement === document.body)) {
        opener.current.focus({ preventScroll: true });
      }
    };
  }, [active]);

  return <div {...props} ref={surface} role="dialog" aria-modal={active || undefined}
    aria-hidden={active ? undefined : true} tabIndex={-1} data-jar-surface="1"
    onKeyDown={(event) => {
      onKeyDown?.(event);
      if (!active || event.defaultPrevented || event.nativeEvent.isComposing ||
        event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      } else if (event.key === "Tab") {
        const items = focusableWithin(event.currentTarget);
        const first = items[0];
        const last = items.at(-1);
        if (!first || !last) {
          event.preventDefault();
          event.currentTarget.focus();
        } else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }}>{children}</div>;
});
