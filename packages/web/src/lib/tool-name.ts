/**
 * THE APP A PICK CAME FROM, AS A PERSON CALLS IT.
 *
 * Founder, 2026-10-15, of "Picked from your work · Today": "lets say sth
 * like 'Inferred from your [claude/gpt/etc] MCP [date]'." The collector
 * names itself in the MCP handshake — `claude-code`, `claude-ai`, `cursor`
 * — which is a client id, not a name. This is the one place that turns one
 * into the other; anything it does not know is shown as given, capitalised.
 */
const KNOWN: Array<[RegExp, string]> = [
  [/claude/i, "Claude"],
  [/codex/i, "Codex"],
  [/chatgpt|openai|\bgpt/i, "ChatGPT"],
  [/cursor/i, "Cursor"],
  [/gemini/i, "Gemini"],
  [/windsurf/i, "Windsurf"],
  [/copilot|vscode|visual studio/i, "VS Code"],
];

export function toolName(tool: string | null | undefined): string | null {
  const raw = tool?.trim();
  if (!raw) return null;
  for (const [match, name] of KNOWN) if (match.test(raw)) return name;
  const word = raw.split(/[-_\s]+/)[0]!;
  return word.charAt(0).toUpperCase() + word.slice(1);
}
