export type McpClient = 'claude' | 'codex';
export type McpScope = 'user' | 'launch';
export const mcpClientName = (client: McpClient) => client === 'codex' ? 'Codex' : 'Claude Code';
const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";

/** Display-only shell commands. Credentials and the server name stay profile-bound. */
export function mcpSetupCommands(options: {
  profile: { id: string; name: string }; apiUrl: string; installed: boolean;
  client: McpClient; scope: McpScope;
}): string[] {
  const { profile, apiUrl, installed, client, scope } = options;
  const name = `waka-${profile.id}`;
  const profileHome = `"$HOME/.waka/profiles/${encodeURIComponent(profile.id)}"`;
  const env = `WAKA_HOME=${profileHome} WAKA_PROFILE_ID=${quote(profile.id)} WAKA_API_KEY=''`;
  const branch = ['localhost', '127.0.0.1', '[::1]', 'dev.waka.im'].includes(new URL(apiUrl).hostname) ? 'dev' : 'main';
  const server = `${env} node "$PWD/dist/src/server.js"`;
  let register: string;
  if (client === 'codex' && scope === 'launch') {
    // JSON arrays of strings are also TOML arrays. Node escapes the actual path
    // (including spaces, quotes and backslashes) before the shell passes one -c value.
    const key = `mcp_servers.${JSON.stringify(name)}`;
    register = `codex -c ${quote(`${key}.command="env"`)} \\\n  -c ${quote(`${key}.args=`)}"$(node -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' ${server})"`;
  } else if (client === 'codex') {
    register = `codex mcp add ${quote(name)} -- env ${server}`;
  } else {
    register = `${installed ? `claude mcp remove --scope user ${quote(name)} 2>/dev/null || true\n` : ''}claude mcp add --scope user ${quote(name)} -- env ${server}`;
  }
  return [
    `git clone --branch ${branch} https://github.com/waka-eng/waka-mcp.git\ncd waka-mcp\npnpm install`,
    `${installed ? 'git pull --ff-only\npnpm install\n' : ''}pnpm run build\nWAKA_HOME=${profileHome} WAKA_PROFILE_ID=${quote(profile.id)} pnpm run login -- ${quote(apiUrl)} --profile ${quote(profile.id)} --device ${quote(`${mcpClientName(client)} · ${profile.name}`)}`,
    register,
  ];
}

export function mcpKeyConfig(client: McpClient, profileId: string, apiUrl: string): string {
  const name = `waka-${profileId}`;
  const env = { WAKA_API_URL: apiUrl, WAKA_PROFILE_ID: profileId, WAKA_API_KEY: 'YOUR_API_KEY' };
  const server = { command: 'node', args: ['/absolute/path/to/waka-mcp/dist/src/server.js'], env };
  if (client === 'claude') return JSON.stringify({ mcpServers: { [name]: server } }, null, 2);
  return `[mcp_servers.${JSON.stringify(name)}]\ncommand = "node"\nargs = ${JSON.stringify(server.args)}\n\n[mcp_servers.${JSON.stringify(name)}.env]\n${Object.entries(env).map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join('\n')}`;
}
