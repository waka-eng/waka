import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";

import {
  ApiError,
  fetchPublicProfile,
  type FetchPublicProfileResponse,
} from "../lib/api";
import { useOptionalAuth } from "../lib/auth-context";
import { normalizeSupportedLocale } from "../lib/locales";
import { BackgroundField } from "../components/layout/BackgroundField";

const NOTE_LAYOUTS: Array<{ tilt: number; w: string }> = [
  { tilt: -1.4, w: "420px" },
  { tilt: -2.2, w: "292px" },
  { tilt: 1.8, w: "300px" },
  { tilt: 1.2, w: "292px" },
  { tilt: -0.8, w: "312px" },
];

const NOTE_COLORS = [
  { hue: "#ece4cb", ink: "#4a3e1f" },
  { hue: "#e8d4ce", ink: "#6b3c34" },
  { hue: "#d8ddc6", ink: "#3f4a2a" },
  { hue: "#cdd3df", ink: "#3a4456" },
  { hue: "#f1d7a8", ink: "#4f3921" },
];

const COPY_EN = {
    loading: "Loading public profile...",
    missingTitle: "Public profile not found",
    missingBody: "This handle is not shared yet, or the owner turned the page off.",
    topOfMind: "Top of mind",
    empty: "No public top-of-mind notes yet.",
    title: (name: string) => (
      <>
        <span className="nc-title-name">{name}'s</span> top of mind
      </>
    ),
    start: "Create your WAKA",
    open: "Open WAKA",
    controls: "public profile controls",
} as const;

const COPY_KO = {
    loading: "공개 프로필을 불러오는 중...",
    missingTitle: "공개 프로필을 찾지 못했어요",
    missingBody: "아직 공유되지 않은 핸들이거나, 주인이 페이지를 닫아 뒀어요.",
    topOfMind: "톱 오브 마인드",
    empty: "아직 공개된 톱 오브 마인드가 없어요.",
    title: (name: string) => (
      <>
        <span className="nc-title-name">{name}</span>의 톱 오브 마인드
      </>
    ),
    start: "나의 WAKA 시작하기",
    open: "WAKA 열기",
    controls: "공개 프로필 설정",
} as const;

const COPY = {
  "en-US": COPY_EN,
  "ko-KR": COPY_KO,
} as const;


export default function PublicProfilePage(): JSX.Element {
  const { handle = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const auth = useOptionalAuth();
  const [data, setData] = useState<FetchPublicProfileResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isPublicHandleRoute = handle.startsWith("@");

  useEffect(() => {
    if (!isPublicHandleRoute) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setData(null);
    (async () => {
      try {
        const next = await fetchPublicProfile(handle);
        if (!cancelled) setData(next);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Failed to load public profile");
        }
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
  const copy = COPY[locale];
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

  if (isLoading) {
    return (
      <main className="public-profile-shell">
        <div className="public-profile-state">{copy.loading}</div>
      </main>
    );
  }

  if (!data || error) {
    return (
      <main className="public-profile-shell">
        <section className="public-profile-empty" aria-labelledby="public-profile-error-title">
          <p className="login-eyebrow">@{handle.replace(/^@+/, "")}</p>
          <h1 id="public-profile-error-title">{copy.missingTitle}</h1>
          <p>{copy.missingBody}</p>
          <button className="btn-primary" type="button" onClick={goToPrivateApp}>
            {auth?.isAuthenticated ? copy.open : copy.start}
          </button>
        </section>
      </main>
    );
  }

  return (
    <>
      <BackgroundField />
      <main className="nc-canvas nc-canvas--top-of-mind" data-locale={locale}>
        <div className="nc-language-controls" aria-label={copy.controls}>
          <button
            className="nc-profile-link nc-lang--top"
            type="button"
            onClick={goToPrivateApp}
          >
            {auth?.isAuthenticated ? copy.open : copy.start}
          </button>
        </div>

        <section className="nc-titlecard">
          <h1 className="nc-title">{copy.title(data.profile.name)}</h1>
        </section>

        <section className="nc-stage nc-stage--top-of-mind-wall" aria-label={copy.topOfMind}>
          {entries.length > 0 ? (
            entries.map((entry, index) => (
              <article
                className={`nc-note${index === 0 ? " nc-note--featured" : ""}`}
                key={`${entry.body}-${index}`}
                style={{
                  ["--bg" as string]: NOTE_COLORS[index]?.hue ?? NOTE_COLORS[0].hue,
                  ["--ink" as string]: NOTE_COLORS[index]?.ink ?? NOTE_COLORS[0].ink,
                  ["--tilt" as string]: `${(NOTE_LAYOUTS[index] ?? NOTE_LAYOUTS[0]).tilt}deg`,
                  ["--w" as string]: (NOTE_LAYOUTS[index] ?? NOTE_LAYOUTS[0]).w,
                  ["--dx" as string]: "0px",
                  ["--dy" as string]: "0px",
                  ["--decay" as string]: String(1 - index * 0.08),
                }}
              >
                <div className="nc-note-preview" aria-label="post-it preview">
                  <p className="nc-note-body nc-note-body--preview">{entry.body}</p>
                </div>
              </article>
            ))
          ) : (
            <p className="nc-loading">{copy.empty}</p>
          )}
        </section>
      </main>
    </>
  );
}
