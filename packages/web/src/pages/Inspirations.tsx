/**
 * INSPIRATIONS — the archive, as a card grid, at its own address.
 *
 * Founder ruling, twice: principles and inspirations stop being places you
 * travel the camera UP and DOWN to reach. They are pages. The home screen
 * keeps the reading, the character and the box; everything else is a
 * destination with a URL, which also means a browser Back that works and a
 * link you can send someone.
 *
 * THE TILE IS UNIFORM WHETHER OR NOT THERE IS A PICTURE. A card is for
 * "discrete, self-contained items — things you could reorder, remove, or
 * interact with independently", which is exactly what one kept thing is. The
 * grid's whole readability comes from the tiles being the same size, so a
 * text-only keep fills the picture's space with its own words rather than
 * collapsing to a shorter card and breaking the rows. Same height, same
 * width, different filling.
 *
 * NOTHING IS TRUNCATED INTO A LIE. A long keep clips with a fade rather than
 * an ellipsis mid-word, and the full text is one press away on the item
 * itself — the grid is for finding the thing, not for reading it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  attachmentPreviewImageUrl,
  fetchInspirations,
  type ApiInspirationSummary,
} from "../lib/api";
import { useOptionalAuth } from "../lib/auth-context";
import { normalizeSupportedLocale, t } from "../lib/locales";

type Phase = "loading" | "ready" | "failed";

/** The first image on a keep, if it has one. Links and audio do not qualify:
    a tile's picture has to be a picture, not a favicon standing in for one. */
function pictureOf(row: ApiInspirationSummary): string | null {
  const image = row.attachmentSummary?.find((item) => item.type === "image");
  return image ? attachmentPreviewImageUrl(image.id) : null;
}

export function Inspirations(): JSX.Element {
  const locale = normalizeSupportedLocale(useOptionalAuth()?.profile?.preferredLocale);
  const say = useCallback((key: Parameters<typeof t>[1]) => t(locale, key), [locale]);
  const navigate = useNavigate();

  const [rows, setRows] = useState<ApiInspirationSummary[]>([]);
  const [phase, setPhase] = useState<Phase>("loading");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const kept = await fetchInspirations({ limit: 120 });
      if (!mounted.current) return;
      setRows(kept);
      setPhase("ready");
    } catch {
      if (!mounted.current) return;
      setPhase("failed");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="waka-page">
      <header className="waka-page-head">
        <button type="button" className="waka-page-back" onClick={() => navigate("/")}>
          {say("worldBack")}
        </button>
        <h1 className="waka-page-title">{say("worldInspirationsTitle")}</h1>
      </header>

      {phase === "loading" ? (
        <p className="waka-page-status" role="status">
          {say("worldInspirationsLoad")}
        </p>
      ) : phase === "failed" ? (
        <>
          <p className="waka-page-status" role="alert">
            {say("worldInspirationsFail")}
          </p>
          <button type="button" className="waka-page-retry" onClick={() => void load()}>
            {say("worldClaimsRetry")}
          </button>
        </>
      ) : rows.length === 0 ? (
        <p className="waka-page-status">{say("worldInspirationsEmpty")}</p>
      ) : (
        <ul className="waka-cards">
          {rows.map((row) => {
            const picture = pictureOf(row);
            return (
              <li key={row.id}>
                <button
                  type="button"
                  className={`waka-card${picture ? "" : " waka-card--text"}`}
                  onClick={() => navigate(`/inspirations/${row.id}`)}
                >
                  {picture ? (
                    <span className="waka-card-picture">
                      {/* Decorative here: the words below are the label, and a
                          filename read aloud before them would bury it. */}
                      <img src={picture} alt="" loading="lazy" />
                    </span>
                  ) : null}
                  <span className="waka-card-body">
                    <span className="waka-card-text">{row.textPreview}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
