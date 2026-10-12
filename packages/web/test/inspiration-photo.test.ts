/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. Real File/Blob bytes exercise
 * the shipped format/size checks without decoding or changing the original. */
import { expect, it } from 'vitest';
import { inspectInspirationPhoto, MAX_PHOTO_BYTES } from '../src/lib/inspiration-photo';

it.each([
  [[255, 216, 255, 225, 0, 16], 'image/jpeg'],
  [[137, 80, 78, 71, 13, 10, 26, 10], 'image/png'],
  ['GIF89a', 'image/gif'],
  ['RIFF1234WEBP', 'image/webp'],
  ['\0\0\0\x18ftypavif\0\0\0\0avifmif1', 'image/avif'],
  ['\0\0\0\x18ftypheic\0\0\0\0heicmif1', 'image/heic'],
] as const)('detects actual photo bytes without trusting extensions or MIME (%s)', async (content, type) => {
  const blob = typeof content === 'string' ? content : new Uint8Array(content);
  const file = new File([blob], 'camera.unknown', { type: '', lastModified: 123 });
  const result = await inspectInspirationPhoto(file);
  expect(result.type).toBe(type); expect(result.name).toBe(file.name); expect(result.lastModified).toBe(123);
  expect(await result.arrayBuffer()).toEqual(await file.arrayBuffer());
});
it('preserves the original JPEG including its EXIF segment rather than rotating/re-encoding it', async () => {
  const file = new File([new Uint8Array([255, 216, 255, 225, 0, 10, 69, 120, 105, 102, 0, 0])], 'camera.jpg', { type: 'image/jpeg' });
  expect(await inspectInspirationPhoto(file)).toBe(file);
});
/* THE REFUSALS ARE KEYS NOW, NOT SENTENCES. These three used to be English
   strings thrown from this lib and printed verbatim, so a Korean reader got
   their own language for the frame and English for the reason. The error
   carries a `MessageKey` and `whyOf` resolves it against the reader's
   locale — see `lib/inspiration-photo.ts`'s `PhotoRefused`.

   SO THIS CASE ASSERTS THE KEY, AND THE WORDS ARE ASSERTED WHERE THEY ARE
   RESOLVED: `korean-reaches-the-screen.test.tsx` reads each refusal through
   `whyOf` in both locales and refuses English on a Korean screen. Checking
   a sentence here would be checking the catalogue twice and the contract
   not at all. */
it('refuses empty, oversized and unsupported files before upload', async () => {
  await expect(inspectInspirationPhoto(new File([], 'empty.png', { type: 'image/png' }))).rejects.toThrow('worldPhotoEmpty');
  await expect(inspectInspirationPhoto(new File([new Uint8Array(MAX_PHOTO_BYTES + 1)], 'large.jpg'))).rejects.toThrow('worldPhotoTooLarge');
  await expect(inspectInspirationPhoto(new File(['<svg onload="alert(1)"/>'], 'fake.png', { type: 'image/png' }))).rejects.toThrow('worldPhotoWrongKind');
});
