/**
 * ═══ BRING THEM IN ON DAY ONE (insight goal; founder, 2026-11-27, flow A) ═══
 *
 * A new person's first reading should come on day one, not day ten. Most
 * people already have a pile of saved things in other apps, so the creature
 * asks once: Photos, Files, Not now. Whatever they pick comes in as SEPARATE
 * saves, one per photo or file, through the same three steps every upload
 * takes (presign, PUT straight to the bucket, then the save itself) and the
 * same `createInspiration` the notepad's Save ends in. Nothing here invents a
 * way to read them: once they are saves, the hunch and the reading come the
 * usual way.
 *
 * WHAT THIS FILE OWNS: whether to ask, which picked files may come in, and
 * the queue that brings them. The bubble, the lights and the landing on the
 * field are `Home.tsx`'s, because that is where the field lives.
 *
 * NEVER A DEAD END. A file the sniffer refuses (a TIFF, an empty file) is
 * left out before anything is uploaded. One that fails on the way is tried
 * once more, quietly, under the SAME save identity, so a save that did land
 * behind a lost response is not made twice; a second failure leaves it out.
 * The account's hourly upload budget ending part way through stops the
 * queue, and the rest are left out too. The person is told only that some
 * did not come in, and where the door is to try them again.
 */
import { ApiError, createInspiration, presignAttachment, uploadToPresignedUrl, type ApiInspiration } from './api';
import { inspectAttachmentFile } from './api/file-accept';
import { inspectInspirationPhoto } from './inspiration-photo';
import { readProfileText, writeProfileText, type ProfileStorageScope } from './profile-storage';

/** Which of the ask's two doors the files came through. */
export type ImportDoor = 'photos' | 'files';

/**
 * "A NEW PERSON": FEWER THAN THIS MANY SAVES. Onboarding keeps up to three
 * answers as saves, so a person fresh from it already has three; the ask is
 * still theirs then, and a couple more saves of their own do not make the
 * pile in their other apps any smaller.
 */
export const FEW_SAVES = 6;

/**
 * AT MOST THIS MANY AT ONCE, and this many bytes: the account's hourly upload
 * budget (`ATTACHMENT_UPLOAD_HOUR_LIMITS` in
 * `packages/api/src/lib/attachment-uploads.ts`, 20 uploads and six 25 MiB
 * attachments' worth of bytes). Picking more than the budget would only queue
 * uploads the server is bound to refuse, so the rest are left out up front.
 */
export const IMPORT_MAX_ITEMS = 20;
const IMPORT_MAX_BYTES = 25 * 1024 * 1024 * 6;

/** Modest: a phone on a café's network, not a desktop on fibre. */
const IMPORT_CONCURRENCY = 3;

/* ═══ THE ASK IS ONCE, PER PROFILE ════════════════════════════════════════
   Any answer settles it: Photos and Files because the door was used, Not now
   because it was declined. After that the bar's photo button is the same
   door, and the bubble goes back to what it says. Remembered on the device
   per profile, like the weekly card's offer. */
const ASKED = 'import:asked';
export function importAnswered(scope: ProfileStorageScope | null): boolean {
  return readProfileText(scope, ASKED) !== '';
}
export function rememberImportAnswer(scope: ProfileStorageScope | null, answer: ImportDoor | 'not_now'): void {
  writeProfileText(scope, ASKED, answer);
}

/** One picked file, checked and typed, ready for the three steps. */
interface Ready { blob: File; type: 'image' | 'file'; contentType: string; name?: string }

/**
 * THE SAME CHECKS THE NOTEPAD MAKES (`addInspirationFiles` in `Home.tsx`):
 * a photo is sniffed by its bytes, a file is read against the server's list
 * and the 25 MiB cap, and a photo chosen through Files is still a photo.
 * Null is "left out": the save would be refused, so it is never uploaded.
 */
async function readyForImport(file: File, door: ImportDoor): Promise<Ready | null> {
  const name = file.name ? { name: file.name.slice(0, 255) } : {};
  try {
    if (door === 'files') {
      const verdict = inspectAttachmentFile(file);
      if (verdict.kind === 'file') {
        const blob = file.type === verdict.contentType ? file : new File([file], file.name, { type: verdict.contentType, lastModified: file.lastModified });
        return { blob, type: 'file', contentType: verdict.contentType, ...name };
      }
    }
    const photo = await inspectInspirationPhoto(file);
    return { blob: photo, type: 'image', contentType: photo.type, ...name };
  } catch {
    return null;
  }
}

/** The budget ran out, or the session did: nothing after this can land. */
function stopsTheQueue(reason: unknown): boolean {
  return reason instanceof ApiError && (reason.code === 'attachment_upload_capacity' || reason.status === 401 || reason.status === 403);
}

/**
 * ONE SAVE FOR ONE ITEM, tried twice at most. The upload is not repeated once
 * it reached the bucket (a second presign would spend a second place in the
 * hourly budget for bytes already there), and the save keeps one request id
 * across both tries, so the server replays rather than saving it twice.
 */
async function bringOne(item: Ready, profileId: string, signal: AbortSignal): Promise<ApiInspiration | null> {
  const requestId = crypto.randomUUID();
  let uploaded: { key: string; contentType: string; size: number } | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (signal.aborted) return null;
    try {
      if (!uploaded) {
        const signed = await presignAttachment({ filename: item.name || 'attachment', contentType: item.contentType, size: item.blob.size }, signal, { profile: profileId });
        await uploadToPresignedUrl(signed.uploadUrl, item.blob, signed.headers, signal);
        uploaded = { key: signed.key, contentType: item.contentType, size: item.blob.size };
      }
      /* A FILE DOES NOT NAME A KIND (as in `keepIt`): a photo alone is an
         'image', a file alone is a 'note'. */
      return await createInspiration({
        text: '', kind: item.type === 'image' ? 'image' : 'note', source: 'app',
        attachments: [{ type: item.type, ...uploaded, ...(item.name ? { name: item.name } : {}) }],
      }, { profile: profileId, requestId, signal });
    } catch (reason) {
      if (stopsTheQueue(reason)) throw reason;
    }
  }
  return null;
}

/**
 * THE QUEUE. Checks every pick, keeps what fits the hourly budget, and brings
 * them in a few at a time. `onLanded` is called as each save lands, in the
 * order they land, which is what lets the field light up one by one rather
 * than all at the end. Resolves with how many landed and how many were left
 * out; it never rejects for one item's sake.
 */
export async function bringInImports(input: {
  files: File[]; door: ImportDoor; profileId: string; signal: AbortSignal;
  onLanded: (saved: ApiInspiration) => void;
}): Promise<{ landed: number; leftOut: number }> {
  const checked = await Promise.all(input.files.map(file => readyForImport(file, input.door)));
  const queue: Ready[] = [];
  let bytes = 0;
  for (const item of checked) {
    if (!item || queue.length >= IMPORT_MAX_ITEMS || bytes + item.blob.size > IMPORT_MAX_BYTES) continue;
    queue.push(item); bytes += item.blob.size;
  }
  let landed = 0, next = 0, stopped = false;
  const worker = async () => {
    while (!stopped && !input.signal.aborted && next < queue.length) {
      const item = queue[next++]!;
      try {
        const saved = await bringOne(item, input.profileId, input.signal);
        if (saved && !input.signal.aborted) { landed += 1; input.onLanded(saved); }
      } catch {
        stopped = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(IMPORT_CONCURRENCY, queue.length) }, worker));
  return { landed, leftOut: input.files.length - landed };
}
