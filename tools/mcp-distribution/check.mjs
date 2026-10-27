import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Small tar reader for the package's explicit, flat file allowlist. */
export function inspectDistribution() {
  const manifest = JSON.parse(readFileSync(join(root, 'packages/web/src/lib/mcp-distribution.json'), 'utf8'));
  assert.match(manifest.filename, /^waka-mcp-[a-zA-Z0-9.-]+\.tgz$/);
  const archive = readFileSync(join(root, 'packages/web/public/downloads', manifest.filename));
  assert.equal(createHash('sha256').update(archive).digest('hex'), manifest.sha256);
  const tar = gunzipSync(archive), files = new Map();
  const field = (start, size) => tar.subarray(start, start + size).toString('utf8').replace(/\0.*$/s, '');
  for (let offset = 0; offset + 512 <= tar.length && tar[offset];) {
    const name = field(offset, 100);
    const size = Number.parseInt(field(offset + 124, 12).trim() || '0', 8);
    assert.ok(Number.isFinite(size) && size >= 0);
    assert.ok(['0', ''].includes(field(offset + 156, 1)), `Unexpected archive entry: ${name}`);
    files.set(name, tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.deepEqual([...files.keys()].sort(), [
    'package/package.json', 'package/README.md', 'package/THIRD_PARTY_NOTICES.txt',
    'package/server.mjs', 'package/login.mjs', 'package/bin/waka-mcp.mjs', 'package/bin/waka-login.mjs',
  ].sort());
  const pkg = JSON.parse(files.get('package/package.json').toString());
  assert.equal(pkg.version, manifest.version);
  assert.equal(pkg.engines.node, '>=20');
  assert.deepEqual(pkg.bin, { 'waka-mcp': 'bin/waka-mcp.mjs', 'waka-login': 'bin/waka-login.mjs' });
  assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0, 'Public installation must not fetch private dependencies.');
  assert.equal(Object.keys(pkg.scripts ?? {}).length, 0, 'Public installation must not build or run lifecycle scripts.');
  for (const name of ['package/server.mjs', 'package/login.mjs']) {
    assert.ok(!files.get(name).includes(Buffer.from('sourceMappingURL=')));
    assert.ok(!files.get(name).includes(Buffer.from('/Users/')));
  }
  assert.ok(files.get('package/THIRD_PARTY_NOTICES.txt').length > 0);
  return { manifest, archive, files };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { manifest, archive } = inspectDistribution();
  console.log(`Public MCP package checked: ${manifest.version}, ${archive.length} bytes.`);
}
