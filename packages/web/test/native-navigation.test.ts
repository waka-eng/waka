/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. These are real URL and
 * canonical view/destination rules, not simulated OS domain verification. */
import { expect, it } from 'vitest';
import { nativeLinkDestination } from '../src/lib/platform/navigation';
const id = 'im.waka.app.dev', origin = 'https://dev.waka.im';
it.each(['/', '/profile', '/onboarding', '/login', '/@native_fixture', '/w/room1', '/inspirations/source-id', '/review/new', '/principles/principle-id/share', '/chat/new?principle=principle-id', '/?inspiration=source-id&reflection=open#detail'])('preserves owned consumer destination %s', path => {
  expect(nativeLinkDestination(origin + path, id, origin)).toBe(path);
  expect(nativeLinkDestination(`${id}://navigate${path}`, id, origin)).toBe(path);
});
it.each(['https://evil.test/', 'https://dev.waka.im.evil.test/', 'https://user@dev.waka.im/', 'https://dev.waka.im/api/auth/me', 'https://dev.waka.im/mobile-check', 'im.waka.app://navigate/profile', `${id}://navigate:443/profile`, `${id}://auth/callback?code=opaque`, `${id}://navigate/unknown/path`])('refuses foreign or nonconsumer link %s', raw => {
  expect(nativeLinkDestination(raw, id, origin)).toBeNull();
});
