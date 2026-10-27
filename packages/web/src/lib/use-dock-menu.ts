/**
 * ONE BUTTON-AND-MENU, KEPT IN ONE PLACE.
 *
 * The bar has two small menus — the ＋ (`AddMenu`: Add photo, Add file) and
 * the ⋯ a narrow phone folds Share and Delete into (`NoteTools`). They were
 * two copies of the same keyboard and pointer rules, and the second copy
 * shipped without the arrow keys (review, 2026-10-17). So the rules live
 * here and both menus ask for them:
 *
 *   - opening moves focus to the first row, so Escape and the arrows reach
 *     the menu from the keyboard that opened it;
 *   - ArrowDown / ArrowUp rove (wrapping), Home / End jump to the ends;
 *   - Escape closes and returns focus to the button; Tab closes and lets
 *     focus go where Tab sends it;
 *   - a press anywhere outside closes it and leaves focus where that press
 *     put it (capture phase, so a surface that stops the event on its way
 *     down cannot keep the menu open behind it);
 *   - a button that becomes disabled takes its open menu with it.
 */
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export function useDockMenu(disabled?: boolean) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);
  const toggle = useCallback(() => {
    setOpen((was) => {
      if (was) button.current?.focus();
      return !was;
    });
  }, []);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const first = menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled)');
    (first ?? menu.current)?.focus();
    const outside = (event: PointerEvent) => {
      if (wrap.current && event.target instanceof Node && !wrap.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [open]);

  const onMenuKey = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "Tab") { setOpen(false); return; }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const rows = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled)') ?? [])];
    if (rows.length === 0) return;
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1
      : (at + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
    rows[next]?.focus();
  }, [close]);

  /** What the button needs: its ref, its ARIA, its press. */
  const buttonProps = {
    ref: button,
    "aria-haspopup": "menu" as const,
    "aria-expanded": open,
    "aria-controls": open ? menuId : undefined,
    onClick: toggle,
  };
  /** What the menu needs: its ref, its id, its role, its keys. */
  const menuProps = { ref: menu, id: menuId, role: "menu" as const, tabIndex: -1, onKeyDown: onMenuKey };

  return { open, close, wrap, buttonProps, menuProps };
}
