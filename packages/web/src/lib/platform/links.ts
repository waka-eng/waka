/** Use the standard HTTPS authority parser for components of our own app
 * scheme. WebViews can represent non-special URL authorities differently.
 * The returned URL is only a parsed descriptor; it is never fetched. */
export function parseAppLink(raw: string, appId: string): URL {
  if (!/^im\.waka\.app(?:\.(?:dev|test))?$/.test(appId) || !raw.startsWith(`${appId}://`)) throw new Error('Foreign app link.');
  const suffix = raw.slice(appId.length + 1);
  const authority = suffix.slice(2).split(/[/?#]/, 1)[0];
  if (!/^[A-Za-z][A-Za-z0-9.-]*$/.test(authority)) throw new Error('Invalid app link authority.');
  if (!/^\/\/[A-Za-z][A-Za-z0-9.-]*(?:[/:?#]|$)/.test(suffix)) throw new Error('Invalid app link authority.');
  const parsed = new URL(`https:${suffix}`);
  if (parsed.username || parsed.password || parsed.hash) throw new Error('Invalid app link payload.');
  return parsed;
}
