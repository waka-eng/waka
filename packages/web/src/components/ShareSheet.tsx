/**
 * SHARE A SAVE OR YOUR TOP OF MIND AS AN IMAGE.
 *
 * Founder, 2026-10-15: "an extremely streamlined, intuitive experience the
 * user would want to share something ... share an inspiration, share their
 * current top of mind or share their principle ... a preview, save it to
 * share as an image, like how Strava and other products really make that
 * sharing experience nice."
 *
 * ── WHAT "STREAMLINED" MEANT, MEASURED AGAINST THE PRINCIPLE SHARE ───────
 *
 * The principle share already renders a real image and survives every
 * failure it can meet, and none of that is redone here: the same renderer
 * draws this card, so the three kinds are one family. What this sheet does
 * differently is the order of things. It opens on the finished card, and
 * the only decisions on screen are the ones people make about a picture:
 * which look, and whether their name is on it. The words are a link away
 * for the rare time they want to change them. One press sends it.
 *
 * ── WHAT IT NEVER DOES ──────────────────────────────────────────────────
 *
 * It never writes to the server. Editing the words here changes the card
 * and nothing else — the save and the top of mind are exactly as they were.
 * It never produces a link: nothing of a person's is public unless they
 * made it so, and an image is the one thing that leaves without opening a
 * door behind it. And it never claims a share happened: a native sheet
 * closing says only that it closed.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { DialogSurface } from "./DialogSurface";
import { ShareLooks } from "./ShareLooks";
import { fetchAttachmentUrl } from "../lib/api";
import { ArtifactLayoutError, renderShareCard, type PrincipleArtifactContent } from "../lib/principle-artifact";
import { readShareLook, writeShareLook, type ShareLook } from "../lib/share-look";
import { formatMessage, t, type SupportedLocale } from "../lib/locales";
import { dateStamp } from "../lib/words";
import { SHARE_NOTICE_KEY, useShareImage } from "../lib/use-share-image";

export interface ShareTarget {
  kind: "inspiration" | "topOfMind";
  /** The words as they are kept. The card starts with exactly these. */
  text: string;
  /** The one muted line above the words: when it was kept, or when it was on your mind. */
  proof?: string;
  /** An image attached to the save, drawn above the words when it can be read. */
  photoId?: string | null;
}

/** A save as a card: its words, the day it was kept, and its first photo.
    One builder, so the archive's note and the open card make the same card. */
export function inspirationShareTarget(
  locale: SupportedLocale,
  save: { text: string; capturedMs: number; attachments?: readonly { id: string; type: string }[] | null },
): ShareTarget {
  return {
    kind: "inspiration",
    text: save.text,
    proof: formatMessage(locale, "worldShareKept", { date: dateStamp(save.capturedMs, locale) }),
    photoId: save.attachments?.find((item) => item.type === "image")?.id ?? null,
  };
}

type PhotoState = { step: "none" } | { step: "loading" } | { step: "ready" } | { step: "failed" };

export function ShareSheet({ target, name, locale, onClose }: {
  target: ShareTarget;
  name: string;
  locale: SupportedLocale;
  onClose: () => void;
}) {
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  const [look, setLook] = useState<ShareLook>(() => readShareLook());
  const [words, setWords] = useState(target.text);
  const [editing, setEditing] = useState(false);
  const [photo, setPhoto] = useState<PhotoState>(target.photoId ? { step: "loading" } : { step: "none" });
  const photoRef = useRef<ImageBitmap | null>(null);
  const [preview, setPreview] = useState<{ key: string; url: string; blob: Blob } | null>(null);
  /* The live preview's object URL, held outside state so the one left
     standing when the sheet closes is released. */
  const previewUrl = useRef<string | null>(null);
  const [renderError, setRenderError] = useState<"empty" | "too_long" | "unavailable" | null>(null);
  const [renderAttempt, setRenderAttempt] = useState(0);

  const choose = (next: ShareLook) => {
    setLook(next);
    writeShareLook(next);
  };

  /* THE PHOTO IS TRIED ONCE AND THE CARD NEVER WAITS ON IT TWICE. The
     attachment is served from storage on another origin, and a browser will
     only let a canvas draw it if that origin allows the read. When it does
     not, the card is the words alone and one line says so — a card that
     never appears because a picture could not be fetched would be the worse
     failure by far. */
  useEffect(() => {
    if (!target.photoId) return undefined;
    const controller = new AbortController();
    void (async () => {
      try {
        const url = await fetchAttachmentUrl(target.photoId!, controller.signal);
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error("photo unavailable");
        const image = await createImageBitmap(await response.blob());
        if (controller.signal.aborted) return;
        photoRef.current = image;
        setPhoto({ step: "ready" });
      } catch {
        if (!controller.signal.aborted) setPhoto({ step: "failed" });
      }
    })();
    return () => controller.abort();
  }, [target.photoId]);

  const content = useMemo<PrincipleArtifactContent>(() => ({
    items: [{ text: words }],
    name: look.showName ? name : "",
    appearance: look.appearance,
    format: look.format,
    kind: target.kind,
    ...(target.proof ? { proof: target.proof } : {}),
  }), [words, look, name, target.proof]);
  const contentKey = `${JSON.stringify(content)}|${photo.step}`;

  useEffect(() => {
    if (photo.step === "loading") return undefined;
    let alive = true;
    setRenderError(null);
    setNotice(null);
    /* A beat after the last keystroke, so typing does not draw a card per
       letter. The same pause the principle share uses. */
    const timer = window.setTimeout(() => {
      void renderShareCard({ ...content, photo: photoRef.current })
        .then((result) => {
          if (!alive) return;
          if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
          const url = URL.createObjectURL(result.blob);
          previewUrl.current = url;
          setPreview({ key: contentKey, url, blob: result.blob });
        })
        .catch((error) => {
          if (alive) setRenderError(error instanceof ArtifactLayoutError ? error.code : "unavailable");
        });
    }, 150);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    /* `content` is folded into `contentKey`; the key is what changes. */
  }, [contentKey, renderAttempt]);

  useEffect(() => () => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    photoRef.current?.close?.();
  }, []);

  const ready = Boolean(preview && preview.key === contentKey && !renderError);
  const filename = target.kind === "inspiration" ? "waka-inspiration.png" : "waka-top-of-mind.png";
  const filenames = useMemo(() => ({ download: filename, share: filename }), [filename]);
  const { busy, notice, setNotice, canShare, download, share } = useShareImage(ready ? preview?.blob ?? null : null, filenames);

  const title = say(target.kind === "inspiration" ? "worldShareInspirationTitle" : "worldShareTopOfMindTitle");
  const alt = [target.proof, words, look.showName ? name : ""].filter(Boolean).join("\n");

  return (
    <>
      <button className="jar-review-backdrop" type="button" tabIndex={-1} aria-hidden="true" onClick={onClose} />
      <DialogSurface className="jar-seek jar-thing-share" aria-label={title} onClose={onClose} data-jar-chrome="1">
        <header>
          <h2>{title}</h2>
          <button type="button" onClick={onClose}>{say("worldClose")}</button>
        </header>
        <div className="jar-share-body">
          <div className="jar-share-stage" aria-busy={!ready && !renderError}>
            {preview && !renderError ? <img src={preview.url} alt={alt} /> : null}
            {renderError ? (
              <p role="alert">
                {say(renderError === "too_long" ? "worldShareTooLong" : renderError === "empty" ? "worldShareEmpty" : "worldShareRenderFailed")}
                {renderError === "unavailable" ? (
                  <button type="button" onClick={() => setRenderAttempt((n) => n + 1)}>{say("worldRetry")}</button>
                ) : null}
              </p>
            ) : !ready ? (
              <p role="status" className="jar-share-quiet">{say("worldShareRendering")}</p>
            ) : null}
          </div>

          <ShareLooks
            appearance={look.appearance}
            format={look.format}
            disabled={busy}
            locale={locale}
            onChange={(next) => choose({ ...look, ...next })}
          />

          <div className="jar-share-row">
            {name ? (
              <label className="jar-share-name">
                <input
                  type="checkbox"
                  checked={look.showName}
                  disabled={busy}
                  onChange={(event) => choose({ ...look, showName: event.target.checked })}
                />
                {say("worldShareName")}
              </label>
            ) : <span />}
            <button type="button" className="jar-share-link" aria-expanded={editing} onClick={() => setEditing((open) => !open)}>
              {say("worldPrincipleEdit")}
            </button>
          </div>

          {editing ? (
            <div className="jar-share-wording">
              <label>
                {say("worldShareWords")}
                <textarea rows={4} maxLength={2000} value={words} disabled={busy} onChange={(event) => setWords(event.target.value)} />
              </label>
              <p className="jar-share-quiet">{say("worldShareSeparate")}</p>
              {words !== target.text ? (
                <button type="button" className="jar-share-link" onClick={() => setWords(target.text)}>{say("worldShareOriginal")}</button>
              ) : null}
            </div>
          ) : null}

          {photo.step === "failed" ? <p className="jar-share-quiet" role="status">{say("worldSharePhotoLeftOut")}</p> : null}
        </div>
        <footer>
          {notice ? (
            <p role="status" className="jar-share-quiet">
              {say(SHARE_NOTICE_KEY[notice])}
            </p>
          ) : <span />}
          <span className="jar-share-actions">
            {canShare ? (
              <button type="button" disabled={!ready || busy} onClick={download}>{say("worldShareDownload")}</button>
            ) : null}
            <button
              type="button"
              className="jar-share-primary"
              disabled={!ready || busy}
              onClick={canShare ? () => void share() : download}
            >
              {say(canShare ? "worldShareSheet" : "worldShareDownload")}
            </button>
          </span>
        </footer>
      </DialogSurface>
    </>
  );
}
