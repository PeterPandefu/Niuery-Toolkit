import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('desktop public assets omit optional OCR but preserve unrelated assets', async () => {
  const { prepareDesktopPublic } = await import('./desktop-build.mjs');
  const root = await mkdtemp(path.join(os.tmpdir(), 'niuery-desktop-test-'));
  let output;
  try {
    await mkdir(path.join(root, 'public/ocr'), { recursive: true });
    await writeFile(path.join(root, 'public/ocr/model.gz'), 'big model');
    await writeFile(path.join(root, 'public/icon.png'), 'icon');
    output = await prepareDesktopPublic(root);
    assert.deepEqual(await readdir(output), ['icon.png']);
    assert.deepEqual(await readdir(path.join(root, 'public/ocr')), ['model.gz']);
  } finally { if (output) await rm(output, { recursive: true, force: true }); await rm(root, { recursive: true, force: true }); }
});
