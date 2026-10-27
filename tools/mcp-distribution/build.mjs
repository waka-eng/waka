/** Maintainer-only packaging. Public clients install the bundled artifact, never this checkout. */
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = resolve(process.argv[2] ?? join(root, '../waka-mcp'));
const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) throw new Error('Commit MCP client changes before packaging a release.');
const sourceCommit = git('rev-parse', 'HEAD');
execFileSync('pnpm', ['--ignore-workspace', 'audit', '--prod', '--audit-level=low'], { cwd: source, stdio: 'inherit' });
const sourcePackage = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
const version = `${sourcePackage.version}-client.${sourceCommit.slice(0, 12)}`;
const staging = await mkdtemp(join(tmpdir(), 'waka-mcp-package-'));
const packageDir = join(staging, 'package');

try {
  await mkdir(join(packageDir, 'bin'), { recursive: true });
  const bundles = await Promise.all(['server', 'login'].map(name => build({
    absWorkingDir: source,
    entryPoints: [name === 'server' ? 'src/server.ts' : 'bin/waka-login.ts'],
    outfile: join(packageDir, `${name}.mjs`),
    bundle: true, platform: 'node', target: 'node20', format: 'esm',
    minify: true, sourcemap: false, legalComments: 'eof', metafile: true,
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
    logLevel: 'warning',
  })));

  // Include complete dependency notices while keeping source files, paths,
  // tests, environment files and maintainer credentials out of the package.
  const notices = new Map();
  for (const result of bundles) {
    for (const input of Object.keys(result.metafile.inputs)) {
      let directory = dirname(resolve(source, input));
      while (directory !== dirname(directory)) {
        const file = join(directory, 'package.json');
        if (existsSync(file)) {
          const dependency = JSON.parse(readFileSync(file, 'utf8'));
          if (dependency.name && dependency.name !== sourcePackage.name) {
            const id = `${dependency.name}@${dependency.version}`;
            if (!notices.has(id)) {
              const licenseFiles = readdirSync(directory).filter(name => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name));
              if (!licenseFiles.length) throw new Error(`Missing bundled dependency notice: ${id}`);
              notices.set(id, `${id}\n${licenseFiles.map(name => readFileSync(join(directory, name), 'utf8')).join('\n')}`);
            }
            break;
          }
          if (dependency.name === sourcePackage.name) break;
        }
        directory = dirname(directory);
      }
    }
  }
  await writeFile(join(packageDir, 'THIRD_PARTY_NOTICES.txt'), [...notices].sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => text).join('\n\n--------------------\n\n'));
  const packageJson = {
    name: '@waka/mcp-client', version, private: true, type: 'module',
    description: 'Ready-to-run WAKA MCP client. No repository access or source build required.',
    engines: { node: '>=20' },
    bin: { 'waka-mcp': 'bin/waka-mcp.mjs', 'waka-login': 'bin/waka-login.mjs' },
    files: ['bin', 'server.mjs', 'login.mjs', 'README.md', 'THIRD_PARTY_NOTICES.txt'],
  };
  await writeFile(join(packageDir, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n');
  for (const [name, module, usage] of [
    ['waka-mcp', 'server', 'WAKA MCP server. Set WAKA_PROFILE_ID and either WAKA_HOME or WAKA_API_URL + WAKA_API_KEY.'],
    ['waka-login', 'login', 'Usage: waka-login <api-url> --profile <profile-id> --device <label>'],
  ]) {
    const file = join(packageDir, 'bin', `${name}.mjs`);
    await writeFile(file, `#!/usr/bin/env node\nconst option = process.argv[2];\nif (option === '--version') console.log(${JSON.stringify(`WAKA MCP ${version}`)});\nelse if (option === '--help' || option === '-h') console.log(${JSON.stringify(usage + '\nGet your profile-specific setup instructions in WAKA Settings → Agent profiles → your agent.')});\nelse await import('../${module}.mjs');\n`);
    await chmod(file, 0o755);
  }
  await writeFile(join(packageDir, 'README.md'), '# WAKA MCP client\n\nInstall from the package URL shown in WAKA Settings → Agent profiles → your agent. Node.js 20+ and npm are required. Git, pnpm, repository access and a local build are not required.\n\nUse `waka-login` for browser sign-in and `waka-mcp` as the MCP server executable. Each connection must pin WAKA_PROFILE_ID. Browser sign-ins also use a separate WAKA_HOME per profile. API key connections use WAKA_API_URL and WAKA_API_KEY.\n\nThis archive contains the bundled client and dependency notices, not the WAKA backend or a source checkout.\n');

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const [packed] = JSON.parse(execFileSync(npm, ['pack', '--json', '--ignore-scripts', '--pack-destination', staging], {
    cwd: packageDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }));
  const bytes = await readFile(join(staging, packed.filename));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const filename = `waka-mcp-${version}-${sha256.slice(0, 12)}.tgz`;
  const downloads = join(root, 'packages/web/public/downloads');
  await mkdir(downloads, { recursive: true });
  // Published names are immutable. Retain older archives for existing MCP entries.
  await copyFile(join(staging, packed.filename), join(downloads, filename));
  await writeFile(join(root, 'packages/web/src/lib/mcp-distribution.json'), JSON.stringify({ filename, version, sha256, sourceCommit }, null, 2) + '\n');
  console.log(`Built ${filename} (${bytes.length} bytes), ${notices.size} dependency notices; no runtime dependencies.`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
