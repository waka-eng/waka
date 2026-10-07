import type { CredentialStore } from './contracts';

/** One human-session credential, never a WebView storage/display cache. */
export class NativeSession {
  private revision = 0;
  private token: string | null | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly credentials: CredentialStore, private readonly onInvalidated: () => void = () => {}) {}
  get version() { return this.revision; }
  beginChange() { return ++this.revision; }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => {});
    return result;
  }
  private async load() {
    if (this.token === undefined) {
      const saved = await this.credentials.get('auth.session');
      this.token = saved && !(await this.pending()).includes(saved) ? saved : null;
    }
    return this.token;
  }
  private async pending(): Promise<string[]> {
    const raw = await this.credentials.get('auth.revocations');
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(value => typeof value === 'string')) throw new Error('Invalid pending session revocations.');
    return parsed;
  }
  private async retire(token: string) {
    const pending = await this.pending();
    if (!pending.includes(token)) {
      if (pending.length >= 32) throw new Error('Reconnect to finish signing out before signing in again.');
      const serialized = JSON.stringify([...pending, token]);
      if (new TextEncoder().encode(serialized).length > 16384) throw new Error('Reconnect to finish signing out before signing in again.');
      await this.credentials.set('auth.revocations', serialized);
    }
  }
  revocations() { return this.serial(() => this.pending()); }
  acknowledgeRevocation(token: string) {
    return this.serial(async () => {
      const remaining = (await this.pending()).filter(value => value !== token);
      if (remaining.length) await this.credentials.set('auth.revocations', JSON.stringify(remaining));
      else await this.credentials.remove('auth.revocations');
    });
  }
  read() { return this.serial(() => this.load()); }
  adopt(token: string, version: number) {
    if (!/^[A-Za-z0-9_.-]{20,8192}$/.test(token)) return Promise.reject(new Error('Invalid session credential.'));
    return this.serial(async () => {
      if (version !== this.revision) throw new Error('Sign-in was superseded.');
      const previous = await this.load();
      if (previous && previous !== token) await this.retire(previous);
      await this.credentials.set('auth.session', token);
      if (version !== this.revision) {
        await this.retire(token);
        await this.credentials.remove('auth.session'); this.token = null;
        throw new Error('Sign-in was superseded.');
      }
      this.token = token;
    });
  }
  clear(version = this.beginChange()) {
    return this.serial(async () => {
      if (version !== this.revision) return null;
      const previous = await this.load();
      // Persist retirement before removing the active key. After a crash or
      // offline logout this credential can never hydrate a viewer again.
      if (previous) await this.retire(previous);
      this.token = null;
      this.onInvalidated();
      await this.credentials.remove('auth.session');
      return previous;
    });
  }
  /** A late unauthorized response must not erase a newer account's session. */
  clearIfCurrent(version: number, token: string | null) {
    return this.serial(async () => {
      if (version !== this.revision || token !== await this.load()) return;
      this.revision++;
      await this.credentials.remove('auth.session'); this.token = null;
      this.onInvalidated();
    });
  }
}
