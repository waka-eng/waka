import type { ReactElement } from "react";

import type { SharedClusterCardData } from "../../../src/sharing/shared-cluster-page-data.ts";

function resolveSourceBadgeClassName(
  sourceType: SharedClusterCardData["inspirations"][number]["sourceType"],
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

export interface SharedClusterCardViewProps {
  cluster: SharedClusterCardData;
}

export function SharedClusterCardView({
  cluster,
}: SharedClusterCardViewProps): ReactElement {
  return (
    <main
      data-page="shared-cluster"
      className="min-h-screen w-full max-w-full overflow-x-hidden bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.14),_transparent_36%),linear-gradient(180deg,_#111827_0%,_#020617_100%)] text-slate-50"
    >
      <div className="mx-auto flex min-h-screen w-full max-w-6xl items-start justify-center px-4 py-10 sm:px-6 lg:px-8">
        <article className="w-full overflow-hidden rounded-[2rem] border border-slate-800 bg-slate-950/90 shadow-[0_32px_90px_rgba(2,6,23,0.45)] backdrop-blur">
          <div className="border-b border-slate-800 px-6 py-6 sm:px-8 sm:py-8">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1 text-[0.7rem] font-semibold tracking-[0.24em] text-slate-300">
                Waka share
              </span>
              <span className="inline-flex items-center rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-[0.7rem] font-semibold tracking-[0.22em] text-sky-100">
                COLLECTION
              </span>
              <span className="inline-flex items-center rounded-full border border-slate-700 px-3 py-1 text-xs font-medium text-slate-300">
                {cluster.itemCount} shared{" "}
                {cluster.itemCount === 1 ? "note" : "notes"}
              </span>
              <time
                className="inline-flex items-center rounded-full border border-slate-700 px-3 py-1 text-xs font-medium text-slate-300"
                dateTime={cluster.createdAt}
              >
                {cluster.createdLabel}
              </time>
            </div>

            <div className="mt-6 space-y-4">
              <p className="text-xs uppercase tracking-[0.24em] text-sky-300">
                Shared collection
              </p>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-50 sm:text-4xl">
                {cluster.label}
              </h1>
              <p className="max-w-3xl text-base leading-7 text-slate-300 sm:text-lg">
                {cluster.description}
              </p>
            </div>
          </div>

          <div className="grid gap-6 px-6 py-6 sm:px-8 sm:py-8 lg:grid-cols-[minmax(0,1.45fr)_minmax(16rem,0.78fr)]">
            <section className="space-y-4">
              {cluster.inspirations.length === 0 ? (
                <div className="rounded-[1.5rem] border border-slate-800 bg-slate-900/70 p-5">
                  <p className="text-sm leading-7 text-slate-300">
                    This collection is shared, but there are no notes in it
                    right now.
                  </p>
                </div>
              ) : (
                <ol className="space-y-4">
                  {cluster.inspirations.map((inspiration) => (
                    <li
                      key={inspiration.id}
                      className="rounded-[1.5rem] border border-slate-800 bg-slate-900/70 p-5"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={resolveSourceBadgeClassName(
                            inspiration.sourceType,
                          )}
                        >
                          {inspiration.sourceLabelShort}
                        </span>
                        {inspiration.domain === undefined ? null : (
                          <span className="inline-flex items-center rounded-full border border-slate-700 px-3 py-1 text-xs font-medium text-slate-300">
                            {inspiration.domain}
                          </span>
                        )}
                        <time
                          className="inline-flex items-center rounded-full border border-slate-700 px-3 py-1 text-xs font-medium text-slate-300"
                          dateTime={inspiration.createdAt}
                        >
                          {inspiration.createdLabel}
                        </time>
                      </div>

                      <div className="mt-4 space-y-3">
                        <h2 className="text-xl font-semibold tracking-tight text-slate-50">
                          {inspiration.title}
                        </h2>
                        <p className="text-sm leading-7 text-slate-300">
                          {inspiration.summary}
                        </p>
                        <p className="text-sm leading-7 text-slate-400">
                          {inspiration.excerpt}
                        </p>
                      </div>

                      {inspiration.tags.length === 0 ? null : (
                        <ul className="mt-4 flex flex-wrap gap-2">
                          {inspiration.tags.map((tag) => (
                            <li
                              key={tag}
                              className="rounded-full border border-slate-700 bg-slate-950/70 px-3 py-1 text-xs font-medium text-slate-200"
                            >
                              #{tag}
                            </li>
                          ))}
                        </ul>
                      )}

                      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-slate-300">
                        <span>{inspiration.sourceLabel}</span>
                        {inspiration.sourceUrl === undefined ? null : (
                          <a
                            className="text-sky-200 transition hover:text-sky-100"
                            href={inspiration.sourceUrl}
                            rel="noreferrer"
                            target="_blank"
                          >
                            Open link
                          </a>
                        )}
                        {inspiration.shareSlug === undefined ? null : (
                          <a
                            className="text-slate-100 transition hover:text-white"
                            href={`/s/${inspiration.shareSlug}`}
                          >
                            Open shared note
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <aside className="space-y-4 rounded-[1.5rem] border border-slate-800 bg-[linear-gradient(180deg,_rgba(15,23,42,0.95),_rgba(2,6,23,0.98))] p-5">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
                  Shared from
                </p>
                <p className="mt-2 text-sm text-slate-200">
                  This page shows only the notes the owner chose to share.
                </p>
              </div>

              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
                  Collection scope
                </p>
                <p className="mt-2 text-sm text-slate-200">
                  This collection reflects what the owner has shared right now.
                </p>
              </div>
            </aside>
          </div>
        </article>
      </div>
    </main>
  );
}
