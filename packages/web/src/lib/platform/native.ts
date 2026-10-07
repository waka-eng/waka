import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import type { PlatformServices } from './contracts';

const SecureStorage = registerPlugin<{
  get(input: { key: string }): Promise<{ value: string | null }>;
  set(input: { key: string; value: string }): Promise<void>;
  remove(input: { key: string }): Promise<void>;
}>('SecureStorage');
function localPath(path: string) {
  if (!/^[A-Za-z0-9_./-]{1,240}$/.test(path) || path.startsWith('/') || path.split('/').some(part => !part || part === '..' || part === '.')) throw new Error('Invalid local file path.');
  return `waka/${path}`;
}
export function nativePlatform(): PlatformServices {
  const platform = Capacitor.getPlatform();
  if (!Capacitor.isNativePlatform() || (platform !== 'ios' && platform !== 'android')) throw new Error('Native bridge is unavailable.');
  const origin = import.meta.env.VITE_API_URL as string;
  if (!['https://dev.waka.im', 'https://waka.im'].includes(origin)) throw new Error('Unexpected mobile API origin.');
  return {
    async identity() {
      const info = await App.getInfo();
      if (info.id !== import.meta.env.VITE_APP_ID) throw new Error('The binary and bundled app identities differ.');
      return { id: info.id, name: info.name, version: info.version, platform };
    },
    credentials: {
      async get(key) { return (await SecureStorage.get({ key })).value; },
      async set(key, value) { await SecureStorage.set({ key, value }); },
      async remove(key) { await SecureStorage.remove({ key }); },
    },
    files: {
      async write(path, text) { await Filesystem.writeFile({ path: localPath(path), data: text, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true }); },
      async read(path) {
        const file = await Filesystem.readFile({ path: localPath(path), directory: Directory.Data, encoding: Encoding.UTF8 });
        if (typeof file.data !== 'string') throw new Error('Expected text metadata.');
        return file.data;
      },
      async remove(path) { await Filesystem.deleteFile({ path: localPath(path), directory: Directory.Data }); },
    },
    async health() {
      try {
        // Explicit native request for a public handshake only. Do not patch
        // fetch globally: signed uploads must keep their browser/file contract.
        const response = await CapacitorHttp.get({ url: `${origin}/api/health`, connectTimeout: 5000, readTimeout: 5000 });
        return { connected: response.status === 200 && response.data?.ok === true && response.data?.service === 'waka', origin };
      } catch { return { connected: false, origin }; }
    },
    async openBrowser(url) {
      const parsed = new URL(url);
      if (parsed.origin !== origin || parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Unexpected authorization origin.');
      await Browser.open({ url });
    },
    async listenForLinks(listener) {
      const emit = (url: string, source: string) => {
        if (import.meta.env.VITE_MOBILE_DIAGNOSTICS === '1') {
          try {
            const parsed = new URL(url);
            void Filesystem.writeFile({ path: 'waka/m1/link.json', data: JSON.stringify({ source, scheme: parsed.protocol, host: parsed.hostname, path: parsed.pathname, prefix: url.split('?')[0] }), directory: Directory.Data, encoding: Encoding.UTF8, recursive: true });
          } catch { /* No raw URLs, query values or credentials in the report. */ }
        }
        listener(url);
      };
      const handle = await App.addListener('appUrlOpen', event => emit(event.url, 'event'));
      const launch = await App.getLaunchUrl();
      if (launch?.url) emit(launch.url, 'launch');
      return () => { void handle.remove(); };
    },
  };
}
