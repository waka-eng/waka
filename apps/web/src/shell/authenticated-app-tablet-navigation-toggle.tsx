"use client";

import { useAuthenticatedAppShellState } from "./authenticated-app-shell-context.tsx";
import { StableControlLabel } from "../ui/stable-control-label.tsx";

const AUTHENTICATED_APP_TABLET_NAVIGATION_TOGGLE_BUTTON_CLASS_NAME =
  "inline-flex min-h-11 items-center justify-center rounded-full border px-4 py-2.5 text-sm font-medium leading-5 whitespace-normal break-words transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200/70";

export function AuthenticatedAppTabletNavigationToggle() {
  const {
    isTabletNavigationOpen,
    registerTabletNavigationToggle,
    toggleTabletNavigation,
  } =
    useAuthenticatedAppShellState();

  return (
    <button
      aria-controls="authenticated-app-navigation"
      aria-expanded={isTabletNavigationOpen}
      aria-haspopup="dialog"
      aria-label={
        isTabletNavigationOpen
          ? "Hide workspace navigation"
          : "Show workspace navigation"
      }
      className={`${AUTHENTICATED_APP_TABLET_NAVIGATION_TOGGLE_BUTTON_CLASS_NAME} ${
        isTabletNavigationOpen
          ? "border-amber-300/35 bg-amber-300/12 text-amber-100 hover:bg-amber-300/15"
          : "border-stone-700 bg-stone-900/90 text-stone-100 hover:border-stone-600 hover:bg-stone-900"
      }`}
      data-action="authenticated-app-tablet-navigation-toggle"
      data-state={isTabletNavigationOpen ? "open" : "closed"}
      onClick={toggleTabletNavigation}
      ref={registerTabletNavigationToggle}
      type="button"
    >
      <StableControlLabel
        label={isTabletNavigationOpen ? "Hide navigation" : "Show navigation"}
        widestLabel="Hide navigation"
      />
    </button>
  );
}
