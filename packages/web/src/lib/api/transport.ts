import { isMobileBuild, platformServices } from '../platform';
import { NativeSession } from '../platform/session';
import { checkedNativeApiOrigin } from '../platform/api-origin';

export const nativeSession = new NativeSession({
  get: async key => (await platformServices()).credentials.get(key),
  set: async (key, value) => (await platformServices()).credentials.set(key, value),
  remove: async key => (await platformServices()).credentials.remove(key),
}, () => window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT)));

/**
 * HOW LONG A REQUEST MAY GO UNANSWERED BEFORE IT COUNTS AS UNANSWERED.
 *
 * The native branch below has always had this deadline. The web branch was a
 * bare `fetch`, and a browser waits for a server that accepted the connection
 * and then said nothing for as long as the socket stays open — minutes, and
 * on some proxies forever. Every screen that waits on one of these requests
 * then waits with it: the home loading screen, the sign-in check, a chat's
 * history. None of them can offer "Try again" for a request that has not yet
 * failed, so a stall was a dead end that looked like patience.
 *
 * One number for both platforms, so a stalled server reads the same
 * everywhere: as the dead connection it effectively is.
 */
const REQUEST_DEADLINE_MS = 20_000;

/**
 * WHICH 401s MEAN "YOUR SESSION ENDED".
 *
 * A 401 from the sign-in forms is a wrong password, and a 401 from
 * `/auth/me` is the ordinary answer for a visitor who was never signed in —
 * the auth context reads that one itself. Every other 401 means a session
 * this page was using has stopped being accepted, which nothing could tell
 * the person before: each screen met it as its own local error ("you are
 * signed out") with no way to sign back in from where they were.
 */
const NOT_AN_EXPIRY = ['/api/auth/login', '/api/auth/signup', '/api/auth/mobile/exchange', '/api/auth/me', '/api/auth/logout'];
export const SESSION_EXPIRED_EVENT = 'waka:session-expired';
function pathOf(url: string): string {
  try { return new URL(url, window.location.href).pathname; } catch { return url; }
}

/** The shared resource client only. Signed object-storage uploads bypass it. */
export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (!isMobileBuild) return webFetch(url, init);
  const origin = checkedNativeApiOrigin();
  const parsed = new URL(url);
  if (parsed.origin !== origin ||
    parsed.username || parsed.password || parsed.hash || !parsed.pathname.startsWith('/api/')) {
    throw new Error('Native credentials may only reach the configured WAKA API.');
  }
  const publicAuth = ['/api/auth/login', '/api/auth/signup', '/api/auth/mobile/exchange'].includes(parsed.pathname);
  const version = nativeSession.version, token = publicAuth ? null : await nativeSession.read();
  if (version !== nativeSession.version) throw new Error('Account changed before the request started.');
  const headers = new Headers(init.headers);
  if (headers.has('Authorization')) throw new Error('Resource callers cannot choose a session credential.');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  // Browser fetch keeps genuine AbortSignal and Blob semantics. A native
  // session never depends on WebView cookies or globally patched native HTTP.
  const controller = new AbortController();
  const abort = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) abort();
  else init.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), REQUEST_DEADLINE_MS);
  try {
    const response = await fetch(url, { ...init, headers, credentials: 'omit', redirect: 'error', signal: controller.signal });
    if (response.status === 401 && token) await nativeSession.clearIfCurrent(version, token);
    // Resource APIs are buffered JSON/markdown, not upload streams. Keep the
    // deadline active through body transfer rather than only response headers.
    const body = response.status === 204 || response.status === 205 || response.status === 304 ? null : await response.arrayBuffer();
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } finally {
    clearTimeout(timeout); init.signal?.removeEventListener('abort', abort);
  }
}

/**
 * WHICH SESSION A WEB REQUEST WAS SENT WITH.
 *
 * Native compares the token a request carried with the one stored now
 * (`clearIfCurrent`). The web cookie is invisible to script, so the auth
 * context counts identities instead: every time the signed-in account or
 * profile changes — a sign-in, a sign-out, a switch, an expiry — it calls
 * `webSessionChanged`. A 401 is only news about the CURRENT session if the
 * request left under it; a slow read that was sent before the person signed
 * in again must not sign them out of the session they just made.
 */
let webSession = 0;
export function webSessionChanged(): void { webSession += 1; }

/**
 * THE WEB BRANCH: the browser's own fetch, cookie and all, with the deadline
 * and the expiry signal the native branch already had.
 *
 * THE DEADLINE COVERS THE BODY, AND THE BODY IS READ HERE. Leaving the timer
 * armed on a returned stream (the first version of this) let it abort a body
 * mid-read, and `getJson` / `fetchCurrentViewer` swallowed a failed
 * `res.json()` as "no body" — so a stalled `/auth/me` body became a 200 with
 * nothing in it, which reads as signed out. Reading the body inside the
 * deadline, as native does, means a stall anywhere ends as a thrown network
 * error (status 0 to every caller) and never as a quiet success. The timer
 * and the caller's abort listener are released the moment the body is in,
 * whatever happened.
 */
async function webFetch(url: string, init: RequestInit): Promise<Response> {
  const session = webSession;
  const expired = (response: Response) => {
    if (response.status === 401 && session === webSession && !NOT_AN_EXPIRY.includes(pathOf(url))) {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
  };
  /* READS ONLY. A write that has been sent may already be committing, and
     cutting it off at the deadline turns "slow" into "did it save?" — the
     one question a person cannot answer for themselves. The attachment
     finalize is the sharp case (`chat-attachments-api.test.ts`: "the
     finalize could be cut off mid-commit"). Writes keep their caller's own
     signal and the server's own timeouts; what hung forever was the reads
     every screen waits on before it can show anything. */
  const method = (init.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    const response = await fetch(url, init);
    expired(response);
    return response;
  }
  const controller = new AbortController();
  const abort = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) abort();
  else init.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), REQUEST_DEADLINE_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const empty = method === 'HEAD' || response.status === 204 || response.status === 205 || response.status === 304;
    const body = empty ? null : await response.arrayBuffer();
    expired(response);
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener('abort', abort);
  }
}

let revoking: Promise<void> | undefined;
/** Retry offline retirements without restoring the retired account. */
export function revokeRetiredNativeSessions(): Promise<void> {
  if (!isMobileBuild) return Promise.resolve();
  return revoking ??= (async () => {
    const origin = checkedNativeApiOrigin();
    for (const token of await nativeSession.revocations()) {
      try {
        const response = await fetch(`${origin}/api/auth/logout`, { method: 'POST', credentials: 'omit', redirect: 'error',
          headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
        if (response.ok) await nativeSession.acknowledgeRevocation(token);
      } catch { /* Encrypted pending retirement survives offline/restart. */ }
    }
  })().finally(() => { revoking = undefined; });
}
