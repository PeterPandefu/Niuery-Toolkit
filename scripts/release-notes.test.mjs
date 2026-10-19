import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { load as loadYaml } from 'js-yaml';

// These tests catch version leakage, incorrect fallback and swallowed API failures.
const load = () => import('./release-notes.mjs');
const changelog = '# 变更日志\n\n## [Unreleased]\n\n- 未发布\n\n## [1.2.0] - 2026-10-16\n\n### 新增\n\n- 应用内更新。\n\n## [1.1.0] - 2026-10-01\n\n- 旧版本。\n';

test('extracts only the exact tagged version, including category headings', async () => {
  const { extractReleaseNotes } = await load();
  assert.equal(extractReleaseNotes(changelog, 'v1.2.0'), '### 新增\n\n- 应用内更新。');
  assert.equal(extractReleaseNotes(changelog, 'v1.2.00'), null);
});

test('accepts unprefixed tags and CRLF with a BOM', async () => {
  const { extractReleaseNotes } = await load();
  assert.equal(extractReleaseNotes('\uFEFF' + changelog.replaceAll('\n', '\r\n'), '1.2.0'), '### 新增\n\n- 应用内更新。');
});

test('keeps prerelease notes separate from stable notes', async () => {
  const { extractReleaseNotes } = await load();
  assert.equal(extractReleaseNotes('## [1.2.0-beta.1]\n\n- Beta\n\n## [1.2.0]\n\n- Stable', 'v1.2.0-beta.1'), '- Beta');
});

test('does not interpret fenced example headings as release boundaries', async () => {
  const { extractReleaseNotes } = await load();
  const input = '## [1.2.0]\n\n```md\n## [0.0.0]\n```\n\n~~~md\n## [9.0.0]\n~~~\n\n- 本版\n\n## [1.1.0]\n- 旧版';
  assert.equal(extractReleaseNotes(input, 'v1.2.0'), '```md\n## [0.0.0]\n```\n\n~~~md\n## [9.0.0]\n~~~\n\n- 本版');
});

test('returns null for absent or empty version sections', async () => {
  const { extractReleaseNotes } = await load();
  for (const input of ['', '## [1.1.0]\n- 旧版', '## [1.2.0]\n\n### 新增\n\n<!-- 待整理 -->\n\n## [1.1.0]\n- 旧版']) {
    assert.equal(extractReleaseNotes(input, 'v1.2.0'), null);
  }
});

test('rejects duplicate matching sections and invalid tags', async () => {
  const { extractReleaseNotes } = await load();
  assert.throws(() => extractReleaseNotes('## [1.2.0]\n- A\n## [1.2.0]\n- B', 'v1.2.0'), /Duplicate/);
  assert.throws(() => extractReleaseNotes(changelog, 'resources-v1'), /Invalid/);
});

test('uses curated notes without calling the external generator', async () => {
  const { buildReleaseNotes } = await load();
  assert.equal(await buildReleaseNotes({ changelog, tagName: 'v1.2.0', generateNotes: async () => { throw new Error('unexpected network call'); } }), '### 新增\n\n- 应用内更新。');
});

test('falls back to GitHub generated notes with the exact tag', async () => {
  const { buildReleaseNotes } = await load();
  const tags = [];
  const notes = await buildReleaseNotes({ changelog, tagName: 'v1.3.0', generateNotes: async (tag) => { tags.push(tag); return '## What changed\n\n- Pull request #12'; } });
  assert.deepEqual(tags, ['v1.3.0']);
  assert.equal(notes, '## What changed\n\n- Pull request #12');
});

test('falls back for a headings-only section', async () => {
  const { buildReleaseNotes } = await load();
  assert.equal(await buildReleaseNotes({ changelog: '## [1.2.0]\n\n### 修复', tagName: 'v1.2.0', generateNotes: async () => '- Generated' }), '- Generated');
});

test('propagates generation failures instead of publishing placeholder notes', async () => {
  const { buildReleaseNotes } = await load();
  await assert.rejects(buildReleaseNotes({ changelog: '', tagName: 'v1.2.0', generateNotes: async () => { throw new Error('API unavailable'); } }), /API unavailable/);
  await assert.rejects(buildReleaseNotes({ changelog: '', tagName: 'v1.2.0', generateNotes: async () => ' \n' }), /empty/i);
});

// Execute the actual workflow script. Only GitHub and file IO are boundary doubles.
async function runWorkflowNotes(readChangelog, generateReleaseNotes) {
  const workflow = loadYaml(await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'));
  const step = workflow.jobs.publish.steps.find((step) => step.id === 'notes');
  const nativeRequire = createRequire(import.meta.url);
  const require = (name) => name === 'node:fs/promises' ? { readFile: readChangelog } : nativeRequire(name);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  return new AsyncFunction('require', 'context', 'github', 'core', step.with.script)(
    require,
    { ref: 'refs/tags/v1.2.0', repo: { owner: 'PeterPandefu', repo: 'Niuery-Toolkit' } },
    { rest: { repos: { generateReleaseNotes } } },
    { info() {} },
  );
}

test('workflow returns multiline curated notes without calling GitHub', async () => {
  assert.equal(await runWorkflowNotes(async (file, encoding) => {
    assert.equal(file, 'CHANGELOG.md');
    assert.equal(encoding, 'utf8');
    return changelog;
  }, async () => { throw new Error('unexpected API call'); }), '### 新增\n\n- 应用内更新。');
});

test('workflow generates notes for a missing file with repository and tag identity', async () => {
  assert.equal(await runWorkflowNotes(async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); }, async (request) => {
    assert.deepEqual(request, { owner: 'PeterPandefu', repo: 'Niuery-Toolkit', tag_name: 'v1.2.0' });
    return { data: { name: 'v1.2.0', body: '## Changes\n\n- Generated' } };
  }), '## Changes\n\n- Generated');
});

test('workflow does not hide file permission errors or GitHub failures', async () => {
  await assert.rejects(runWorkflowNotes(async () => { throw Object.assign(new Error('permission denied'), { code: 'EACCES' }); }, async () => { throw new Error('unexpected API call'); }), /permission denied/);
  await assert.rejects(runWorkflowNotes(async () => '', async () => { throw new Error('GitHub unavailable'); }), /GitHub unavailable/);
});
