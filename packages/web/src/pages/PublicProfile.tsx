import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";

import {
  ApiError,
  fetchPublicProfile,
  type FetchPublicProfileResponse,
} from "../lib/api";
import { useOptionalAuth } from "../lib/auth-context";
import { normalizeSupportedLocale } from "../lib/locales";

const COPY = {
  "en-US": {
    loading: "Loading public profile...",
    missingTitle: "Public profile not found",
    missingBody: "This handle is not shared yet, or the owner turned the page off.",
    topOfMind: "Top of mind",
    empty: "No public top-of-mind notes yet.",
    start: "Create your WAKA",
    open: "Open WAKA",
    evidence: "Evidence",
    provisional: "Provisional",
  },
  "ko-KR": {
    loading: "공개 프로필을 불러오는 중...",
    missingTitle: "공개 프로필을 찾을 수 없어요",
    missingBody: "아직 공유되지 않았거나 소유자가 공개를 꺼둔 핸들입니다.",
    topOfMind: "탑오브마인드",
    empty: "공개된 탑오브마인드가 아직 없어요.",
    start: "내 WAKA 만들기",
    open: "WAKA 열기",
    evidence: "근거",
    provisional: "임시 포스트잇",
  },
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
        const next = await fetchPublicProfile(handle, { limit: 12 });
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
    <main className="public-profile-shell">
      <header className="public-profile-hero">
        <div>
          <p className="login-eyebrow">@{data.profile.handle}</p>
          <h1>{data.profile.name}</h1>
        </div>
        <button className="profile-signout-button" type="button" onClick={goToPrivateApp}>
          {auth?.isAuthenticated ? copy.open : copy.start}
        </button>
      </header>

      <section className="public-top-of-mind" aria-labelledby="public-top-of-mind-title">
        <div className="public-section-heading">
          <p className="login-eyebrow">{copy.provisional}</p>
          <h2 id="public-top-of-mind-title">{copy.topOfMind}</h2>
        </div>
        {data.topOfMindNotes.length > 0 ? (
          <div className="public-note-grid">
            {data.topOfMindNotes.map((note, index) => (
              <article className="public-note" key={`${note.title}-${index}`}>
                <div className="public-note-meta">
                  <span>{note.type}</span>
                  <span>{note.confidence}%</span>
                </div>
                <h3>{note.title}</h3>
                <p>{note.body || note.ambientSignal}</p>
                {note.evidencePreviews.length > 0 ? (
                  <div className="public-note-evidence">
                    <span className="field-label">{copy.evidence}</span>
                    <p>{note.evidencePreviews[0]?.textPreview}</p>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <p className="public-profile-state">{copy.empty}</p>
        )}
      </section>
    </main>
  );
}
