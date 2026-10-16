/**
 * THE LOOK A PERSON LAST CHOSE FOR A SHARE CARD, REMEMBERED ON THIS DEVICE.
 *
 * Founder, 2026-10-15: sharing should be "extremely streamlined". The
 * streamlined version of a choice is not having to make it twice: somebody
 * who posts to stories picks the tall card once, and every card after that
 * opens tall. The name switch is remembered for the same reason, and it
 * starts OFF — a card leaves this product only with the words a person
 * chose, and their name is a word they have to choose.
 *
 * Device-local and best-effort. Storage can be absent or full (a private
 * window, a quota), and a failure here costs one extra press, never a card.
 */
import type { ArtifactAppearance, ArtifactFormat } from "./principle-artifact";

export interface ShareLook {
  appearance: ArtifactAppearance;
  format: ArtifactFormat;
  showName: boolean;
}

const DEFAULT_SHARE_LOOK: ShareLook = { appearance: "dark", format: "square", showName: false };

const KEY = "waka.share.look";

export function readShareLook(): ShareLook {
  try {
    const raw = window.localStorage?.getItem(KEY);
    if (!raw) return DEFAULT_SHARE_LOOK;
    const value = JSON.parse(raw) as Partial<ShareLook>;
    return {
      appearance: value.appearance === "light" ? "light" : "dark",
      format: value.format === "portrait" ? "portrait" : "square",
      showName: value.showName === true,
    };
  } catch {
    return DEFAULT_SHARE_LOOK;
  }
}

export function writeShareLook(look: ShareLook): void {
  try {
    window.localStorage?.setItem(KEY, JSON.stringify(look));
  } catch {
    /* Remembering is a convenience; the card in front of them is unaffected. */
  }
}
