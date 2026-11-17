// Prepares the office resource pack source tree (Node runtime + Qoder office
// MCP engines + xlsx sidecar + licenses), then smoke-tests the exact layout.
// Usage: node scripts/prepare-office.mjs [--source <marketplace-cache>] [--node <node.exe>] [--skip-smoke]
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const source = flag('--source') ?? path.join(os.homedir(), '.qoder-cn/plugins/cache/qoder-marketplace');
const localNode = flag('--node');
const output = path.join(root, 'src-tauri/resources/office');

const PLUGINS = [
  // docxHeadless.cjs imports jsdom as a bare package, so its node_modules must ship.
  { dir: 'office-docx', target: 'docx', skip: ['dependencies.json', 'sourceManifest.json'] },
  { dir: 'office-excel', target: 'excel', skip: [] },
  { dir: 'Presentations', target: 'pptx', skip: [] },
];

async function latestVersion(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const versions = entries.filter(e => e.isDirectory()).map(e => e.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!versions.length) throw new Error(`No version directory under ${directory}`);
  return versions[versions.length - 1];
}

async function copyTree(from, to, skip = []) {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (skip.includes(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symbolic link not allowed: ${src}`);
    if (entry.isDirectory()) await copyTree(src, dst);
    else if (entry.isFile()) await cp(src, dst);
  }
}

async function resolveNode() {
  if (localNode) {
    const info = await stat(localNode);
    if (!info.isFile()) throw new Error(`--node is not a file: ${localNode}`);
    await cp(localNode, path.join(output, 'node.exe'));
    console.log(`node.exe copied from ${localNode}`);
    return;
  }
  console.log('Resolving latest Node 22 LTS…');
  const index = await (await fetch('https://nodejs.org/dist/index.json')).json();
  const release = index.find(entry => entry.version.startsWith('v22.'));
  if (!release) throw new Error('No Node 22 release found');
  const url = `https://nodejs.org/dist/${release.version}/node-${release.version}-win-x64.zip`;
  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Node download failed: ${response.status}`);
  const zip = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()));
  const prefix = `node-${release.version}-win-x64/`;
  const exe = zip.file(`${prefix}node.exe`);
  const license = zip.file(`${prefix}LICENSE`);
  if (!exe || !license) throw new Error('Node archive is missing node.exe or LICENSE');
  await writeFile(path.join(output, 'node.exe'), await exe.async('nodebuffer'));
  await mkdir(path.join(output, 'licenses'), { recursive: true });
  await writeFile(path.join(output, 'licenses/node-LICENSE.txt'), await license.async('nodebuffer'));
  console.log(`node.exe ${release.version} extracted`);
}

function handshake(nodeExe, script, env, expectedTools) {
  return new Promise((resolve, reject) => {
    const child = spawn(nodeExe, [script], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    let buf = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`timeout: ${script}`)); }, 60000);
    const send = obj => child.stdin.write(JSON.stringify(obj) + '\n');
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.stdout.on('data', chunk => {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 1) {
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
        } else if (msg.id === 2) {
          clearTimeout(timer);
          const count = (msg.result?.tools ?? []).length;
          child.kill();
          if (count !== expectedTools) reject(new Error(`${script}: expected ${expectedTools} tools, got ${count}`));
          else resolve(count);
        }
      }
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'prepare-office', version: '1.0.0' } } });
  });
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const plugin of PLUGINS) {
  const version = await latestVersion(path.join(source, plugin.dir));
  const from = path.join(source, plugin.dir, version, 'runtime');
  await copyTree(from, path.join(output, plugin.target), plugin.skip);
  console.log(`${plugin.target}: copied ${plugin.dir}@${version}`);
}
const sidecarSource = flag('--sidecar') ?? path.join(os.homedir(), '.qoder-cn/bin/qoder-office-xlsx');
await copyTree(sidecarSource, path.join(output, 'bin/qoder-office-xlsx'));
console.log('bin/qoder-office-xlsx: sidecar copied');
await resolveNode();

if (!args.includes('--skip-smoke')) {
  const nodeExe = path.join(output, 'node.exe');
  const expectations = [['docx', 9], ['excel', 15], ['pptx', 11]];
  for (const [name, count] of expectations) {
    const env = name === 'excel' ? { QODER_HOME: output } : {};
    const tools = await handshake(nodeExe, path.join(output, name, 'server.cjs'), env, count);
    console.log(`smoke ${name}: ${tools} tools OK`);
  }
}
console.log(`Office pack source ready: ${output}`);