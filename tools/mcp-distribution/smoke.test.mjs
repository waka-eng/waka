/** Public installation proof: only a downloaded archive, a fresh npm cache and synthetic API data. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { inspectDistribution } from './check.mjs';

test('a public user can install and use the packaged MCP client without repository access', { timeout: 60_000 }, async t => {
  const { manifest, archive } = inspectDistribution();
  const directory = await mkdtemp(join(tmpdir(), 'waka-public-install-'));
  const profile = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Public install fixture', type: 'agent' };
  const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ path: request.url, authorization: request.headers.authorization, cookie: request.headers.cookie });
    if (request.url === `/downloads/${manifest.filename}`) {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end(archive); return;
    }
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/auth/me') response.end(JSON.stringify({ profile }));
    else if (request.url === '/api/auth/cli/verify') response.end(JSON.stringify({ profile, verifiedAt: new Date().toISOString() }));
    else response.writeHead(404).end(JSON.stringify({ error: 'Not a WAKA endpoint' }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  await writeFile(join(directory, 'user.npmrc'), '');
  await writeFile(join(directory, 'global.npmrc'), '');
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !/(TOKEN|SECRET|PASSWORD|KEY|^WAKA_|^npm_|^NPM_|^NODE_OPTIONS$|^NODE_PATH$|^TSX_|^PNPM_)/i.test(key))),
    npm_config_cache: join(directory, 'npm-cache'),
    npm_config_userconfig: join(directory, 'user.npmrc'),
    npm_config_globalconfig: join(directory, 'global.npmrc'),
    npm_config_registry: `${origin}/unused-registry/`,
    npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false',
    WAKA_HOME: join(directory, 'profile'), WAKA_PROFILE_ID: profile.id,
    WAKA_API_URL: origin, WAKA_API_KEY: 'waka_agent_synthetic_public_install_fixture',
  };
  const processes = new Set();
  function start(command, args = []) {
    const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
      'exec', '--yes', '--package', `${origin}/downloads/${manifest.filename}`, '--', command, ...args,
    ], { cwd: directory, env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    processes.add(child);
    child.on('exit', () => processes.delete(child));
    return child;
  }
  async function run(command, args) {
    const child = start(command, args), output = [], errors = [];
    child.stdout.on('data', data => output.push(data));
    child.stderr.on('data', data => errors.push(data));
    const [code] = await once(child, 'close');
    return { code, stdout: Buffer.concat(output).toString(), stderr: Buffer.concat(errors).toString() };
  }

  try {
    await t.test('installs anonymously and runs the version check', async () => {
      const result = await run('waka-mcp', ['--version']);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, new RegExp(manifest.version.replaceAll('.', '\\.')));
      assert.ok(requests.some(request => request.path === `/downloads/${manifest.filename}`));
    });
    await t.test('includes the login CLI without a checkout or a build', async () => {
      const help = await run('waka-login', ['--help']);
      assert.equal(help.code, 0, help.stderr);
      assert.match(help.stdout, /--profile <profile-id>/);
      // Load the entire login bundle, but reject a non-WAKA URL before it can open a browser.
      const rejected = await run('waka-login', [`${origin}/not-waka`, '--profile', profile.id, '--device', 'Public fixture']);
      assert.notEqual(rejected.code, 0);
      assert.match(rejected.stderr, /waka-login failed/);
    });
    await t.test('speaks MCP, verifies the bound agent and refuses another profile', async () => {
      const child = start('waka-mcp'), pending = new Map(), errors = [];
      child.stderr.on('data', data => errors.push(data));
      const lines = createInterface({ input: child.stdout });
      lines.on('line', line => {
        const message = JSON.parse(line);
        if (message.id !== undefined) {
          pending.get(message.id)?.(message);
        }
      });
      let id = 0;
      async function rpc(method, params) {
        const requestId = ++id;
        const result = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error(`MCP ${method} timed out: ${Buffer.concat(errors)}`)), 15_000);
          pending.set(requestId, message => { clearTimeout(timeout); pending.delete(requestId); resolve(message); });
        });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n');
        const response = await result;
        assert.ok(!response.error, JSON.stringify(response.error));
        return response.result;
      }
      await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'anonymous-install-fixture', version: '1.0' } });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      const tools = await rpc('tools/list', {});
      assert.ok(tools.tools.some(tool => tool.name === 'waka_verify_connection'));
      const verified = await rpc('tools/call', { name: 'waka_verify_connection', arguments: { profileId: profile.id } });
      assert.ok(!verified.isError, JSON.stringify(verified));
      assert.equal(JSON.parse(verified.content[0].text).profile.id, profile.id);
      const callsBefore = requests.length;
      const refused = await rpc('tools/call', { name: 'waka_list_inspirations', arguments: { profileId: otherId } });
      assert.equal(refused.isError, true);
      assert.match(refused.content[0].text, /configured profile/);
      assert.equal(requests.length, callsBefore, 'Cross-profile reads must stop before a network request.');
      lines.close();
    });
    for (const request of requests.filter(request => request.path.startsWith('/downloads/'))) {
      assert.equal(request.authorization, undefined, 'Downloads must not require a GitHub or npm credential.');
      assert.equal(request.cookie, undefined);
    }
    assert.ok(!requests.some(request => request.path.startsWith('/unused-registry/')), 'The client must be self-contained.');
  } finally {
    for (const child of processes) {
      try {
        if (process.platform === 'win32') child.kill(); else process.kill(-child.pid, 'SIGTERM');
      } catch { /* already exited */ }
    }
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
