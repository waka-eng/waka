import { formatMessage, type SupportedLocale } from './locales';
import distribution from './mcp-distribution.json';

export type McpClient = 'claude' | 'codex';
export type McpScope = 'user' | 'launch' | 'project';
export type McpAuthMethod = 'browser' | 'key';
export const mcpClientName = (client: McpClient) => client === 'codex' ? 'Codex' : 'Claude Code';
const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
export const mcpPackageUrl = (origin: string) => new URL(`/downloads/${distribution.filename}`, origin).href;

type SetupTarget = {
  profile: { id: string; name: string; type?: 'human' | 'agent' }; apiUrl: string; client: McpClient; scope: McpScope;
  packageOrigin?: string;
};

/** A setup request, not a credential. Names remain quoted data and keys are never included. */
export function mcpSetupPrompt(options: SetupTarget & { locale: SupportedLocale; authMethod: McpAuthMethod }): string {
  const { profile, apiUrl, client, scope, locale, authMethod, packageOrigin = apiUrl } = options;
  const packageUrl = mcpPackageUrl(packageOrigin);
  const args = ['--yes', '--package', packageUrl];
  const details = JSON.stringify({
    packageUrl, packageVersion: distribution.version, minimumNodeVersion: 20,
    apiUrl, profileId: profile.id, profileName: profile.name, serverName: `waka-${profile.id}`,
    ...(profile.type ? { profileType: profile.type } : {}),
    client: mcpClientName(client),
    scope: scope === 'project' ? 'current project only' : client === 'codex' && scope === 'launch' ? 'one Codex CLI launch only' : 'user configuration across sessions',
    persistConfiguration: client !== 'codex' || scope !== 'launch',
    deviceLabel: `${mcpClientName(client)} · ${profile.name}`,
    server: { command: 'npx', args: [...args, 'waka-mcp'] },
    ...(authMethod === 'browser' ? { login: { command: 'npx', args: [...args, 'waka-login', apiUrl,
      '--profile', profile.id, '--device', `${mcpClientName(client)} · ${profile.name}`] } } : {}),
  }, null, 2);
  const auth = formatMessage(locale, authMethod === 'key'
    ? profile.type === 'human' ? 'profileMcpPromptPersonalKeyAuth' : 'profileMcpPromptKeyAuth'
    : 'profileMcpPromptBrowserAuth', {
    home: `~/.waka/profiles/${encodeURIComponent(profile.id)}`,
  });
  return formatMessage(locale, 'profileMcpSetupPrompt', { client: mcpClientName(client), details, auth });
}

/** Display-only shell commands. Credentials and the server name stay profile-bound. */
export function mcpSetupCommands(options: SetupTarget & { installed: boolean; scope: Exclude<McpScope, 'project'> }): string[] {
  const { profile, apiUrl, installed, client, scope, packageOrigin = apiUrl } = options;
  const name = `waka-${profile.id}`;
  const profileHome = `"$HOME/.waka/profiles/${encodeURIComponent(profile.id)}"`;
  const env = `WAKA_HOME=${profileHome} WAKA_PROFILE_ID=${quote(profile.id)} WAKA_API_KEY=''`;
  const runner = `npx --yes --package ${quote(mcpPackageUrl(packageOrigin))}`;
  const server = `${env} ${runner} waka-mcp`;
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
    `${runner} waka-mcp --version`,
    `${env} ${runner} waka-login ${quote(apiUrl)} --profile ${quote(profile.id)} --device ${quote(`${mcpClientName(client)} · ${profile.name}`)}`,
    register,
  ];
}

export function mcpKeyConfig(client: McpClient, profileId: string, apiUrl: string, packageOrigin = apiUrl): string {
  const name = `waka-${profileId}`;
  const env = { WAKA_API_URL: apiUrl, WAKA_PROFILE_ID: profileId, WAKA_API_KEY: 'YOUR_API_KEY' };
  const server = { command: 'npx', args: ['--yes', '--package', mcpPackageUrl(packageOrigin), 'waka-mcp'], env };
  if (client === 'claude') return JSON.stringify({ mcpServers: { [name]: server } }, null, 2);
  return `[mcp_servers.${JSON.stringify(name)}]\ncommand = "npx"\nargs = ${JSON.stringify(server.args)}\n\n[mcp_servers.${JSON.stringify(name)}.env]\n${Object.entries(env).map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join('\n')}`;
}
