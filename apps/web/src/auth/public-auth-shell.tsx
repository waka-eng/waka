import Link from "next/link";
import type { ReactNode } from "react";

interface PublicAuthShellAction {
  href: string;
  label: string;
}

export interface PublicAuthShellProps {
  badge: string;
  children?: ReactNode;
  description: string;
  primaryAction: PublicAuthShellAction;
  secondaryAction?: PublicAuthShellAction;
  title: string;
}

function PublicAuthShellLink({
  action,
  variant,
}: {
  action: PublicAuthShellAction;
  variant: "primary" | "secondary";
}) {
  return (
    <Link
      className={
        variant === "primary"
          ? "inline-flex min-h-11 w-full items-center justify-center rounded-full bg-stone-950 px-4 py-2.5 text-center text-sm font-semibold leading-5 whitespace-normal break-words text-white no-underline shadow-[0_18px_40px_rgba(28,25,23,0.18)] transition hover:bg-stone-800 min-[56rem]:min-h-12 min-[56rem]:w-auto min-[56rem]:px-5 min-[56rem]:py-3"
          : "inline-flex min-h-11 w-full items-center justify-center rounded-full border border-stone-300 bg-white px-4 py-2.5 text-center text-sm font-semibold leading-5 whitespace-normal break-words text-stone-700 no-underline transition hover:border-stone-400 hover:bg-stone-50 min-[56rem]:min-h-12 min-[56rem]:w-auto min-[56rem]:px-5 min-[56rem]:py-3"
      }
      href={action.href}
    >
      {action.label}
    </Link>
  );
}

export function PublicAuthShell({
  badge,
  children,
  description,
  primaryAction,
  secondaryAction,
  title,
}: PublicAuthShellProps) {
  return (
    <main
      data-layout="public-auth-shell"
      className="min-h-screen w-full max-w-full overflow-x-hidden bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.10),_transparent_28%),linear-gradient(180deg,_#fcfbf8_0%,_#f5f1e8_100%)] text-stone-900"
    >
      <div className="waka-shell-container waka-public-shell-container">
        <section className="w-full min-w-0 max-w-4xl space-y-8">
          <p className="text-sm uppercase tracking-[0.28em] text-amber-700">
            {badge}
          </p>
          <div className="space-y-4">
            <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-stone-950 min-[56rem]:text-6xl">
              {title}
            </h1>
            <p className="max-w-3xl text-base leading-7 text-stone-600 min-[56rem]:text-xl min-[56rem]:leading-8">
              {description}
            </p>
          </div>
          <div className="flex w-full flex-col items-stretch gap-3 min-[56rem]:flex-row min-[56rem]:flex-wrap min-[56rem]:items-center">
            <PublicAuthShellLink action={primaryAction} variant="primary" />
            {secondaryAction === undefined ? null : (
              <PublicAuthShellLink
                action={secondaryAction}
                variant="secondary"
              />
            )}
          </div>
        </section>
        <div className="grid w-full min-w-0 max-w-5xl gap-6">
          {children}
        </div>
      </div>
    </main>
  );
}
