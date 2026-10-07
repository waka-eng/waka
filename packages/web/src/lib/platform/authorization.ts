export interface AuthorizationAttempt {
  state: string;
  verifier: string;
  challenge: string;
  callback: string;
  expiresAt: number;
}
function encode(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function createAuthorizationAttempt(appId: string, now = Date.now()): Promise<AuthorizationAttempt> {
  if (!/^im\.waka\.app(?:\.dev)?$/.test(appId)) throw new Error('Unknown app identity.');
  const verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { state: encode(crypto.getRandomValues(new Uint8Array(32))), verifier,
    challenge: encode(new Uint8Array(digest)), callback: `${appId}://auth/callback`, expiresAt: now + 300000 };
}
/** A handoff carries only a short-lived code. The M2 server must enforce code
 * expiry, single-use exchange, PKCE and human-profile binding independently. */
export function validateAuthorizationCallback(attempt: AuthorizationAttempt, callback: string, now = Date.now()) {
  const appId = attempt.callback.split(':')[0];
  const actual = parseAppLink(callback, appId), expected = parseAppLink(attempt.callback, appId);
  if (actual.protocol !== expected.protocol || actual.host !== expected.host || actual.pathname !== expected.pathname || actual.hash || actual.username || actual.password) throw new Error('Unexpected sign-in callback.');
  if (now >= attempt.expiresAt) throw new Error('Sign-in attempt expired.');
  if (actual.searchParams.getAll('state').length !== 1 || actual.searchParams.get('state') !== attempt.state) throw new Error('Sign-in state differs.');
  if ([...actual.searchParams.keys()].some(key => key !== 'state' && key !== 'code')) throw new Error('Unexpected callback payload.');
  const code = actual.searchParams.get('code');
  if (actual.searchParams.getAll('code').length !== 1 || !code || !/^[A-Za-z0-9_-]{16,512}$/.test(code)) throw new Error('Invalid sign-in code.');
  return { code, verifier: attempt.verifier };
}
import { parseAppLink } from './links';
