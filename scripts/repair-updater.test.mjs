import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { load as loadYaml } from 'js-yaml';

async function runRepair({ wrongKey = false, wrongDigest = false, wrongSignature = false, existingManifest = false, existingSignature = false } = {}) {
  const workflow = loadYaml(await readFile(new URL('../.github/workflows/repair-updater.yml', import.meta.url), 'utf8').catch(() => 'jobs: { repair: { steps: [] } }'));
  const steps = workflow.jobs.repair.steps;
  assert.ok(steps.some((step) => step.id === 'prepare'), 'Repair must download and verify the existing installer');
  assert.ok(steps.some((step) => step.id === 'upload'), 'Repair must upload the signed update metadata');
  const installerBytes = Buffer.from('original published installer bytes');
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const keyId = Buffer.from('0102030405060708', 'hex');
  const key = Buffer.concat([Buffer.from('Ed'), keyId, publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)]);
  const config = { plugins: { updater: { pubkey: Buffer.from(`untrusted comment: fixture\n${key.toString('base64')}\n`).toString('base64') } } };
  const rawSignature = Buffer.concat([Buffer.from('ED'), keyId, sign(null, createHash('blake2b512').update(installerBytes).digest(), privateKey)]);
  if (wrongKey) rawSignature[2] ^= 0xff;
  if (wrongSignature) rawSignature[10] ^= 0xff;
  const signature = Buffer.from(`untrusted comment: fixture\n${rawSignature.toString('base64')}\ntrusted comment: fixture\n`).toString('base64');
  const installerName = 'Niuery.Toolkit_1.2.1_x64-setup.exe';
  const installer = { id: 12, name: installerName, state: 'uploaded', digest: `sha256:${wrongDigest ? 'wrong' : createHash('sha256').update(installerBytes).digest('hex')}`, browser_download_url: `https://github.com/PeterPandefu/Niuery-Toolkit/releases/download/v1.2.1/${installerName}` };
  const release = { id: 123, tag_name: 'v1.2.1', draft: false, prerelease: false, published_at: '2026-10-19T01:09:50Z', body: '### 修复\n\n- 用户说明', assets: [installer, ...(existingManifest ? [{ id: 13, name: 'latest.json' }] : []), ...(existingSignature ? [{ id: 14, name: `${installerName}.sig` }] : [])] };
  const uploads = [];
  const files = new Map([['src-tauri/tauri.conf.json', JSON.stringify(config)]]);
  const env = { RELEASE_TAG: 'v1.2.1', RUNNER_TEMP: 'repair-fixture' };
  const nativeRequire = createRequire(import.meta.url);
  const require = (name) => name === 'node:fs/promises' ? {
    mkdir: async () => {},
    writeFile: async (path, bytes) => files.set(path, bytes),
    readFile: async (path, encoding) => { assert.ok(files.has(path), `Missing fixture file: ${path}`); const value = files.get(path); return encoding ? value.toString(encoding) : value; },
  } : nativeRequire(name);
  const github = { rest: { repos: {
    getReleaseByTag: async () => ({ data: release }),
    getLatestRelease: async () => ({ data: release }),
    getReleaseAsset: async (request) => ({ data: request.asset_id === 14 ? Buffer.from(signature) : installerBytes }),
    uploadReleaseAsset: async (request) => { uploads.push(request); },
  } } };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const execute = async (step) => new AsyncFunction('require', 'github', 'context', 'process', 'core', 'Buffer', step.with.script)(
    require, github, { repo: { owner: 'PeterPandefu', repo: 'Niuery-Toolkit' } }, { env },
    { exportVariable: (name, value) => { env[name] = value; } }, Buffer,
  );
  try {
    await execute(steps.find((step) => step.id === 'prepare'));
    // Native signer is an external boundary; it writes the signature of the downloaded file.
    if (!existingSignature) files.set(`${env.INSTALLER_PATH}.sig`, signature);
    await execute(steps.find((step) => step.id === 'upload'));
  } catch (error) {
    assert.equal(uploads.length, 0, 'Never publish metadata for unverified installer bytes or a different signing key');
    throw error;
  }
  return { uploads, signature, installer };
}

test('repairs metadata for the original installer and uploads latest.json last', async () => {
  const { uploads, signature, installer } = await runRepair();
  assert.deepEqual(uploads.map((upload) => upload.name), [`${installer.name}.sig`, 'latest.json']);
  assert.ok(uploads.every((upload) => upload.release_id === 123));
  const manifest = JSON.parse(uploads[1].data.toString('utf8'));
  assert.deepEqual(manifest, {
    version: '1.2.1', notes: '### 修复\n\n- 用户说明', pub_date: '2026-10-19T01:09:50Z',
    platforms: { 'windows-x86_64': { url: installer.browser_download_url, signature } },
  });
});

test('refuses a signing key different from the installed updater public key', async () => {
  await assert.rejects(runRepair({ wrongKey: true }), /key/i);
});

test('refuses a download whose SHA-256 differs from the published installer', async () => {
  await assert.rejects(runRepair({ wrongDigest: true }), /sha-256|digest/i);
});

test('rejects a corrupt signature even if its key ID matches', async () => {
  await assert.rejects(runRepair({ wrongSignature: true }), /signature/i);
});

test('resumes after a partial repair by verifying and reusing the uploaded signature', async () => {
  const { uploads } = await runRepair({ existingSignature: true });
  assert.deepEqual(uploads.map((upload) => upload.name), ['latest.json']);
});

test('does not overwrite an existing update manifest', async () => {
  await assert.rejects(runRepair({ existingManifest: true }), /already|exists/i);
});
