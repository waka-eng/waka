import { createAuthorizationAttempt, validateAuthorizationCallback, type AuthorizationAttempt } from './authorization';
import { platformServices } from './index';
import { nativeSession } from '../api/transport';
import { postJson, apiPath } from '../api/http';
import type { AuthSessionResponse } from '../api/auth';
import { Browser } from '@capacitor/browser';
import type { PluginListenerHandle } from '@capacitor/core';
import { safeInAppPath, DEFAULT_REDIRECT } from '../sign-in-destination';

const pendingKey = 'auth.authorization';
interface PendingSignIn { attempt: AuthorizationAttempt; destination: string; }
let consuming: Promise<string> | undefined;
let liveAttemptVersion: number | undefined;
let dismissal: PluginListenerHandle | undefined;
async function releaseDismissal() {
  const listener = dismissal; dismissal = undefined;
  await listener?.remove();
}
export async function startNativeGoogleSignIn(destination: string): Promise<void> {
  const version = nativeSession.beginChange(); liveAttemptVersion = version;
  const appId = import.meta.env.VITE_APP_ID as string;
  const attempt = await createAuthorizationAttempt(appId);
  const services = await platformServices();
  if (version !== nativeSession.version) throw new Error('Sign-in was superseded.');
  await releaseDismissal();
  dismissal = await Browser.addListener('browserFinished', () => {
    if (liveAttemptVersion !== version) return;
    liveAttemptVersion = undefined; nativeSession.beginChange();
    void services.credentials.remove(pendingKey).catch(() => {});
    void releaseDismissal();
  });
  await services.credentials.set(pendingKey, JSON.stringify({ attempt, destination: safeInAppPath(destination) ?? DEFAULT_REDIRECT }));
  if (version !== nativeSession.version) throw new Error('Sign-in was superseded.');
  const params = new URLSearchParams({ appId, state: attempt.state, challenge: attempt.challenge });
  try { await services.openBrowser(`${apiPath('/auth/mobile/google')}?${params}`); }
  catch (error) { await releaseDismissal(); await services.credentials.remove(pendingKey); throw error; }
}
export async function hasNativeGoogleSignIn(): Promise<boolean> {
  return Boolean(await (await platformServices()).credentials.get(pendingKey));
}
export async function cancelNativeGoogleSignIn(): Promise<void> {
  nativeSession.beginChange();
  liveAttemptVersion = undefined;
  await releaseDismissal();
  await (await platformServices()).credentials.remove(pendingKey);
  await Browser.close().catch(() => {});
}
export function completeNativeGoogleSignIn(callback: string): Promise<string> {
  // Coalesce duplicate OS delivery while the first atomic server exchange is
  // in flight. The persisted app attempt remains until successful adoption.
  return consuming ??= (async () => {
    const services = await platformServices();
    const raw = await services.credentials.get(pendingKey);
    if (!raw) throw new Error('No pending sign-in.');
    const pending = JSON.parse(raw) as PendingSignIn;
    const { code, verifier } = validateAuthorizationCallback(pending.attempt, callback);
    if (liveAttemptVersion !== undefined && liveAttemptVersion !== nativeSession.version) throw new Error('Sign-in was superseded.');
    if (liveAttemptVersion === undefined && nativeSession.version !== 0) throw new Error('Sign-in was superseded.');
    const version = liveAttemptVersion ?? nativeSession.beginChange();
    const response = await postJson<AuthSessionResponse>(apiPath('/auth/mobile/exchange'), {
      appId: import.meta.env.VITE_APP_ID, state: pending.attempt.state, code, verifier,
    }, 'Sign-in could not finish. Please try again.');
    if (response.profile.type !== 'human' || response.profile.accountId !== response.account.id) throw new Error('Expected your personal profile.');
    await nativeSession.adopt(response.token, version);
    await services.credentials.remove(pendingKey);
    liveAttemptVersion = undefined;
    await releaseDismissal();
    await Browser.close().catch(() => {});
    return safeInAppPath(pending.destination) ?? DEFAULT_REDIRECT;
  })().finally(() => { consuming = undefined; });
}
