"use client";

import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

const TABLET_NAVIGATION_MEDIA_QUERY =
  "(min-width: 56rem) and (max-width: 79.99875rem)";

function matchesTabletNavigationViewport(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(TABLET_NAVIGATION_MEDIA_QUERY).matches
  );
}

export interface AuthenticatedAppShellState {
  closeTabletNavigation: (options?: { restoreFocus?: boolean }) => void;
  isTabletNavigationOpen: boolean;
  registerTabletNavigationToggle: (
    element: HTMLButtonElement | null,
  ) => void;
  toggleTabletNavigation: () => void;
}

const AuthenticatedAppShellContext =
  createContext<AuthenticatedAppShellState | null>(null);

export interface AuthenticatedAppShellProviderProps {
  children: ReactNode;
}

export function AuthenticatedAppShellProvider({
  children,
}: AuthenticatedAppShellProviderProps) {
  const pathname = usePathname();
  const [isTabletNavigationOpen, setIsTabletNavigationOpen] = useState(false);
  const tabletNavigationToggleRef = useRef<HTMLButtonElement | null>(null);

  const registerTabletNavigationToggle = useCallback(
    (element: HTMLButtonElement | null) => {
      tabletNavigationToggleRef.current = element;
    },
    [],
  );

  const closeTabletNavigation = useCallback(
    ({ restoreFocus = true }: { restoreFocus?: boolean } = {}) => {
      setIsTabletNavigationOpen(false);

      if (!restoreFocus || !matchesTabletNavigationViewport()) {
        return;
      }

      const toggleElement = tabletNavigationToggleRef.current;

      if (toggleElement === null) {
        return;
      }

      window.requestAnimationFrame(() => {
        toggleElement.focus();
      });
    },
    [],
  );

  useEffect(() => {
    setIsTabletNavigationOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!isTabletNavigationOpen) {
      return;
    }

    function handleWindowKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeTabletNavigation();
      }
    }

    window.addEventListener("keydown", handleWindowKeydown);

    return () => {
      window.removeEventListener("keydown", handleWindowKeydown);
    };
  }, [closeTabletNavigation, isTabletNavigationOpen]);

  useEffect(() => {
    if (
      !isTabletNavigationOpen ||
      typeof document === "undefined" ||
      !matchesTabletNavigationViewport()
    ) {
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [isTabletNavigationOpen]);

  useEffect(() => {
    if (!isTabletNavigationOpen || !matchesTabletNavigationViewport()) {
      return;
    }

    const mediaQueryList = window.matchMedia(TABLET_NAVIGATION_MEDIA_QUERY);

    function handleViewportChange(event: MediaQueryListEvent) {
      if (!event.matches) {
        setIsTabletNavigationOpen(false);
      }
    }

    mediaQueryList.addEventListener("change", handleViewportChange);

    return () => {
      mediaQueryList.removeEventListener("change", handleViewportChange);
    };
  }, [isTabletNavigationOpen]);

  return (
    <AuthenticatedAppShellContext.Provider
      value={{
        closeTabletNavigation,
        isTabletNavigationOpen,
        registerTabletNavigationToggle,
        toggleTabletNavigation: () => {
          if (isTabletNavigationOpen) {
            closeTabletNavigation({ restoreFocus: false });
            return;
          }

          setIsTabletNavigationOpen(true);
        },
      }}
    >
      {children}
    </AuthenticatedAppShellContext.Provider>
  );
}

export function useAuthenticatedAppShellState(): AuthenticatedAppShellState {
  const shellState = useContext(AuthenticatedAppShellContext);

  if (shellState === null) {
    throw new Error(
      "AuthenticatedAppShellProvider is required for authenticated workspace views.",
    );
  }

  return shellState;
}
