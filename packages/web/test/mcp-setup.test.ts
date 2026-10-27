/** WHAT THIS MOCKS, AND WHY (gate G6): nothing in the application. A temporary
 * codex executable records argv so generated commands can be shell-checked
 * without registering a server, writing configuration, or starting a client. */
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { mcpKeyConfig, mcpSetupCommands } from '../src/lib/mcp-setup';

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
    expect(args).toEqual([`WAKA_HOME=${process.env.HOME}/.waka/profiles/agent-noah`, 'WAKA_PROFILE_ID=agent-noah', 'WAKA_API_KEY=', 'node', `${realpathSync(dir)}/dist/src/server.js`]);
    expect(command).not.toContain('mcp add');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it('labels the login for its client and keeps persistent registration explicit', () => {
  const commands = mcpSetupCommands({ ...options, scope: 'user' });
  expect(commands[0]).toContain('--branch dev');
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
