import { isMobileBuild } from './platform';

function mobileOrigin(value: unknown): string {
  if (value !== 'https://dev.waka.im' && value !== 'https://waka.im') throw new Error('Unexpected public WAKA origin.');
  return value;
}
/** Web links must remain usable outside the packaged WebView. */
export function publicWebOrigin(): string {
  return isMobileBuild ? mobileOrigin(import.meta.env.VITE_PUBLIC_WEB_URL) : typeof window === 'undefined' ? '' : window.location.origin;
}
export function publicApiOrigin(): string {
  return isMobileBuild ? mobileOrigin(import.meta.env.VITE_API_URL) : typeof window === 'undefined' ? '' : window.location.origin;
}
