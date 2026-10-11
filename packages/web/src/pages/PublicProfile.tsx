/**
 * /@handle — somebody's top of mind, read by somebody else.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS PAGE LOOKED LIKE A DIFFERENT PRODUCT, measured rather than felt.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Law 5 of `docs/six-laws.md` names this file by name as a surface that had
 * never been through a craft pass, and the founder's sentence for it is the
 * one he has said about every such surface: "why this screen so different? it
 * should get the full changes from [the other screen]."
 *
 * What was here: a wall of five PASTEL POST-IT NOTES. Each note carried its
 * own paper colour and its own ink colour from a table in this file —
 * `#ece4cb` on `#4a3e1f`, `#e8d4ce` on `#6b3c34`, three more — plus a random
 * tilt in degrees, a hand-set width in pixels, and a `--decay` ramp that
 * faded AND DESATURATED each note further down the wall. The notes said
 * `cursor: grab` on a page where nothing can be dragged.
 *
 * Every one of those is a founder ruling broken in place:
 *
 *   LIGHT IS THE ONLY MEANING CHANNEL. Five hues, each meaning "you are the
 *   third note", is a second channel invented to say a thing the first one
 *   already says — and `filter: saturate()` is a third. The product drains
 *   `--error` of hue with the note "there is no red in Waka"; this page had
 *   five colours of paper.
 *
 *   A CONTROL NAMES WHAT IT DOES (Law 1). `cursor: grab` is a control
 *   promising a drag. There is no drag here. Nothing in the public payload
 *   is movable, because nothing on this page belongs to the person reading
 *   it.
 *
 *   ONE FACE, EVERYWHERE. The notes were set in `--font-sans` at weight 450
 *   while every surface the founder has looked at wears `--waka-face` — Jost
 *   at 300. Hierarchy in this product comes from size and weight, never from
 *   a change of face.
 *
 * And the mechanism is Law 3 exactly: `.nc-note` / `.nc-canvas` are the
 * language of the FLAT SCREENS, the ones deleted a week before this pass.
 * This page was the last living reference to them in the entire tree — grep
 * found no other `.tsx` touching `nc-note` — so every ruling that moved the
 * product onto the near-black grainy ground simply did not reach it, because
 * the only screen still wearing the old clothes was one nobody opened.
 *
 * It wears the product's own material now: the page's ground, the page's
 * face, the page's grain, and a single ink ramp where the words nearest the
 * top are the brightest. That last part is the post-it `--decay` kept and
 * said properly — a reading IS ordered by weight, and light is the channel
 * this product has for weight.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE WAY OUT (Law 2), AND THE TWO ARRIVALS THAT NEED DIFFERENT ONES.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * A stranger has nowhere behind them: they arrived by link, and the one
 * forward move — find out what this is — is the control in the corner. That
 * is honest, and it is why nothing resembling a back button appears for them.
 *
 * A SIGNED-IN READER DOES, and that is the corner's other face: it returns
 * them to their own world in one press, which is the way out of this surface
 * rather than a destination on it. It was already here and already right; it
 * keeps its place because it is the only control on the page and the page has
 * no chrome of its own to put one in.
 *
 * WHAT IS STILL NOT ANSWERED, and it is recorded rather than guessed at: the
 * OWNER reaching their own public page from the settings page. `Profile`
 * renders the URL as a plain in-app link, so pressing it unmounts the
 * settings page and lands them here signed in — where the corner says "Open
 * WAKA" and takes them to the world, not back to the settings page they were
 * standing on. That is Law 2's own example ("reaching it unmounted the
 * world"), and the fix belongs on the link rather than here; see the note at
 * that link in `Profile.tsx`.
 */
import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";

import { fetchPublicProfile, type FetchPublicProfileResponse } from "../lib/api";
import { useOptionalAuth } from "../lib/auth-context";
import { formatMessage, normalizeSupportedLocale, t } from "../lib/locales";

export default function PublicProfilePage(): JSX.Element {
  const { handle = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const auth = useOptionalAuth();
  const [data, setData] = useState<FetchPublicProfileResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  /**
   * FAILED, NOT THE SENTENCE IT FAILED WITH.
   *
   * This held the `ApiError`'s own message — and then rendered
   * `publicProfileMissingBody` regardless, so the string was written, stored,
   * and never shown. The only thing anything read off it was whether it was
   * truthy. A piece of state whose value nothing consumes is a bug waiting
   * for somebody to "fix" it by printing the API client's voice to a
   * stranger; `Login` has a long comment about the day that happened there.
   */
  const [failed, setFailed] = useState(false);
  const isPublicHandleRoute = handle.startsWith("@");

  useEffect(() => {
    if (!isPublicHandleRoute) return;
    let cancelled = false;
    setIsLoading(true);
    setFailed(false);
    setData(null);
    (async () => {
      try {
        const next = await fetchPublicProfile(handle);
        if (!cancelled) setData(next);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [handle, isPublicHandleRoute]);

  if (!isPublicHandleRoute) {
    return <Navigate to="/" replace />;
  }

  const locale = normalizeSupportedLocale(data?.profile.preferredLocale);
  /*
    The page shows the artifact's statements and only those. Entry ids and the
    signals behind them are the owner's, not the visitor's, so the public
    payload never carries them and there is nothing here to strip.
  */
  const entries = data?.topOfMind?.entries ?? [];

  function goToPrivateApp(): void {
    if (auth?.isAuthenticated) {
      navigate("/");
      return;
    }
    navigate("/login", { state: { from: location.pathname } });
  }

  /** The corner. A way out for a reader who has a world; a way in for one who
      does not — and it says which, rather than saying "continue". */
  const corner = (
    <button className="waka-public-enter" type="button" onClick={goToPrivateApp}>
      {t(locale, auth?.isAuthenticated ? "publicProfileOpen" : "publicProfileStart")}
    </button>
  );

  if (isLoading) {
    return (
      <main className="waka-public">
        <p className="waka-public-state" role="status">
          {t(locale, "publicProfileLoading")}
        </p>
      </main>
    );
  }

  if (!data || failed) {
    return (
      <main className="waka-public">
        <section className="waka-public-head" aria-labelledby="public-missing-title">
          {/* THE HANDLE, BECAUSE IT IS THE ONLY THING KNOWN. On a page that
              could not be loaded, the one fact the visitor has is the address
              they typed, and repeating it is how they see the typo. */}
          <p className="waka-public-handle">@{handle.replace(/^@+/, "")}</p>
          <h1 className="waka-public-title" id="public-missing-title">
            {t(locale, "publicProfileMissingTitle")}
          </h1>
          <p className="waka-public-state">{t(locale, "publicProfileMissingBody")}</p>
          {corner}
        </section>
      </main>
    );
  }

  return (
    <main className="waka-public" data-locale={locale}>
      <header className="waka-public-head">
        <h1 className="waka-public-title">
          {formatMessage(locale, "publicProfileTitle", { name: data.profile.name })}
        </h1>
        {corner}
      </header>

      {entries.length > 0 ? (
        /* AN ORDERED LIST, BECAUSE THE ORDER IS THE MEANING. These were five
           `<article>`s scattered on a stage at hand-set tilts, which said
           they were peers thrown on a table. A reading is ranked — the first
           line is what is most on this person's mind — and the ink ramp below
           is only legible as a ramp if the markup agrees it is a sequence. */
        <ol className="waka-public-reading">
          {entries.map((entry, index) => (
            <li
              className="waka-public-said"
              key={`${entry.body}-${index}`}
              /* LIGHT, AND NOTHING ELSE, CARRIES THE WEIGHTING. One number
                 from 1 down, spent by `claims.css` on ink alone — no hue, no
                 saturation, no tilt. It replaces `--decay`, `--bg`, `--ink`,
                 `--tilt`, `--w`, `--dx` and `--dy`: seven custom properties
                 set per note from two tables in this file, six of which were
                 saying the same thing in channels this product does not use.
                 Floored so the last line of a long reading is still read and
                 not merely present — fading never deletes. */
              style={{ "--waka-said-weight": Math.max(0.55, 1 - index * 0.1).toFixed(2) } as React.CSSProperties}
            >
              <p className="waka-public-body">{entry.body}</p>
              {entry.supportChanged ? (
                /* The product's own sentence for this state, not a second one
                   written for this page. It is the same fact — these words
                   were kept and what held them up has moved — and Law 3 is
                   that one state gets one sentence everywhere. */
                <p className="waka-public-aside">{t(locale, "worldReadingSupportChanged")}</p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="waka-public-state">{t(locale, "publicProfileEmpty")}</p>
      )}
    </main>
  );
}
