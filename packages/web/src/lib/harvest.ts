/**
 * THE SAVE REQUEST ID A HARVEST CANDIDATE'S SAVE IS MADE UNDER.
 *
 * The candidate's own words are saved under the candidate's id; corrected
 * words under an id derived from the candidate and those words. One id per
 * (candidate, words), known before the save is sent, so a lost response
 * retried is the same save, never a second. The server checks a keep's save
 * was made under one of the two (`harvestSaveRequestId` in
 * packages/api/src/routes/harvest.ts) — keep the two derivations equal; the
 * shared vector in test/harvest-request-id.test.ts holds them together.
 */
export async function harvestSaveRequestId(candidateId: string, words: string): Promise<string> {
  const normal = words.normalize("NFC").replace(/\s+/g, " ").trim();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${candidateId.toLowerCase()}\n${normal}`));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const variant = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** The id for a keep: the candidate's own when the words are unchanged. */
export async function candidateSaveRequestId(candidate: { id: string; text: string }, words: string): Promise<string> {
  return words === candidate.text ? candidate.id : harvestSaveRequestId(candidate.id, words);
}
