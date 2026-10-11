/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. These are real URL and
 * canonical view/destination rules, not simulated OS domain verification. */
/* `/review/new` MOVED FROM THE FIRST LIST TO THE SECOND (2026-10-10), which
   is the assertion rather than a side effect of one. The review is folded and
   `readViewLocation` no longer parses `/review/...`, so the native layer must
   now REFUSE that link instead of handing it to the app — otherwise a tap on
   an old notification or a shared URL would open the world with nothing in
   it. The invariant is unchanged and still enforced: a destination is owned
   if and only if the view model can resolve it. */
import { expect, it } from 'vitest';
import { nativeLinkDestination } from '../src/lib/platform/navigation';
const id = 'im.waka.app.dev', origin = 'https://dev.waka.im';
it.each(['/', '/profile', '/onboarding', '/login', '/@native_fixture', '/w/room1', '/inspirations/source-id', '/principles/principle-id/share', '/chat/new?principle=principle-id', '/?inspiration=source-id&reflection=open#detail'])('preserves owned consumer destination %s', path => {
  expect(nativeLinkDestination(origin + path, id, origin)).toBe(path);
  expect(nativeLinkDestination(`${id}://navigate${path}`, id, origin)).toBe(path);
});
it.each(['https://evil.test/', 'https://dev.waka.im.evil.test/', 'https://user@dev.waka.im/', 'https://dev.waka.im/api/auth/me', 'https://dev.waka.im/mobile-check', 'im.waka.app://navigate/profile', `${id}://navigate:443/profile`, `${id}://auth/callback?code=opaque`, `${id}://navigate/unknown/path`, origin + '/review/new', `${id}://navigate/review/new`])('refuses foreign or nonconsumer link %s', raw => {
  expect(nativeLinkDestination(raw, id, origin)).toBeNull();
});
