/**
 * WHAT EACH KEY READ (founder, 2026-11-26, agent to agent): under the keys
 * that let Claude or ChatGPT into this memory, the reads they made, newest
 * first, in plain words: "Read your 3 principles", "Searched for “job”". The
 * key's own name says which; revoking that key, just above, is how to stop
 * it. Reads by the app itself are never listed.
 */
import { useEffect, useState } from "react";

import { fetchMcpReads, type ApiMcpRead } from "../lib/api/sessions";
import { formatMessage, t, type SupportedLocale } from "../lib/locales";
import { dateWords } from "../lib/words";

const SHOWN = 12;

export function McpRecentReads({ locale, profileId }: { locale: SupportedLocale; profileId: string }): JSX.Element {
  const [reads, setReads] = useState<ApiMcpRead[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setReads(null); setFailed(false);
    fetchMcpReads(profileId).then(rows => { if (live) setReads(rows); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [profileId]);
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  const what = (read: ApiMcpRead): string => {
    switch (read.tool) {
      case "principles": return read.detail && read.detail !== "0" ? formatMessage(locale, "mcpReadPrinciplesCount", { count: Number(read.detail) }) : say("mcpReadPrinciples");
      case "recall": return read.detail ? formatMessage(locale, "mcpReadSearched", { words: read.detail }) : say("mcpReadSearchedPlain");
      case "inspirations": return say("mcpReadInspirations");
      case "inspiration": return say("mcpReadInspiration");
      case "signals": return say("mcpReadPatterns");
      case "top_of_mind": return say("mcpReadOnYourMind");
      case "profiles": return say("mcpReadProfile");
      case "other": return say("mcpReadOther");
    }
  };
  const keyName = (read: ApiMcpRead) => read.key.label || read.key.prefix || say("mcpReadKeyUnnamed");
  return (
    <section className="waka-mcp-reads" aria-labelledby="waka-mcp-reads-title">
      <h3 id="waka-mcp-reads-title" className="waka-settings-heading">{say("mcpReadsTitle")}</h3>
      {failed ? <p className="waka-settings-note" role="alert">{say("mcpReadsFailed")}</p>
        : reads === null ? <p className="waka-settings-note" role="status">{say("mcpReadsLoading")}</p>
        : reads.length === 0 ? <p className="waka-settings-note">{say("mcpReadsNone")}</p>
        : <ul className="waka-session-list">
          {reads.slice(0, SHOWN).map(read => <li key={read.id} className="waka-session-card">
            <span className="waka-session-text">
              <span className="waka-session-name">{what(read)}</span>
              <span className="waka-session-meta">
                {dateWords(Date.parse(read.readAt), Date.now(), locale)} · {keyName(read)}{read.key.revoked ? ` · ${say("mcpReadKeyRevoked")}` : ""}
              </span>
            </span>
          </li>)}
        </ul>}
    </section>
  );
}
