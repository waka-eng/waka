/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. Small encoded EBML elements
 * exercise the real timing reader, including MediaRecorder's unknown sizes. */
import { expect, it } from 'vitest';
import { webmOpusDurationBound } from './webm-audio-duration.js';
const element = (id: number[], data: number[]) => [...id, 0x80 | data.length, ...data];
const block = (relative: number, flags = 0x80, payload = [0]) => element([0xa3], [0x81, (relative >> 8) & 255, relative & 255, flags, ...payload]);
const cluster = (timestamp: number, blocks: number[]) => [...[0x1f, 0x43, 0xb6, 0x75, 0xff], ...element([0xe7], [timestamp >> 8, timestamp & 255]), ...blocks];
it('bounds multiple unknown-size clusters without needing a Duration element', () => {
  const input = Uint8Array.from([0x18, 0x53, 0x80, 0x67, 0xff, ...cluster(0, block(0)), ...cluster(2000, block(25))]);
  expect(webmOpusDurationBound(input)).toBeCloseTo(2.145);
});
it('honors timestamp scale and conservatively includes every laced packet', () => {
  const info = element([0x15, 0x49, 0xa9, 0x66], element([0x2a, 0xd7, 0xb1], [0x1e, 0x84, 0x80]));
  expect(webmOpusDurationBound(Uint8Array.from([...info, ...cluster(1000, block(0, 0x82, [2, 1, 1, 0, 0, 0]))]))).toBeCloseTo(2.36);
});
it.each([
  [], [0], [0xa3, 0xff], [0xa3, 0x89, 1],
  [...cluster(0, block(-1))], [...cluster(0, element([0xa3], [0x81, 0]))],
].map(bytes => ({ bytes })))('refuses missing or malformed timing %#', ({ bytes }) => {
  expect(() => webmOpusDurationBound(Uint8Array.from(bytes))).toThrow('Invalid WebM timing');
});
