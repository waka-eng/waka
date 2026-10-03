/** Inspect a small header, not the filename or the browser's MIME guess.
 * Keep original bytes (including EXIF orientation); never re-encode a capture. */
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
export async function inspectInspirationPhoto(file: File): Promise<File> {
  if (!file.size) throw new Error('This file is empty.');
  if (file.size > MAX_PHOTO_BYTES) throw new Error('This photo is over 25 MB. Choose a smaller copy.');
  const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  let type = '';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) type = 'image/jpeg';
  else if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) type = 'image/png';
  else if (['GIF87a', 'GIF89a'].includes(ascii(0, 6))) type = 'image/gif';
  else if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') type = 'image/webp';
  else if (ascii(4, 8) === 'ftyp') {
    const brands = [ascii(8, 12)];
    const boxSize = bytes.length >= 4 ? new DataView(bytes.buffer).getUint32(0) : 0;
    for (let i = 16; i + 4 <= Math.min(boxSize, bytes.length); i += 4) brands.push(ascii(i, i + 4));
    if (brands.some(brand => ['avif', 'avis'].includes(brand))) type = 'image/avif';
    else if (brands.some(brand => ['heic', 'heix', 'hevc', 'hevx'].includes(brand))) type = 'image/heic';
    else if (brands.some(brand => ['mif1', 'msf1'].includes(brand))) type = 'image/heif';
  }
  if (!type) throw new Error('Use a JPEG, PNG, WebP, GIF, AVIF or HEIC photo.');
  return file.type === type ? file : new File([file], file.name, { type, lastModified: file.lastModified });
}
