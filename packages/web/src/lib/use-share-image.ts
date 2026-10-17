/**
 * SAVING OR SENDING ONE RENDERED CARD.
 *
 * The two share surfaces (`ShareSheet` for a save or the top of mind,
 * `PrincipleShare` for principles) each carried their own copy of this:
 * a download through a throwaway link, the system share sheet when the
 * browser can take a file, and the one-line notice either leaves behind.
 * One copy here, so a fix to one is a fix to both.
 *
 * The file is built once per rendered card, not per render: typing in a
 * card's words would otherwise rebuild it and re-ask the browser on every
 * keystroke.
 *
 * `fallback: "copy"` (the save / top-of-mind sheet) keeps Share pressable
 * where the browser has no share sheet: the image goes on the clipboard,
 * and with no clipboard either, the file is saved. Without it, Share is
 * only offered where it works (`canShare`).
 */
import { useCallback, useMemo, useState } from "react";

export type ShareNotice = "download" | "downloadFailed" | "shared" | "copied" | "unavailable";

export function useShareImage(blob: Blob | null, names: { download: string; share: string }, options: { fallback?: "copy" } = {}) {
  const copyFallback = options.fallback === "copy";
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<ShareNotice | null>(null);

  const { file, canShare } = useMemo(() => {
    const made = blob && typeof File === "function" ? new File([blob], names.share, { type: "image/png" }) : null;
    let shareable = false;
    try {
      shareable = Boolean(made && typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [made] }));
    } catch {
      /* Saving the image stays available. */
    }
    return { file: made, canShare: shareable };
  }, [blob, names.share]);

  const download = useCallback(() => {
    if (!blob || busy) return;
    let url: string | undefined;
    let link: HTMLAnchorElement | undefined;
    try {
      url = URL.createObjectURL(blob);
      link = document.createElement("a");
      link.href = url;
      link.download = names.download;
      document.body.append(link);
      link.click();
      setNotice("download");
    } catch {
      setNotice("downloadFailed");
    } finally {
      link?.remove();
      if (url) {
        const release = url;
        window.setTimeout(() => URL.revokeObjectURL(release), 1000);
      }
    }
  }, [blob, busy, names.download]);

  const share = useCallback(async () => {
    if (!blob || busy) return;
    const canCopy = copyFallback && typeof navigator !== "undefined" && typeof navigator.clipboard?.write === "function" && typeof ClipboardItem === "function";
    if (!canShare || !file) {
      if (!copyFallback) return;
      if (!canCopy) { download(); return; }
    }
    setBusy(true);
    setNotice(null);
    try {
      if (canShare && file) {
        /* Files only. No title, no text, no URL: what leaves is the picture
           the person is looking at, and nothing they did not see. */
        await navigator.share({ files: [file] });
        setNotice("shared");
      } else {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        setNotice("copied");
      }
    } catch (error) {
      if ((error as { name?: string }).name !== "AbortError") setNotice("unavailable");
    } finally {
      setBusy(false);
    }
  }, [blob, file, canShare, busy, copyFallback, download]);

  return { busy, notice, setNotice, canShare, download, share };
}

/** The catalogue line for a notice, the same on every share surface. */
export const SHARE_NOTICE_KEY = {
  download: "worldShareDownloadStarted",
  downloadFailed: "worldShareDownloadFailed",
  shared: "worldShareSheetClosed",
  copied: "worldShareCopied",
  unavailable: "worldShareUnavailable",
} as const;
