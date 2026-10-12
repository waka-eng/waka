import { isMobileBuild } from './platform';

function mobileOrigin(value: unknown): string {
  if (value !== 'https://dev.waka.im' && value !== 'https://waka.im') throw new Error('Unexpected public WAKA origin.');
  return value;
}
/** Web links must remain usable outside the packaged WebView. */
export function publicWebOrigin(): string {
  return isMobileBuild ? mobileOrigin(import.meta.env.VITE_PUBLIC_WEB_URL) : typeof window === 'undefined' ? '' : window.location.origin;
}
/* `publicApiOrigin` WENT WITH THE KEEPER KEYS. Its one caller was the
   settings page's key panel, which printed the API address beside a minted
   key so it could be pasted into an MCP config — see `SettingsPanel`'s
   header for why that panel is gone. Nothing calls it now, and
   `reachable.test.ts` counted it the moment it stopped being called. */
