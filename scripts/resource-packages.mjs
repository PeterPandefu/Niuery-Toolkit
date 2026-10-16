import { createHash } from 'node:crypto';
import { readdir, readFile, lstat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const safe = value => typeof value === 'string' && /^[a-zA-Z0-9._/-]+$/.test(value) && !value.startsWith('/') && !value.split('/').some(p => !p || p === '..' || p === '.');

export async function packageResource({ id, version, platform = 'any', entry, source, output, include = () => true, licenses = [] }) {
  if (!/^[a-z0-9-]+$/.test(id) || !/^[a-zA-Z0-9.-]+$/.test(version) || !safe(entry)) throw new Error('Unsafe resource identity or entry');
  const zip = new JSZip();
  const files = [];
  async function visit(directory, prefix = '') {
    for (const name of (await readdir(directory)).sort()) {
      const relative = prefix + name;
      if (!safe(relative) || !include(relative)) continue;
      const absolute = path.join(directory, name);
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) throw new Error(`Symbolic link not allowed: ${relative}`);
      if (stat.isDirectory()) await visit(absolute, `${relative}/`);
      else if (stat.isFile()) {
        const bytes = await readFile(absolute);
        zip.file(relative, bytes, { date: new Date('2026-01-01T00:00:00Z'), createFolders: false });
        files.push({ path: relative, bytes: bytes.length, sha256: digest(bytes) });
      }
    }
  }
  await visit(source);
  for (const license of licenses) {
    if (!safe(license.path) || files.some(f => f.path === license.path)) throw new Error('Unsafe or duplicate license path');
    const bytes = await readFile(license.source);
    zip.file(license.path, bytes, { date: new Date('2026-01-01T00:00:00Z'), createFolders: false });
    files.push({ path: license.path, bytes: bytes.length, sha256: digest(bytes) });
  }
  if (!files.some(f => f.path === entry)) throw new Error(`Missing entry: ${entry}`);
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 }, platform: 'DOS' });
  await mkdir(output, { recursive: true });
  const archive = `${id}-${version}-${platform}.zip`;
  await writeFile(path.join(output, archive), bytes);
  return { id, version, platform, archive, entry, sha256: digest(bytes), downloadBytes: bytes.length, installedBytes: files.reduce((sum, f) => sum + f.bytes, 0), files };
}

export async function buildPackages({ repo = root, output = path.join(repo, 'resource-packages'), releaseBase = 'https://github.com/PeterPandefu/Niuery-Toolkit/releases/download/resources-v1' } = {}) {
  const native = path.join(repo, 'src-tauri/resources');
  const ocrLicenses = [
    { path: 'licenses/tesseract.js-APACHE-2.0.txt', source: path.join(repo, 'node_modules/tesseract.js/LICENSE.md') },
    { path: 'licenses/tesseract.js-core-APACHE-2.0.txt', source: path.join(repo, 'node_modules/tesseract.js-core/LICENSE') },
  ];
  const definitions = [
    { id: 'chromium', version: '1234', platform: 'windows-x86_64', source: path.join(native, 'chromium/win-x64'), entry: 'chrome-headless-shell.exe', include: f => !f.endsWith('.log') && f !== '.revision' },
    { id: 'ffmpeg', version: '20260802', platform: 'windows-x86_64', source: native, entry: 'ffmpeg.exe', include: f => !f.includes('/') && (/\.(dll|exe)$/.test(f) || ['LICENSE.txt', 'THIRD_PARTY_NOTICES.md'].includes(f)) },
    { id: 'java', version: '17.0.20', platform: 'windows-x86_64', source: process.env.NIUERY_JAVA_PACK_SOURCE || path.join(native, 'plantuml/jre'), entry: 'bin/java.exe', include: f => !f.endsWith('.jsa') && !f.endsWith('.lib') },
    { id: 'plantuml', version: '1.2026.6', source: path.join(native, 'plantuml'), entry: 'plantuml.jar', include: f => !f.startsWith('jre') },
    { id: 'ocr-engine', version: '7.0.0', source: path.join(repo, 'public/ocr'), entry: 'worker.min.js', include: f => !f.startsWith('lang'), licenses: ocrLicenses },
    { id: 'ocr-chi-sim', version: '1', source: path.join(repo, 'public/ocr/lang'), entry: 'chi_sim.traineddata.gz', include: f => f === 'chi_sim.traineddata.gz', licenses: ocrLicenses },
    { id: 'ocr-eng', version: '1', source: path.join(repo, 'public/ocr/lang'), entry: 'eng.traineddata.gz', include: f => f === 'eng.traineddata.gz', licenses: ocrLicenses },
  ];
  const resources = [];
  for (const definition of definitions) {
    console.log(`Packaging ${definition.id}…`);
    resources.push(await packageResource({ ...definition, output }));
  }
  const catalog = { schemaVersion: 1, releaseBase, resources };
  await writeFile(path.join(output, 'resource-catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
  await writeFile(path.join(repo, 'src-tauri/resource-catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
  console.log('Generated pinned catalog and local packages; nothing was uploaded.');
  return catalog;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildPackages();
