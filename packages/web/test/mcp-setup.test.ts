/** WHAT THIS MOCKS, AND WHY (gate G6): nothing in the application. A temporary
 * codex executable records argv so generated commands can be shell-checked
 * without registering a server, writing configuration, or starting a client. */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { mcpKeyConfig, mcpSetupCommands, mcpSetupPrompt, mcpPackageUrl } from '../src/lib/mcp-setup';

const profile = { id: 'agent-noah', name: "Noah's $(touch nope)" };
const options = { profile, apiUrl: 'https://dev.waka.im', installed: false, client: 'codex' as const, scope: 'launch' as const };
it('starts one launch with literal, profile-bound arguments even from a path containing shell characters', () => {
  const dir = mkdtempSync(join(tmpdir(), 'waka "quote" $value '));
  try {
    writeFileSync(join(dir, 'codex'), '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)))', { mode: 0o700 });
    const command = mcpSetupCommands(options)[2]!;
    const argv = JSON.parse(execFileSync('/bin/sh', ['-c', command], { cwd: dir, env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: 'utf8' })) as string[];
    expect(argv).toHaveLength(4);
    expect(argv.slice(0, 3)).toEqual(['-c', 'mcp_servers."waka-agent-noah".command="env"', '-c']);
    const args = JSON.parse(argv[3]!.slice(argv[3]!.indexOf('=') + 1));
    expect(args).toEqual([`WAKA_HOME=${process.env.HOME}/.waka/profiles/agent-noah`, 'WAKA_PROFILE_ID=agent-noah', 'WAKA_API_KEY=', 'npx', '--yes', '--package', mcpPackageUrl(options.apiUrl), 'waka-mcp']);
    expect(command).not.toContain('mcp add');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it('labels the login for its client and keeps persistent registration explicit', () => {
  const commands = mcpSetupCommands({ ...options, scope: 'user' });
  expect(commands[0]).toContain(mcpPackageUrl(options.apiUrl));
  expect(commands[0]).toContain('waka-mcp --version');
  expect(commands.join('\n')).not.toMatch(/git clone|pnpm|dist\/src/);
  expect(commands[1]).toContain("--device 'Codex · Noah'\\''s $(touch nope)'");
  expect(commands[2]).toContain("codex mcp add 'waka-agent-noah' -- env");
  expect(mcpSetupCommands({ ...options, client: 'claude', installed: true })[2]).toContain('claude mcp add --scope user');
});
it('provides each client its native key configuration with the same profile and endpoint', () => {
  const json = JSON.parse(mcpKeyConfig('claude', profile.id, options.apiUrl));
  expect(json.mcpServers['waka-agent-noah'].env.WAKA_PROFILE_ID).toBe(profile.id);
  const toml = mcpKeyConfig('codex', profile.id, options.apiUrl);
  expect(toml).toContain('[mcp_servers."waka-agent-noah".env]');
  expect(toml).toContain('WAKA_PROFILE_ID = "agent-noah"');
  expect(toml).toContain('WAKA_API_KEY = "YOUR_API_KEY"');
});

it('pins the setup prompt to the requested client, launch scope, endpoint, and profile', () => {
  const prompt = mcpSetupPrompt({ ...options, locale: 'en-US', authMethod: 'browser' });
  const data = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(prompt)![1]!);
  expect(data).toMatchObject({
    packageUrl: mcpPackageUrl(options.apiUrl), minimumNodeVersion: 20, apiUrl: options.apiUrl,
    profileId: profile.id, profileName: profile.name, serverName: 'waka-agent-noah',
    client: 'Codex', scope: 'one Codex CLI launch only', persistConfiguration: false, deviceLabel: `Codex · ${profile.name}`,
  });
  expect(data.server).toEqual({ command: 'npx', args: ['--yes', '--package', mcpPackageUrl(options.apiUrl), 'waka-mcp'] });
  expect(data.login.args).toContain('waka-login');
  expect(prompt).not.toContain('https://github.com/waka-eng');
  expect(prompt).toContain('~/.waka/profiles/agent-noah');
  expect(prompt).toContain('waka_verify_connection');
  expect(prompt).toContain('Do not save, edit, or delete any memory');
});

it('provides a Korean key setup prompt without requesting a key in chat', () => {
  const prompt = mcpSetupPrompt({ ...options, apiUrl: 'https://waka.im', scope: 'user', locale: 'ko-KR', authMethod: 'key' });
  expect(prompt).toContain(mcpPackageUrl('https://waka.im'));
  expect(prompt).toContain('키를 채팅에 붙여 넣으라고 요청하거나 출력하지 마세요.');
  expect(prompt).toContain('"profileId": "agent-noah"');
  expect(prompt).toContain('WAKA_HOME');
  expect(prompt).toContain('/REPLACE_WITH_YOUR_HOME/.waka/production/key-only/profiles/agent-noah');
});

it('downloads from the public web origin when the API is hosted separately', () => {
  const apiUrl = 'https://api.example.test', packageOrigin = 'https://dev.waka.im';
  const commands = mcpSetupCommands({ ...options, apiUrl, packageOrigin });
  expect(commands[0]).toContain(mcpPackageUrl(packageOrigin));
  expect(commands[0]).not.toContain(apiUrl);
  expect(commands[1]).toContain(`waka-login '${apiUrl}'`);
  const config = JSON.parse(mcpKeyConfig('claude', profile.id, apiUrl, packageOrigin)).mcpServers['waka-agent-noah'];
  expect(config.command).toBe('npx');
  expect(config.args).toEqual(['--yes', '--package', mcpPackageUrl(packageOrigin), 'waka-mcp']);
  expect(config.env.WAKA_API_URL).toBe(apiUrl);
  expect(config.args.join(' ')).not.toContain('/absolute/path');
});

it('makes API-key installation project-scoped for both supported clients', () => {
  for(const client of ['codex','claude'] as const){
    const prompt=mcpSetupPrompt({...options,client,scope:'project',locale:'en-US',authMethod:'key'});
    expect(prompt).toContain('current project only');
    expect(prompt).not.toContain('user configuration across sessions');
    expect(mcpKeyConfig(client,profile.id,options.apiUrl)).toContain('YOUR_API_KEY');
  }
});

it('operational read-only setup names both backend capability and client mode without credentials',()=>{
  const prompt=mcpSetupPrompt({...options,locale:'en-US',authMethod:'key',memoryAccess:'read_only'});
  expect(prompt).toContain('read_only');expect(prompt).toContain('WAKA_MCP_MODE');
  const config=JSON.parse(mcpKeyConfig('claude',profile.id,options.apiUrl,options.apiUrl,'read_only'));
  expect(config.mcpServers[`waka-${profile.id}`].env.WAKA_MCP_MODE).toBe('read_only');
});

it('keeps production and development with the same profile in separate entries and credential homes', () => {
  const prod = { ...options, apiUrl: 'https://waka.im' };
  const commands = mcpSetupCommands(prod);
  expect(commands[1]).toContain('WAKA_HOME="$HOME/.waka/production/profiles/agent-noah"');
  expect(commands[2]).toContain('mcp_servers."waka-production-agent-noah"');
  expect(mcpSetupCommands(options)[1]).toContain('WAKA_HOME="$HOME/.waka/profiles/agent-noah"');
  for (const client of ['claude', 'codex'] as const) {
    const config = mcpKeyConfig(client, profile.id, prod.apiUrl);
    expect(config).toContain('waka-production-agent-noah');
    expect(config).toContain('/REPLACE_WITH_YOUR_HOME/.waka/production/key-only/profiles/agent-noah');
    expect(config).not.toContain('$HOME');
    expect(mcpKeyConfig(client, profile.id, options.apiUrl)).not.toContain('key-only');
  }
  for (const authMethod of ['browser', 'key'] as const) {
    const prompt = mcpSetupPrompt({ ...prod, locale: 'en-US', authMethod, memoryAccess: 'read_only' });
    const data = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(prompt)![1]!);
    const home = `/REPLACE_WITH_YOUR_HOME/.waka/production/${authMethod === 'key' ? 'key-only/' : ''}profiles/agent-noah`;
    expect(data.serverName).toBe('waka-production-agent-noah');
    expect(data.serverEnvironment).toEqual({ WAKA_HOME: home, WAKA_MCP_MODE: 'read_only' });
    if (authMethod === 'browser') expect(data.login.env).toEqual({ WAKA_HOME: home });
    else expect(data.login).toBeUndefined();
    expect(prompt).toContain('Preserve existing MCP entries and credential files');
  }
});

it('chooses the production namespace by parsed API origin, never the archive origin or a lookalike host', () => {
  const parse = (apiUrl: string, packageOrigin: string) => JSON.parse(mcpKeyConfig('claude', profile.id, apiUrl, packageOrigin)).mcpServers;
  expect(Object.keys(parse('https://waka.im/', 'https://dev.waka.im'))).toEqual(['waka-production-agent-noah']);
  for (const apiUrl of ['https://dev.waka.im', 'https://api.example.test', 'https://waka.im.example.test', 'http://waka.im']) {
    const servers = parse(apiUrl, 'https://waka.im');
    expect(Object.keys(servers)).toEqual(['waka-agent-noah']);
    expect(servers['waka-agent-noah'].env.WAKA_HOME).toBeUndefined();
  }
});
