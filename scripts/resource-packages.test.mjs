import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

test('packages a pinned resource with portable paths, actual sizes and a reproducible digest', async () => {
  const { packageResource } = await import('./resource-packages.mjs');
  const root = await mkdtemp(path.join(os.tmpdir(), 'niuery-packs-test-'));
  try {
    await mkdir(path.join(root, 'input', 'bin'), { recursive: true });
    await writeFile(path.join(root, 'input', 'bin', 'java.exe'), 'runtime');
    const pack = await packageResource({ id: 'java', version: 'test-1', platform: 'windows-x86_64', entry: 'bin/java.exe', source: path.join(root, 'input'), output: path.join(root, 'output') });
    const bytes = await readFile(path.join(root, 'output', pack.archive));
    assert.equal(pack.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(pack.downloadBytes, bytes.length);
    assert.equal(pack.installedBytes, 7);
    assert.deepEqual(pack.files.map(f => f.path), ['bin/java.exe']);
    assert.equal(pack.files[0].sha256, createHash('sha256').update('runtime').digest('hex'));
    const again = await packageResource({ id: 'java', version: 'test-1', platform: 'windows-x86_64', entry: 'bin/java.exe', source: path.join(root, 'input'), output: path.join(root, 'output') });
    assert.equal(again.sha256, pack.sha256);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('rejects missing entry points and symbolic links rather than publishing incomplete packs', async () => {
  const { packageResource } = await import('./resource-packages.mjs');
  const root = await mkdtemp(path.join(os.tmpdir(), 'niuery-packs-test-'));
  try {
    await assert.rejects(packageResource({ id: 'bad', version: '1', entry: '../escape', source: root, output: path.join(root, 'out') }));
    await assert.rejects(packageResource({ id: 'java', version: '1', entry: 'bin/java.exe', source: root, output: path.join(root, 'out') }), /entry/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('includes third-party license files in independently distributed packs', async () => {
  const { packageResource } = await import('./resource-packages.mjs');
  const root = await mkdtemp(path.join(os.tmpdir(), 'niuery-license-test-'));
  try {
    await mkdir(path.join(root, 'input'));
    await writeFile(path.join(root, 'input', 'worker.js'), 'worker');
    await writeFile(path.join(root, 'LICENSE.txt'), 'upstream terms');
    const pack = await packageResource({ id: 'ocr-engine', version: '1', entry: 'worker.js', source: path.join(root, 'input'), output: path.join(root, 'out'), licenses: [{ path: 'licenses/upstream.txt', source: path.join(root, 'LICENSE.txt') }] });
    assert.ok(pack.files.some(file => file.path === 'licenses/upstream.txt' && file.bytes === 14));
  } finally { await rm(root, { recursive: true, force: true }); }
});
