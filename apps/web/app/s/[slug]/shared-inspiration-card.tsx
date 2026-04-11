import type { ReactElement } from "react";

import type { SharedInspirationCardData } from "../../../src/sharing/shared-inspiration-page-data.ts";

function resolveSourceBadgeClassName(
  sourceType: SharedInspirationCardData["sourceType"],
): string {
  switch (sourceType) {
    case "TEXT_NOTE":
      return "inline-flex items-center rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-[0.7rem] font-semibold tracking-[0.2em] text-amber-100";
    case "URL_IMPORT":
      return "inline-flex items-center rounded-full border border-sky-300/30 bg-sky-300/10 px-3 py-1 text-[0.7rem] font-semibold tracking-[0.2em] text-sky-100";
    case "VOICE_NOTE":
      return "inline-flex items-center rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1 text-[0.7rem] font-semibold tracking-[0.2em] text-emerald-100";
    case "PHOTO":
      return "inline-flex items-center rounded-full border border-fuchsia-300/30 bg-fuchsia-300/10 px-3 py-1 text-[0.7rem] font-semibold tracking-[0.2em] text-fuchsia-100";
    case "CLI_CONVERSATION":
      return "inline-flex items-center rounded-full border border-stone-300/30 bg-stone-300/10 px-3 py-1 text-[0.7rem] font-semibold tracking-[0.2em] text-stone-100";
    case "AI_CONVERSATION":
      return "inline-flex items-center rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-[0.7rem] font-semibold tracking-[0.2em] text-cyan-100";
  }
}

export interface SharedInspirationCardViewProps {
  inspiration: SharedInspirationCardData;
}

export function SharedInspirationCardView({
  inspiration,
}: SharedInspirationCardViewProps): ReactElement {
  return (
    <main
      data-page="shared-inspiration"
      className="min-h-screen w-full max-w-full overflow-x-hidden bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.14),_transparent_38%),linear-gradient(180deg,_#1c1917_0%,_#0c0a09_100%)] text-stone-50"
    >
      <div className="mx-auto flex min-h-screen w-full max-w-5xl items-center justify-center px-4 py-10 sm:px-6 lg:px-8">
        <article className="w-full max-w-3xl overflow-hidden rounded-[2rem] border border-stone-800 bg-stone-950/85 shadow-[0_32px_90px_rgba(0,0,0,0.38)] backdrop-blur">
          <div className="border-b border-stone-800 px-6 py-6 sm:px-8 sm:py-8">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-stone-700 bg-stone-900/80 px-3 py-1 text-[0.7rem] font-semibold tracking-[0.24em] text-stone-300">
                Waka share
              </span>
              <span className={resolveSourceBadgeClassName(inspiration.sourceType)}>
                {inspiration.sourceLabelShort}
              </span>
              {inspiration.domain === undefined ? null : (
                <span className="inline-flex items-center rounded-full border border-stone-700 px-3 py-1 text-xs font-medium text-stone-300">
                  {inspiration.domain}
                </span>
              )}
              <time
                className="inline-flex items-center rounded-full border border-stone-700 px-3 py-1 text-xs font-medium text-stone-300"
                dateTime={inspiration.createdAt}
              >
                {inspiration.createdLabel}
              </time>
            </div>

            <div className="mt-6 space-y-4">
              <p className="text-xs uppercase tracking-[0.24em] text-amber-300">
                Shared note
              </p>
              <h1 className="text-3xl font-semibold tracking-tight text-stone-50 sm:text-4xl">
                {inspiration.title}
              </h1>
              <p className="max-w-2xl text-base leading-7 text-stone-300 sm:text-lg">
                {inspiration.summary}
              </p>
            </div>

            {inspiration.tags.length === 0 ? null : (
              <ul className="mt-6 flex flex-wrap gap-2">
                {inspiration.tags.map((tag) => (
                  <li
                    key={tag}
                    className="rounded-full border border-stone-700 bg-stone-900/70 px-3 py-1 text-xs font-medium text-stone-200"
                  >
                    #{tag}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid gap-6 px-6 py-6 sm:px-8 sm:py-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(14rem,0.8fr)]">
            <section className="rounded-[1.5rem] border border-stone-800 bg-stone-900/70 p-5">
              <p className="text-xs uppercase tracking-[0.22em] text-stone-500">
                Saved note
              </p>
              <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-stone-200 sm:text-base">
                {inspiration.rawContent}
              </p>
            </section>

            <aside className="space-y-4 rounded-[1.5rem] border border-stone-800 bg-[linear-gradient(180deg,_rgba(28,25,23,0.95),_rgba(12,10,9,0.98))] p-5">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-stone-500">
                  Source
                </p>
                <p className="mt-2 text-sm font-medium text-stone-100">
                  {inspiration.sourceLabel}
                </p>
              </div>

              {inspiration.domain === undefined ? null : (
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-stone-500">
                    Domain
                  </p>
                  <p className="mt-2 break-words text-sm text-stone-200">
                    {inspiration.domain}
                  </p>
                </div>
              )}

              {inspiration.sourceUrl === undefined ? null : (
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-stone-500">
                    Original link
                  </p>
                  <a
                    className="mt-2 inline-flex break-all text-sm text-amber-200 transition hover:text-amber-100"
                    href={inspiration.sourceUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {inspiration.sourceUrl}
                  </a>
                </div>
              )}

              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-stone-500">
                  Shared from
                </p>
                <p className="mt-2 text-sm text-stone-200">
                  This note was shared from a private Waka workspace.
                </p>
              </div>
            </aside>
          </div>
        </article>
      </div>
    </main>
  );
}
