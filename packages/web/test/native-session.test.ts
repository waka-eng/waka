/** WHAT THIS MOCKS, AND WHY (gate G6): nothing is module-mocked. An injected
 * in-memory CredentialStore replaces
 * device Keychain/Keystore. It proves ordering/retirement, not OS encryption;
 * real bridge persistence was verified in M1 and authenticated M2 UI remains. */
import { describe, expect, it, vi } from 'vitest';
import { NativeSession } from '../src/lib/platform/session';
import type { CredentialStore } from '../src/lib/platform/contracts';

const tokenA = 'synthetic_session_token_account_a', tokenB = 'synthetic_session_token_account_b';
function fixture() {
  const values = new Map<string, string>();
  const credentials: CredentialStore = {
    get: async key => values.get(key) ?? null,
    set: async (key, value) => { values.set(key, value); },
    remove: async key => { values.delete(key); },
  };
  return { values, credentials, session: new NativeSession(credentials) };
}
describe('native human session lifecycle', () => {
  it('adopts securely and restores only the active credential', async () => {
    const { session, credentials } = fixture();
    await session.adopt(tokenA, session.beginChange());
    expect(await new NativeSession(credentials).read()).toBe(tokenA);
  });
  it('retires before removing, retains offline revocation and never restores retired tokens', async () => {
    const { session, credentials, values } = fixture();
    await session.adopt(tokenA, session.beginChange());
    credentials.remove = vi.fn(async () => { throw new Error('storage interruption'); });
    await expect(session.clear()).rejects.toThrow('storage interruption');
    expect(values.get('auth.session')).toBe(tokenA);
    expect(await new NativeSession(credentials).read()).toBeNull();
    expect(await session.revocations()).toEqual([tokenA]);
  });
  it('a delayed sign-in cannot resurrect a logged-out credential', async () => {
    const { session } = fixture();
    const loginVersion = session.beginChange();
    await session.clear();
    await expect(session.adopt(tokenA, loginVersion)).rejects.toThrow('superseded');
    expect(await session.read()).toBeNull();
  });
  it('logout during a protected-store write retires the late token', async () => {
    const { session, credentials } = fixture();
    let release!: () => void, started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const set = credentials.set;
    credentials.set = async (key, value) => { if (key === 'auth.session') { started(); await blocked; } await set(key, value); };
    const adoption = session.adopt(tokenA, session.beginChange());
    const failure = expect(adoption).rejects.toThrow('superseded');
    await entered;
    const logout = session.clear(); release();
    await failure; await logout;
    expect(await session.read()).toBeNull(); expect(await session.revocations()).toEqual([tokenA]);
  });
  it('an old 401 cannot erase a newer account and retirement acknowledgement preserves it', async () => {
    const { session } = fixture();
    const old = session.beginChange(); await session.adopt(tokenA, old);
    await session.adopt(tokenB, session.beginChange());
    await session.clearIfCurrent(old, tokenA);
    await session.acknowledgeRevocation(tokenA);
    expect(await session.read()).toBe(tokenB); expect(await session.revocations()).toEqual([]);
  });
  it('invalid tokens and failed secure writes cannot create a session', async () => {
    const { session, credentials } = fixture();
    await expect(session.adopt('Bearer unsafe token', session.beginChange())).rejects.toThrow('Invalid');
    credentials.set = async () => { throw new Error('keychain denied'); };
    await expect(session.adopt(tokenA, session.beginChange())).rejects.toThrow('keychain denied');
    expect(await session.read()).toBeNull();
  });
});
