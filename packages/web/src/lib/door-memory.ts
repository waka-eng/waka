/**
 * WHO WAS LAST HERE — the door's own memory, and the four things it may hold.
 *
 * A game does not meet a returning player with an empty credential prompt. It
 * shows them their save: the name, and when they last put it down. The door
 * had no way to do that, because the only thing it knew about a returning
 * person was whatever the browser's autofill happened to put in the email
 * field.
 *
 * WHY THIS IS NOT THE AUTH CACHE. `lib/auth-context` already mirrors the
 * signed-in viewer into `localStorage` under `waka.auth.viewer`, and reusing
 * it here would have been one line. It is the wrong line, for a reason worth
 * writing down: that cache is DROPPED the moment `/auth/me` cannot confirm a
 * session — on sign-out, on expiry, on a dead network — because a cache that
 * outlives its session is the one mistake a session cache must never make.
 * The door's memory is the exact opposite: it is at its most useful precisely
 * when the session is gone, which is the only time anybody sees the door. Two
 * lifetimes, two records, and neither may be read as the other.
 *
 *   waka.auth.viewer  — "there is a session"      · dropped when unconfirmed
 *   waka.door.last    — "somebody signs in here"  · survives sign-out
 *
 * SO IT IS A DISPLAY HINT AND NOTHING ELSE, and the type enforces it: a name,
 * an address to prefill, and a date. No token, no id, no profile, nothing from
 * the archive. Everything here is already visible to anyone holding this
 * machine — the browser's own password manager stores strictly more — and
 * nothing here opens anything: the session cookie is httpOnly and the server
 * is still the only thing that decides who is signed in.
 *
 * IT IS STILL A NAME ON A SHARED SCREEN, and that is why `forgetAtDoor` is
 * wired to a visible verb on the door rather than kept as an internal detail.
 * A person who does not recognise the name they are greeted with must be able
 * to remove it in one press, without signing in first to do it.
 */

export interface DoorMemory {
  /** what to call them — the profile's display name at their last sign-in */
  name: string;
  /** prefilled into the email field, never sent anywhere on its own */
  email: string;
  /** ISO 8601; rendered through `whenShort`, never as a raw date */
  at: string;
}

const STORAGE_KEY = "waka.door.last";

/**
 * Read the door's memory, defensively.
 *
 * Anything malformed is "nobody has been here" rather than a throw. This is
 * chrome on the FIRST screen of the product: a hand-edited key, a half-written
 * value from a killed tab, or a shape from a future version must degrade to an
 * ordinary empty door, never to a screen that cannot render.
 */
export function readDoorMemory(): DoorMemory | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage?.getItem?.(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DoorMemory> | null;
    const name = typeof parsed?.name === "string" ? parsed.name.trim() : "";
    const email = typeof parsed?.email === "string" ? parsed.email.trim() : "";
    const at = typeof parsed?.at === "string" ? parsed.at : "";
    /* A memory with no NAME is not a save file, it is an email address the
       browser could have filled in anyway — and greeting somebody by an empty
       string is worse than not greeting them. A memory with no DATE is kept:
       "welcome back" without "last here" is still true. */
    if (!name || !email) return null;
    return { name, email, at };
  } catch {
    return null;
  }
}

/**
 * Record who just got in. Called wherever a session actually starts, so the
 * Google round-trip — which leaves the page entirely and comes back — is
 * covered by the same line as the form.
 *
 * Best-effort: Safari's private mode and a full quota both throw on write, and
 * neither may be allowed to break the sign-in that just succeeded.
 */
export function rememberAtDoor(input: { name: string; email: string }): void {
  if (typeof window === "undefined") return;
  const name = input.name.trim();
  const email = input.email.trim();
  if (!name || !email) return;
  try {
    const memory: DoorMemory = { name, email, at: new Date().toISOString() };
    window.localStorage?.setItem?.(STORAGE_KEY, JSON.stringify(memory));
  } catch {
    // best-effort — the door simply greets the next visitor as a stranger
  }
}

/**
 * Forget who was here. Two callers, and they are different acts:
 *
 *   - "not you?" on the door — someone else's machine, or a name the visitor
 *     does not recognise. The one press that must always work.
 *   - account erasure — the person is gone; the door has nobody to remember.
 *
 * Signing out is deliberately NOT one of them. Leaving is not forgetting, and
 * a save file that erased itself every time you put the game down would be no
 * save file at all.
 */
export function forgetAtDoor(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.removeItem?.(STORAGE_KEY);
  } catch {
    // best-effort
  }
}
