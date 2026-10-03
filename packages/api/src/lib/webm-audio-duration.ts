/** MediaRecorder WebM often omits Segment Duration. Read bounded block timing
 * instead of refusing the browser's own recording. This is an upper bound:
 * RFC 6716 caps each Opus packet at 120 ms, including laced packets.
 * Only audio-only Opus streams validated by the caller may use this helper.
 * References: matroska.org/technical/elements.html and RFC 6716 section 3. */
export function webmOpusDurationBound(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let elements = 0, scale = 1_000_000, largestTimestamp = -1, mostPackets = 1;
  const invalid = () => { throw new Error('Invalid WebM timing'); };
  function vint(at: number, end: number, id = false) {
    if (at >= end || !bytes[at]) return invalid();
    let width = 1, marker = 0x80;
    while (!(bytes[at]! & marker)) { width += 1; marker >>= 1; }
    if (width > (id ? 4 : 8) || at + width > end) return invalid();
    let value = id ? bytes[at]! : bytes[at]! & (marker - 1);
    let unknown = !id && value === marker - 1;
    for (let i = 1; i < width; i += 1) { value = value * 256 + bytes[at + i]!; unknown &&= bytes[at + i] === 255; }
    if (!unknown && !Number.isSafeInteger(value)) return invalid();
    return { value, width, unknown };
  }
  function integer(start: number, end: number) {
    if (end <= start || end - start > 8) return invalid();
    let value = 0;
    for (let at = start; at < end; at += 1) value = value * 256 + bytes[at]!;
    if (!Number.isSafeInteger(value)) return invalid();
    return value;
  }
  function walk(start: number, end: number, parent = 0, depth = 0, clusterTimestamp?: number): number {
    if (depth > 8) return invalid();
    let at = start, timestamp = clusterTimestamp;
    while (at < end) {
      if (++elements > 200_000) return invalid();
      const id = vint(at, end, true);
      // An unknown-size Cluster ends when the next same-level Cluster begins.
      if (parent === 0x1f43b675 && id.value === 0x1f43b675) return at;
      const size = vint(at + id.width, end);
      const body = at + id.width + size.width;
      const next = size.unknown ? end : body + size.value;
      if (next > end || next < body) return invalid();
      if (size.unknown && id.value !== 0x18538067 && id.value !== 0x1f43b675) return invalid();
      if ([0x18538067, 0x1549a966, 0x1f43b675, 0xa0].includes(id.value)) {
        at = walk(body, next, id.value, depth + 1, id.value === 0x1f43b675 ? undefined : timestamp);
        continue;
      }
      if (id.value === 0x2ad7b1 && parent === 0x1549a966) {
        scale = integer(body, next); if (scale <= 0) return invalid();
      } else if (id.value === 0xe7 && parent === 0x1f43b675) timestamp = integer(body, next);
      else if ((id.value === 0xa3 && parent === 0x1f43b675) || (id.value === 0xa1 && parent === 0xa0)) {
        if (timestamp === undefined) return invalid();
        const track = vint(body, next);
        const header = body + track.width;
        if (!track.value || header + 4 > next) return invalid();
        const tick = timestamp + view.getInt16(header, false);
        if (tick < 0) return invalid();
        const laced = (bytes[header + 2]! & 6) !== 0;
        if (laced && header + 5 > next) return invalid();
        const packetCount = laced ? bytes[header + 3]! + 1 : 1;
        largestTimestamp = Math.max(largestTimestamp, tick);
        mostPackets = Math.max(mostPackets, packetCount);
      }
      at = next;
    }
    return at;
  }
  walk(0, bytes.length);
  if (largestTimestamp < 0) return invalid();
  const upperBound = largestTimestamp * scale / 1e9 + mostPackets * .12;
  if (!Number.isFinite(upperBound)) return invalid();
  return upperBound;
}
