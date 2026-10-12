import type { MessageKey } from "./i18n";
/** Inspect a small header, not the filename or the browser's MIME guess.
 * Keep original bytes (including EXIF orientation); never re-encode a capture. */
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

/**
 * ═══ A REFUSAL CARRIES A KEY, NOT A SENTENCE ══════════════════════════════
 *
 * These three refusals were `throw new Error('Use a JPEG, PNG, WebP, GIF,
 * AVIF or HEIC photo.')` and the two beside it — finished English sentences,
 * thrown from a lib, printed verbatim to whoever was reading. A Korean
 * reader dropping the wrong file got their own language for the frame and
 * English for the reason, which is the same half-translated shape
 * `whyFailed` was fixed for on the same day.
 *
 * WHY A CLASS AND NOT A LOCALE ARGUMENT. This function is called from four
 * upload paths, and three of them are inside `Home.tsx`, which is being
 * restructured — threading a locale through each would put the decision at
 * every call site and get it wrong at the fifth. The error says WHICH
 * refusal it is; `whyOf` in `lib/why-failed.ts` already takes the reader's
 * locale and already dispatches on error type, so it is the one place that
 * has both facts. Call sites are untouched and cannot forget.
 *
 * The sentence is NOT kept as a fallback `message`. A fallback that is never
 * read is a second copy of the string that drifts from the catalogue — and
 * if `whyOf` ever stops handling this class, an empty message is a visible
 * bug while a stale English one is an invisible regression.
 */
export class PhotoRefused extends Error {
  constructor(readonly reason: MessageKey) {
    super(reason);
    this.name = "PhotoRefused";
  }
}

/**
 * WHAT A PICKER MAY OFFER — the same set the sniffer below accepts, stated
 * once.
 *
 * THE RULE HAD FOUR COPIES AND THE FOURTH DISAGREED. This string was typed
 * out at every file input in the product — `NoteTools.tsx`,
 * `InspirationComposer.tsx` and the notepad's slot in `Home.tsx` — and the
 * memory card's own picker (`Home.tsx`, the add-attachment label) offered
 * `image/*` instead. Net effect, measured: a TIFF, a BMP or an SVG is
 * selectable from one of the product's four pickers and refused with a
 * sentence at the other three. The accepted set is a property of the rule
 * this file states, not of whichever component happens to be drawing a
 * button, so it lives beside the sniffer that enforces it.
 *
 * IT IS THE DOOR, NOT THE LOCK, and the distinction is the whole reason a
 * picker is allowed to say anything at all. `accept` is a hint to the
 * operating system's file chooser: it greys out what cannot be chosen, and
 * it can be defeated by renaming a file, by a drag, or by a paste. So every
 * byte still goes through `inspectInspirationPhoto` — "not the filename or
 * the browser's MIME guess", one line above — and this constant exists only
 * so the chooser shows the same set the sniffer will agree to. A picker
 * offering MORE than this teaches somebody to pick a file that is then
 * rejected after they chose it, which is the worst order to learn a rule in.
 *
 * THE EXTENSIONS ARE NOT REDUNDANT. `.heic` and `.heif` are repeated after
 * the MIME types because that is the pair browsers most often have no type
 * for — an iPhone photo arrives with an empty `file.type` on several
 * versions of Safari and Windows, and a picker filtering on MIME alone then
 * hides the one format this product was most often handed.
 */
export const PHOTO_ACCEPT =
  "image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif,.heic,.heif";
export async function inspectInspirationPhoto(file: File): Promise<File> {
  if (!file.size) throw new PhotoRefused("worldPhotoEmpty");
  if (file.size > MAX_PHOTO_BYTES) throw new PhotoRefused("worldPhotoTooLarge");
  const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  let type = '';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) type = 'image/jpeg';
  else if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) type = 'image/png';
  else if (['GIF87a', 'GIF89a'].includes(ascii(0, 6))) type = 'image/gif';
  else if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') type = 'image/webp';
  else if (ascii(4, 8) === 'ftyp') {
    const brands = [ascii(8, 12)];
    const boxSize = bytes.length >= 4 ? new DataView(bytes.buffer).getUint32(0) : 0;
    for (let i = 16; i + 4 <= Math.min(boxSize, bytes.length); i += 4) brands.push(ascii(i, i + 4));
    if (brands.some(brand => ['avif', 'avis'].includes(brand))) type = 'image/avif';
    else if (brands.some(brand => ['heic', 'heix', 'hevc', 'hevx'].includes(brand))) type = 'image/heic';
    else if (brands.some(brand => ['mif1', 'msf1'].includes(brand))) type = 'image/heif';
  }
  if (!type) throw new PhotoRefused("worldPhotoWrongKind");
  return file.type === type ? file : new File([file], file.name, { type, lastModified: file.lastModified });
}
