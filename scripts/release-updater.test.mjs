import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { load as loadYaml } from 'js-yaml';

const tag = 'v1.2.1';
const installerName = 'Niuery.Toolkit_1.2.1_x64-setup.exe';
const installerUrl = `https://github.com/PeterPandefu/Niuery-Toolkit/releases/download/${tag}/${installerName}`;
const signature = 'signed-installer-fixture';

// Run the actual workflow gate. Only the GitHub API boundary is replaced.
async function runGate({ missing = [], version = '1.2.1', url = installerUrl, manifestSignature = signature, platform = 'windows-x86_64', assetError = null, published = false, untaggedDraft = false } = {}) {
  const workflow = loadYaml(await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'));
  const steps = workflow.jobs.publish.steps;
  const gate = steps.find((step) => step.id === 'verify_release');
  assert.ok(gate, 'Release must validate updater assets before publishing');
  const build = steps.find((step) => step.uses === 'tauri-apps/tauri-action@v0');
  assert.equal(build.with.releaseDraft, true, 'Keep incomplete releases out of the installed updater endpoint');
  const updates = [];
  const assets = [installerName, `${installerName}.sig`, 'latest.json']
    .filter((name) => !missing.includes(name))
    .map((name, index) => ({ id: index + 1, name, state: 'uploaded', browser_download_url: `https://github.com/PeterPandefu/Niuery-Toolkit/releases/download/${untaggedDraft ? 'untagged-abcd' : tag}/${name}` }));
  const manifest = { version, platforms: { [platform]: { url, signature: manifestSignature } } };
  const github = { rest: { repos: {
    getRelease: async (request) => {
      assert.deepEqual(request, { owner: 'PeterPandefu', repo: 'Niuery-Toolkit', release_id: 123 });
      return { data: { tag_name: tag, draft: !published, assets } };
    },
    getReleaseAsset: async (request) => {
      assert.equal(request.owner, 'PeterPandefu');
      assert.equal(request.repo, 'Niuery-Toolkit');
      assert.equal(request.headers.accept, 'application/octet-stream');
      if (assetError) throw new Error(assetError);
      const asset = assets.find((asset) => asset.id === request.asset_id);
      assert.ok(asset, 'Download an asset from this release');
      return { data: Buffer.from(asset.name === 'latest.json' ? JSON.stringify(manifest) : `${signature}\n`) };
    },
    updateRelease: async (request) => { updates.push(request); },
  } } };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  try {
    await new AsyncFunction('github', 'context', 'process', 'Buffer', gate.with.script)(
      github,
      { repo: { owner: 'PeterPandefu', repo: 'Niuery-Toolkit' }, ref: `refs/tags/${tag}` },
      { env: { RELEASE_ID: '123' } }, Buffer,
    );
  } catch (error) {
    assert.equal(updates.length, 0, 'Invalid updater data must never publish the draft');
    throw error;
  }
  return updates;
}

test('publishes a complete signed Windows update as latest', async () => {
  assert.deepEqual(await runGate(), [{ owner: 'PeterPandefu', repo: 'Niuery-Toolkit', release_id: 123, draft: false, make_latest: 'true' }]);
});

test('accepts the trailing newline preserved by Tauri Action in manifest signatures', async () => {
  assert.equal((await runGate({ manifestSignature: `${signature}\n` })).length, 1);
});

test('accepts the final tagged URL when GitHub still returns an untagged draft asset URL', async () => {
  assert.equal((await runGate({ untaggedDraft: true })).length, 1);
});

test('rejects the installer-only release that broke v1.2.0 update checks', async () => {
  await assert.rejects(runGate({ missing: [`${installerName}.sig`, 'latest.json'] }), /missing|缺少/i);
});

test('rejects each missing updater asset', async () => {
  for (const name of [installerName, `${installerName}.sig`, 'latest.json']) {
    await assert.rejects(runGate({ missing: [name] }), /missing|缺少/i);
  }
});

test('rejects a manifest for a different version, platform, URL or signature', async () => {
  for (const options of [
    { version: '1.2.0' }, { platform: 'linux-x86_64' },
    { url: installerUrl.replace('v1.2.1/', 'v1.2.0/') },
    { manifestSignature: '' }, { manifestSignature: 'wrong-signature' },
  ]) {
    await assert.rejects(runGate(options), /version|platform|url|signature/i);
  }
});

test('stops publication if downloading release metadata fails', async () => {
  await assert.rejects(runGate({ assetError: 'GitHub unavailable' }), /GitHub unavailable/);
});

test('does not republish an existing public release during a rerun', async () => {
  await assert.rejects(runGate({ published: true }), /draft/i);
});
