"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface AuthenticatedAppNavigationItem {
  description: string;
  href: string;
  label: string;
}

const AUTHENTICATED_APP_NAVIGATION_ITEMS: readonly AuthenticatedAppNavigationItem[] =
  [
    {
      description: "Capture, revisit, and regroup the notes you keep.",
      href: "/dashboard",
      label: "Workspace",
    },
    {
      description: "Manage API keys and the tools that can save here.",
      href: "/settings",
      label: "Settings",
    },
  ] as const;

function normalizePathname(pathname: string): string {
  if (pathname === "/") {
    return pathname;
  }

  return pathname.replace(/\/+$/u, "");
}

function isAuthenticatedAppNavigationItemActive(
  pathname: string,
  itemHref: string,
): boolean {
  const normalizedPathname = normalizePathname(pathname);
  const normalizedItemHref = normalizePathname(itemHref);

  return (
    normalizedPathname === normalizedItemHref ||
    normalizedPathname.startsWith(`${normalizedItemHref}/`)
  );
}

export function AuthenticatedAppNavigation() {
  const pathname = usePathname() ?? "/dashboard";

  return (
    <nav
      aria-label="Workspace navigation"
      data-layout="authenticated-app-navigation"
      id="authenticated-app-navigation"
      className="waka-authenticated-shell-navigation"
    >
      <div className="waka-authenticated-shell-navigation-panel">
        <div className="flex min-w-0 flex-col gap-4 min-[56rem]:flex-row min-[56rem]:items-center min-[56rem]:justify-between">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.32em] text-amber-700">
              Waka
            </p>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              Keep the rough thought. Let the workspace organize it later.
            </p>
          </div>

          <ul
            data-layout="authenticated-app-navigation-list"
            className="waka-authenticated-shell-navigation-list"
          >
            {AUTHENTICATED_APP_NAVIGATION_ITEMS.map((item) => {
              const isActive = isAuthenticatedAppNavigationItemActive(
                pathname,
                item.href,
              );

              return (
                <li key={item.href} className="min-w-0">
                  <Link
                    aria-current={isActive ? "page" : undefined}
                    className={`waka-authenticated-shell-navigation-link flex min-w-0 flex-col gap-1 rounded-full border text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70 ${
                      isActive
                        ? "border-amber-300 bg-amber-50 text-stone-950"
                        : "border-stone-200 bg-white/85 text-stone-700 hover:border-stone-300 hover:bg-white"
                    }`}
                    href={item.href}
                  >
                    <span className="truncate text-sm font-semibold">
                      {item.label}
                    </span>
                    <span
                      className={`waka-authenticated-shell-navigation-description text-xs leading-5 ${
                        isActive ? "text-stone-700" : "text-stone-500"
                      }`}
                    >
                      {item.description}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </nav>
  );
}
