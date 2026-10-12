import { parseAppLink } from './links';
import { readViewLocation } from '../view-location';
import { safeInAppPath } from '../sign-in-destination';

/** Route mapping only. OS domain/signing verification is a separate gate. */
export function nativeLinkDestination(raw: string, appId: string, webOrigin: string): string | null {
  if (raw.length > 4096) return null;
  try {
    let url: URL;
    if (raw.startsWith('https://')) {
      url = new URL(raw);
      if (url.origin !== webOrigin || url.username || url.password) return null;
    } else {
      const hash = raw.indexOf('#');
      url = parseAppLink(hash < 0 ? raw : raw.slice(0, hash), appId);
      if (url.hostname !== 'navigate') return null;
      if (hash >= 0) url.hash = raw.slice(hash);
    }
    const path = url.pathname + url.search + url.hash;
    if (url.pathname === '/login') return path;
    if (!safeInAppPath(path)) return null;
    /* `/profile` LEFT THIS LIST (2026-10-11), the same way `/review/...` did
       the day before, and for the same reason: the route is gone. The
       settings page became a panel in the corner, so `/profile` is no longer
       declared in `main.tsx`. It did NOT start 404ing — it falls through to
       `<Route path="/:handle">`, which fails to resolve "profile" as a handle
       and redirects to "/". A deep link that opens the app on the wrong
       screen is worse than one the app refuses, because the person believes
       they arrived. */
    if (url.pathname === '/onboarding' || /^\/@[a-z0-9_-]{3,24}$/.test(url.pathname) ||
      readViewLocation(url.pathname, url.search)) return path;
  } catch { /* A foreign or malformed URL never controls app navigation. */ }
  return null;
}
