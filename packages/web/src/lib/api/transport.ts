import { isMobileBuild, platformServices } from '../platform';
import { NativeSession } from '../platform/session';
import { checkedNativeApiOrigin } from '../platform/api-origin';

export const nativeSession = new NativeSession({
  get: async key => (await platformServices()).credentials.get(key),
  set: async (key, value) => (await platformServices()).credentials.set(key, value),
  remove: async key => (await platformServices()).credentials.remove(key),
}, () => window.dispatchEvent(new Event('waka:session-expired')));

/**
 * THE WEB READ DEADLINE — and nothing about sessions.
 *
 * The native branch below has always had a 20s deadline. The web branch was
 * a bare `fetch`, and a browser waits for a server that accepted the
 * connection and then said nothing for as long as the socket stays open, so
 * every screen waiting on a read waited with it, with no "Try again" for a
 * request that had not yet failed. Web READS now get the same 20s for the
 * server to START answering (time to response headers); the body then reads
 * as on dev, with no deadline, so a slow but progressing download is never
 * cut off. Writes are untouched (one that has been sent may already be
 * committing), and so is every auth endpoint: `/auth/me` waits as on dev, so
 * a slow server can never turn a valid session into "signed out". 401s pass
 * through exactly as before.
 */
const READ_FIRST_BYTE_MS = 20_000;
function isAuthEndpoint(url: string): boolean {
  try { return new URL(url, window.location.href).pathname.startsWith('/api/auth/'); } catch { return false; }
}
async function webRead(url: string, init: RequestInit): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  if ((method !== 'GET' && method !== 'HEAD') || isAuthEndpoint(url)) return fetch(url, init);
  /* The deadline has its own signal, combined with the caller's by
     `AbortSignal.any`: no listener is added to the caller's signal, so none
     can outlive the read, and the caller's abort still reaches the body read
     that follows. Where `any` is missing, a listener bridges the two and is
     removed the moment the read settles. */
  const deadline = new AbortController();
  const timeout = setTimeout(() => deadline.abort(new DOMException('Request timed out', 'TimeoutError')), READ_FIRST_BYTE_MS);
  const caller = init.signal ?? null;
  const combine = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  let release = () => {};
  let signal: AbortSignal = deadline.signal;
  if (caller && combine) signal = combine([caller, deadline.signal]);
  else if (caller) {
    const abort = () => deadline.abort(caller.reason);
    if (caller.aborted) abort(); else caller.addEventListener('abort', abort, { once: true });
    release = () => caller.removeEventListener('abort', abort);
  }
  try {
    return await fetch(url, { ...init, signal });
  } finally {
    clearTimeout(timeout);
    release();
  }
}

/** The shared resource client only. Signed object-storage uploads bypass it. */
export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (!isMobileBuild) {
    const response = await webRead(url, init);
    /* A WEB 401 IS A QUESTION, NOT AN ANSWER. The cookie is invisible to
       script, so this cannot tell a 401 from the current session apart from
       a slow read sent under the previous one. It only asks the provider to
       check with `/auth/me` (docs/plans/session-expiry.md, B); the response
       still passes through unchanged and nothing here signs anyone out. */
    if (response.status === 401 && typeof window !== 'undefined' && !isAuthEndpoint(url)) window.dispatchEvent(new Event('waka:session-check'));
    return response;
  }
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
  const timeout = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), 20_000);
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
