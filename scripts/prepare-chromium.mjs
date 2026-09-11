import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const required = process.argv.includes('--required');
const force = process.argv.includes('--force');
const skipRequested = process.env.NIUERY_SKIP_CHROMIUM === '1';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function playwrightCacheRoot() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== '0') {
    return process.env.PLAYWRIGHT_BROWSERS_PATH;
  }
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'ms-playwright');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  }
  return path.join(os.homedir(), '.cache', 'ms-playwright');
}

function platformTarget() {
  if (process.platform !== 'win32') return null;
  const directory = process.arch === 'arm64' ? 'win-arm64' : 'win-x64';
  return {
    directory,
    executable: 'chrome-headless-shell.exe',
    sourceFolderNames: ['chrome-headless-shell-win64', 'chrome-headless-shell-win32'],
  };
}

function newestChromiumCache(cacheRoot) {
  if (!existsSync(cacheRoot)) return null;
  const entries = readdirSync(cacheRoot)
    .filter((name) => name.startsWith('chromium_headless_shell-'))
    .map((name) => ({ name, fullPath: path.join(cacheRoot, name) }))
    .filter((entry) => statSync(entry.fullPath).isDirectory())
    .sort((left, right) => right.name.localeCompare(left.name));
  return entries[0] ?? null;
}

function findSourceBundle(cacheDir, sourceFolderNames, executable) {
  for (const folderName of sourceFolderNames) {
    const candidate = path.join(cacheDir, folderName, executable);
    if (existsSync(candidate)) {
      return path.dirname(candidate);
    }
  }
  const direct = path.join(cacheDir, executable);
  return existsSync(direct) ? cacheDir : null;
}

function installPlaywrightChromium() {
  const cli = [
    path.join(repoRoot, 'node_modules', 'playwright', 'cli.js'),
    path.join(repoRoot, 'node_modules', '@playwright', 'test', 'cli.js'),
  ].find((file) => existsSync(file));
  if (!cli) {
    fail('未找到 Playwright，请先在仓库根目录执行 npm install。');
  }
  const result = spawnSync(process.execPath, [cli, 'install', 'chromium-headless-shell'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    fail('Playwright 安装 Chromium Headless Shell 失败，请检查网络后重试。');
  }
}

const target = platformTarget();
if (!target) {
  console.log(`当前平台 ${process.platform} 无需准备 Windows Chromium，已跳过。`);
  process.exit(0);
}

if (skipRequested && !required) {
  console.log('已设置 NIUERY_SKIP_CHROMIUM=1，跳过 Chromium 准备。');
  process.exit(0);
}

const destDir = path.join(repoRoot, 'src-tauri', 'resources', 'chromium', target.directory);
const destExe = path.join(destDir, target.executable);
const stampPath = path.join(destDir, '.revision');

let cache = newestChromiumCache(playwrightCacheRoot());
if (!cache || !findSourceBundle(cache.fullPath, target.sourceFolderNames, target.executable)) {
  console.log('未找到 Playwright Chromium Headless Shell，开始下载…');
  installPlaywrightChromium();
  cache = newestChromiumCache(playwrightCacheRoot());
}

if (!cache) {
  fail('未找到 Playwright Chromium Headless Shell 缓存，请运行 npx playwright install chromium-headless-shell。');
}

const sourceDir = findSourceBundle(cache.fullPath, target.sourceFolderNames, target.executable);
if (!sourceDir) {
  fail(`Chromium 可执行文件不存在：${path.join(cache.fullPath, target.executable)}`);
}

const revision = cache.name;
const alreadyPrepared = existsSync(destExe) && existsSync(stampPath) && readFileSync(stampPath, 'utf8').trim() === revision;
if (alreadyPrepared && !force) {
  console.log(`Chromium 已就绪：${destDir}`);
  process.exit(0);
}

mkdirSync(destDir, { recursive: true });
for (const name of readdirSync(destDir)) {
  if (name === 'README.md') continue;
  rmSync(path.join(destDir, name), { recursive: true, force: true });
}
cpSync(sourceDir, destDir, { recursive: true });
writeFileSync(stampPath, `${revision}\n`);
if (!existsSync(destExe)) {
  fail(`复制 Chromium 失败：${destExe}`);
}
console.log(`已准备 Chromium：${destDir}`);
