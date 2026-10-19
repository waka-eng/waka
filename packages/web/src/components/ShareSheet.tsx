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
 * one press sends it.
 *
 * ── ONE DESIGN, AND THE WORDS ARE EDITED WHERE THEY ARE ─────────────────
 *
 * Founder, 2026-10-16: "let's not add options to change background or like
 * design. Let's just have one design. The first main design is what I like
 * the most" — so the looks row, and the name switch with it, are gone: the
 * card is the dark square one, signed with your name. "The user should be
 * able to edit wording in the speech bubble directly rather than having the
 * edit wording thing" — so there is no second box under the card: pressing
 * the words opens them for editing in the bubble itself, set in the card's
 * own face, size and colours, and the picture redraws when you are done.
 * And "I just wanted to say X on the top right corner" — the close is a
 * plain ×, not a labelled button.
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
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { CSSProperties } from "react";
import { DialogSurface } from "./DialogSurface";
import { fetchAttachmentUrl } from "../lib/api";
import { ArtifactLayoutError, renderShareCard, type PrincipleArtifactContent, type ShareCardLayout } from "../lib/principle-artifact";
import { formatMessage, t, type SupportedLocale } from "../lib/locales";
import { dateStamp } from "../lib/words";
import { SHARE_NOTICE_KEY, useShareImage } from "../lib/use-share-image";

/** The one design: the first one, dark and square. */
const CARD_LOOK = { appearance: "dark", format: "square" } as const;

/** Card pixels → a length that scales with the card as it is shown. The
    stage is a size container, so `cqw` is a hundredth of the card's width. */
const cq = (px: number, cardWidth: number) => `${(px / cardWidth) * 100}cqw`;

/** HOW MUCH LARGER THE EDITOR IS LAID OUT ON A TOUCH SCREEN, so its words can
    be set at the 16px focus-zoom floor and still be drawn at the card's size.

    Mobile Safari zooms the whole page when a field under 16px takes focus
    (the floor in chrome.css, `test/no-focus-zoom.test.ts`), and on a phone
    the card's words are shown at ~11px — so on a coarse pointer the floor
    wins and the field's text is 16px. Left at that, the words in the bubble
    grew half again and broke onto other lines the moment you pressed them.
    Instead the field is laid out `floorPx / shownPx` times larger — box,
    padding, corners and text alike, so every line breaks where the drawn
    one does — and scaled back down by the same factor. Its computed size
    stays at the floor (no zoom); what you see is the home ratio. 1 when the
    shown words are already at or above the floor, or nothing is measured. */
export function touchEditorScale(shownPx: number, floorPx: number): number {
  if (!(shownPx > 0) || !(floorPx > 0) || floorPx <= shownPx) return 1;
  return floorPx / shownPx;
}

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

export function ShareSheet({ target, locale, onClose }: {
  target: ShareTarget;
  locale: SupportedLocale;
  onClose: () => void;
}) {
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  const [words, setWords] = useState(target.text);
  const [editing, setEditing] = useState(false);
  const [layout, setLayout] = useState<ShareCardLayout | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const inlineRef = useRef<HTMLTextAreaElement | null>(null);
  const [touchScale, setTouchScale] = useState(1);
  const [photo, setPhoto] = useState<PhotoState>(target.photoId ? { step: "loading" } : { step: "none" });
  const photoRef = useRef<ImageBitmap | null>(null);
  const [preview, setPreview] = useState<{ key: string; url: string; blob: Blob } | null>(null);
  /* The live preview's object URL, held outside state so the one left
     standing when the sheet closes is released. */
  const previewUrl = useRef<string | null>(null);
  const [renderError, setRenderError] = useState<"empty" | "too_long" | "unavailable" | null>(null);
  const [renderAttempt, setRenderAttempt] = useState(0);

  /* THE PHOTO IS TRIED ONCE AND THE CARD NEVER WAITS ON IT TWICE. The
     attachment is served from storage on another origin, and a browser will
     only let a canvas draw it if that origin allows the read. When it does
     not, the card is the words alone and one line says so — a card that
     never appears because a picture could not be fetched would be the worse
     failure by far. */
  useEffect(() => {
    if (!target.photoId) return undefined;
    const controller = new AbortController();
    /* AND IT IS TRIED FOR A BOUNDED TIME. "Tried once" said nothing about how
       long once lasts: a storage request that never answered held the card
       in "waiting for the photo" for as long as the sheet was open. Past
       fifteen seconds it is the words alone, the same as a refused read.
       `closed` tells the sheet closing apart from the clock running out —
       both abort, and only one of them should say anything. */
    let closed = false;
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    void (async () => {
      try {
        const url = await fetchAttachmentUrl(target.photoId!, controller.signal);
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error("photo unavailable");
        const image = await createImageBitmap(await response.blob());
        if (controller.signal.aborted) throw new Error("photo timed out");
        photoRef.current = image;
        setPhoto({ step: "ready" });
      } catch {
        if (!closed) setPhoto({ step: "failed" });
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    return () => { closed = true; window.clearTimeout(timeout); controller.abort(); };
  }, [target.photoId]);

  const content = useMemo<PrincipleArtifactContent>(() => ({
    items: [{ text: words }],
    /* No name on the card — founder, 2026-10-16: "don't write the name on
       the bottom left". The WAKA mark is the card's only signature. */
    name: "",
    appearance: CARD_LOOK.appearance,
    format: CARD_LOOK.format,
    kind: target.kind,
    /* The top of mind opens with the home bubble's own line. */
    ...(target.kind === "topOfMind" ? { frame: say("worldBubbleActMine") } : {}),
    ...(target.proof ? { proof: target.proof } : {}),
    /* `say` follows `locale`, which is the dependency. */
  }), [words, target.kind, target.proof, locale]);
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
          setLayout(result.layout);
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

  /* THE TOUCH SCALE (`touchEditorScale`), measured against the card as it is
     shown and the size the stylesheet's floor actually gives the field —
     read from the field, so the floor stays the stylesheet's to set. Only on
     a coarse pointer: a mouse never meets the zoom, and there the field is
     the card's own size. */
  const hasEditor = Boolean(layout && preview && !renderError);
  useLayoutEffect(() => {
    if (!hasEditor || !layout) return undefined;
    const measure = () => {
      const card = cardRef.current;
      const field = inlineRef.current;
      const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
      if (!coarse || !card || !field) { setTouchScale(1); return; }
      const shown = (layout.text.size * card.getBoundingClientRect().width) / layout.width;
      const floor = parseFloat(window.getComputedStyle(field).fontSize);
      setTouchScale(touchEditorScale(shown, floor));
    };
    measure();
    if (typeof ResizeObserver !== "function" || !cardRef.current) return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, [hasEditor, layout]);

  const ready = Boolean(preview && preview.key === contentKey && !renderError);
  const filename = target.kind === "inspiration" ? "waka-inspiration.png" : "waka-top-of-mind.png";
  const filenames = useMemo(() => ({ download: filename, share: filename }), [filename]);
  /* SHARE IS ALWAYS THERE. Founder, 2026-10-16: "a save button icon and a
     share button icon". Where the device has a share sheet, it opens it; a
     desktop browser has none, so there sharing means the image on the
     clipboard, ready to paste into whatever you post with — and failing
     that, the saved file (`fallback: "copy"` in useShareImage). */
  const { busy, notice, setNotice, download, share } = useShareImage(ready ? preview?.blob ?? null : null, filenames, { fallback: "copy" });

  const title = say(target.kind === "inspiration" ? "worldShareInspirationSheet" : "worldShareTopOfMindTitle");
  const alt = [target.proof, words].filter(Boolean).join("\n");

  /* THE WORDS, EDITABLE IN THE BUBBLE. A textarea laid exactly over the
     bubble the renderer reports, in the card's own face, size and inks. At
     rest it is clear, so the picture shows through and pressing the words is
     pressing the field; while it has focus it takes the bubble's colour, so
     you type into the bubble itself, and the card redraws a beat after each
     change. Escape leaves the words without closing the sheet. */
  /* The renderer says which part of the bubble the words fill (under the
     frame line on the top of mind, so the line stays while you type) and
     the padding that lands each line where the drawn one is. */
  /* On a touch screen every length is `touchScale` times larger and the
     whole field is scaled back down from its top-left corner, so the text
     can sit at the 16px floor and still land on the drawn lines. */
  const f = touchScale;
  const inline: CSSProperties | undefined = layout ? {
    left: `${(layout.edit.x / layout.width) * 100}%`,
    top: `${(layout.edit.y / layout.height) * 100}%`,
    width: `${(layout.edit.w / layout.width) * 100 * f}%`,
    height: `${(layout.edit.h / layout.height) * 100 * f}%`,
    padding: `${cq(layout.edit.padTop * f, layout.width)} ${cq(layout.edit.padX * f, layout.width)} 0`,
    borderRadius: `${cq(layout.edit.radiusTop * f, layout.width)} ${cq(layout.edit.radiusTop * f, layout.width)} ${cq(layout.edit.radiusBottom * f, layout.width)} ${cq(layout.edit.radiusBottom * f, layout.width)}`,
    textAlign: layout.text.align,
    fontFamily: layout.text.family,
    fontWeight: layout.text.weight,
    fontSize: cq(layout.text.size * f, layout.width),
    lineHeight: layout.text.leading,
    ...(f !== 1 ? { transform: `scale(${1 / f})`, transformOrigin: "0 0" } : {}),
    ["--share-ink" as string]: layout.text.ink,
    ["--share-fill" as string]: layout.bubble.fill,
  } : undefined;

  return (
    <>
      <button className="jar-review-backdrop" type="button" tabIndex={-1} aria-hidden="true" onClick={onClose} />
      <DialogSurface className="jar-seek jar-thing-share" aria-label={title} onClose={onClose} data-jar-chrome="1">
        <header>
          <h2>{title}</h2>
          <button type="button" className="jar-share-x" aria-label={say("worldClose")} onClick={onClose}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </header>
        <div className="jar-share-body">
          <div className="jar-share-stage" aria-busy={!ready && !renderError}>
            {preview && !renderError ? (
              <div className="jar-share-card" ref={cardRef}>
                <img src={preview.url} alt={alt} />
                {inline ? (
                  <textarea
                    ref={inlineRef}
                    className="jar-share-inline"
                    data-touch-scale={f !== 1 ? f.toFixed(3) : undefined}
                    style={inline}
                    aria-label={say("worldShareWords")}
                    maxLength={2000}
                    value={words}
                    disabled={busy}
                    spellCheck={editing}
                    onFocus={() => setEditing(true)}
                    onBlur={() => setEditing(false)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") { event.stopPropagation(); event.currentTarget.blur(); }
                    }}
                    onChange={(event) => setWords(event.target.value)}
                  />
                ) : null}
              </div>
            ) : null}
            {renderError ? (
              <p role="alert">
                {say(renderError === "too_long" ? "worldShareTooLongCard" : renderError === "empty" ? "worldShareEmpty" : "worldShareRenderFailed")}
                {renderError === "unavailable" ? (
                  <button type="button" onClick={() => setRenderAttempt((n) => n + 1)}>{say("worldRetry")}</button>
                ) : null}
              </p>
            ) : !preview ? (
              <p role="status" className="jar-share-quiet">{say("worldShareRendering")}</p>
            ) : null}
          </div>

          {words !== target.text ? (
            <p className="jar-share-hint-line">
              <button type="button" className="jar-share-link" onClick={() => setWords(target.text)}>{say("worldShareOriginal")}</button>
            </p>
          ) : null}

          {photo.step === "failed" ? <p className="jar-share-quiet" role="status">{say("worldSharePhotoLeftOut")}</p> : null}
        </div>
        {/* TWO ICONS, NO FILLED BUTTONS. Founder, 2026-10-16: "a save button
            icon and a share button icon ... just put the icon ... without
            like the button being colored". Each names itself to a screen
            reader and on hover; the outcome is said once, under them. */}
        <footer>
          <span className="jar-share-actions">
            <button type="button" className="jar-share-icon" aria-label={say("worldShareDownload")} title={say("worldShareDownload")} disabled={!ready || busy} onClick={download}>
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14" />
              </svg>
            </button>
            <button type="button" className="jar-share-icon" aria-label={say("worldShareSheet")} title={say("worldShareSheet")} disabled={!ready || busy} onClick={() => void share()}>
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M8 11H6.5A1.5 1.5 0 0 0 5 12.5v6A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-6a1.5 1.5 0 0 0-1.5-1.5H16" />
              </svg>
            </button>
          </span>
          {notice ? (
            <p role="status" className="jar-share-quiet">
              {say(SHARE_NOTICE_KEY[notice])}
            </p>
          ) : null}
        </footer>
      </DialogSurface>
    </>
  );
}
