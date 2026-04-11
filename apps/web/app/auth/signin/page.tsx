import { redirect } from "next/navigation";

import { PublicAuthShell } from "../../../src/auth/public-auth-shell.tsx";
import { resolveRuntimeAuthenticatedSessionFromCookies } from "../../../src/auth/runtime.ts";

interface SignInPageProps {
  searchParams?: Promise<{
    error?: string | string[];
    error_description?: string | string[];
  }>;
}

function readSearchParamValue(
  value: string | string[] | undefined,
): string | null {
  if (typeof value === "string") {
    return value.trim().length > 0 ? value.trim() : null;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string" && entry.trim().length > 0) {
        return entry.trim();
      }
    }
  }

  return null;
}

async function requestHasAuthSession(): Promise<boolean> {
  return (await resolveRuntimeAuthenticatedSessionFromCookies()) !== null;
}

export default async function SignInPage({
  searchParams,
}: SignInPageProps) {
  if (await requestHasAuthSession()) {
    redirect("/dashboard");
  }

  const resolvedSearchParams = (await searchParams) ?? {};
  const authError = readSearchParamValue(resolvedSearchParams.error);
  const authErrorDescription = readSearchParamValue(
    resolvedSearchParams.error_description,
  );

  return (
    <PublicAuthShell
      badge="Sign in"
      description="Open your Waka workspace and keep every capture in one place."
      primaryAction={{
        href: "/api/auth/signin/google",
        label: "Continue with Google",
      }}
      secondaryAction={{
        href:
          process.env.NODE_ENV === "production"
            ? "/"
            : "/api/auth/dev-signin",
        label:
          process.env.NODE_ENV === "production"
            ? "Back to Waka"
            : "Use local workspace",
      }}
      title="Pick up where you left off."
    >
      <div className="space-y-6">
        {authError === null ? (
          <div className="rounded-3xl border border-stone-200 bg-white/92 p-5 shadow-[0_24px_80px_rgba(28,25,23,0.08)]">
            <p className="text-sm font-medium text-stone-900">
              Google is the first sign-in option.
            </p>
            <p className="mt-3 text-sm leading-6 text-stone-600">
              Sign in once and keep writing in the same private workspace from
              any device you use.
            </p>
          </div>
        ) : (
          <div
            data-status="auth-error"
            className="rounded-3xl border border-rose-400/30 bg-rose-400/10 p-5"
          >
            <p className="text-sm uppercase tracking-[0.3em] text-rose-200">
              Sign-in issue
            </p>
            <p className="mt-3 text-lg font-medium text-rose-50">
              {authError}
            </p>
            {authErrorDescription === null ? null : (
              <p className="mt-2 text-sm leading-6 text-rose-100/80">
                {authErrorDescription}
              </p>
            )}
          </div>
        )}

        <div className="rounded-3xl border border-stone-200 bg-white/92 p-5 text-sm leading-6 text-stone-600 shadow-[0_24px_80px_rgba(28,25,23,0.08)]">
          If a private page sends you here, sign in first and Waka will take
          you back into your workspace.
        </div>
      </div>
    </PublicAuthShell>
  );
}
