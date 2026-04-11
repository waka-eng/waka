import { redirect } from "next/navigation";

import { PublicAuthShell } from "../src/auth/public-auth-shell.tsx";
import { resolveRuntimeAuthenticatedSessionFromCookies } from "../src/auth/runtime.ts";

const LANDING_FEATURES = [
  {
    eyebrow: "Capture anywhere",
    title: "Start with whatever you have.",
    body: "Save a note, link, voice memo, photo, or pasted chat without deciding where it belongs first.",
  },
  {
    eyebrow: "Stay in motion",
    title: "Keep moving after the save.",
    body: "Waka protects the raw thought first so you are not stuck waiting for cleanup before the next idea arrives.",
  },
  {
    eyebrow: "Share on purpose",
    title: "Only send what matters.",
    body: "Your workspace stays personal. When something is ready, you can share a single note or a focused collection.",
  },
] as const;

const LANDING_REASSURANCE = [
  "One workspace for quick notes, links, photos, voice, and pasted chats.",
  "Drafts stay in place while the save finishes.",
  "Helpful structure can catch up after the idea is safe.",
] as const;

async function requestHasAuthSession(): Promise<boolean> {
  return (await resolveRuntimeAuthenticatedSessionFromCookies()) !== null;
}

export default async function LandingPage() {
  if (await requestHasAuthSession()) {
    redirect("/dashboard");
  }

  return (
    <PublicAuthShell
      badge="Waka"
      description="Save notes, links, photos, voice memos, and pasted chats in one workspace. Waka keeps the rough thought safe first, then helps you return to it with more context later."
      primaryAction={{
        href: "/auth/signin",
        label: "Sign in with Google",
      }}
      title="Keep the thought. Organize it when you're ready."
    >
      <section className="grid gap-4 md:grid-cols-3">
        {LANDING_FEATURES.map((feature) => (
          <article
            key={feature.title}
            className="rounded-[1.75rem] border border-stone-200 bg-white/92 p-5 shadow-[0_24px_80px_rgba(28,25,23,0.08)]"
          >
            <p className="text-xs uppercase tracking-[0.24em] text-amber-700">
              {feature.eyebrow}
            </p>
            <h2 className="mt-3 text-xl font-semibold tracking-tight text-stone-900">
              {feature.title}
            </h2>
            <p className="mt-3 text-sm leading-6 text-stone-600">
              {feature.body}
            </p>
          </article>
        ))}
      </section>

      <section className="rounded-[2rem] border border-stone-200 bg-white/92 p-6 shadow-[0_24px_80px_rgba(28,25,23,0.08)]">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
          <div className="space-y-4">
            <p className="text-xs uppercase tracking-[0.24em] text-amber-700">
              What it feels like
            </p>
            <h2 className="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">
              Capture now. Make sense of it when you come back.
            </h2>
            <p className="max-w-2xl text-sm leading-7 text-stone-600 sm:text-base">
              Waka is built for the messy first pass. You save the thought while
              it is still fragile, then let the workspace help you revisit,
              group, and share it when it becomes useful.
            </p>
            <ul className="grid gap-3 text-sm leading-6 text-stone-700">
              {LANDING_REASSURANCE.map((item) => (
                <li
                  key={item}
                  className="rounded-[1rem] border border-stone-200 bg-stone-50 px-4 py-3"
                >
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <aside className="rounded-[1.75rem] border border-stone-200 bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.16),_transparent_42%),linear-gradient(180deg,_#fffdf8_0%,_#f5efe4_100%)] p-5">
            <p className="text-xs uppercase tracking-[0.24em] text-stone-500">
              A calmer flow
            </p>
            <div className="mt-4 space-y-4">
              <div className="rounded-[1rem] border border-white/80 bg-white/80 px-4 py-4">
                <p className="text-sm font-medium text-stone-900">Save first</p>
                <p className="mt-2 text-sm leading-6 text-stone-600">
                  The note lands before you are asked to shape it.
                </p>
              </div>
              <div className="rounded-[1rem] border border-white/80 bg-white/80 px-4 py-4">
                <p className="text-sm font-medium text-stone-900">
                  Return with context
                </p>
                <p className="mt-2 text-sm leading-6 text-stone-600">
                  Titles, summaries, and related notes are there when you need
                  them, not before.
                </p>
              </div>
              <div className="rounded-[1rem] border border-white/80 bg-white/80 px-4 py-4">
                <p className="text-sm font-medium text-stone-900">
                  Share deliberately
                </p>
                <p className="mt-2 text-sm leading-6 text-stone-600">
                  Public pages stay separate from your private workspace.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="rounded-[2rem] border border-stone-200 bg-white/92 p-6 shadow-[0_24px_80px_rgba(28,25,23,0.08)]">
        <p className="text-sm font-medium text-stone-900">
          Sign in and Waka opens with capture ready right away.
        </p>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-600">
          Public pages stay simple and read-only. Creating and editing only
          appear inside your private workspace.
        </p>
      </section>
    </PublicAuthShell>
  );
}
