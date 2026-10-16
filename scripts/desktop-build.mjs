import { mkdtemp, readdir, cp, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export async function prepareDesktopPublic(root) {
  const staging = await mkdtemp(path.join(os.tmpdir(), 'niuery-desktop-public-'));
  await mkdir(staging, { recursive: true });
  for (const entry of await readdir(path.join(root, 'public'))) {
    if (entry !== 'ocr') await cp(path.join(root, 'public', entry), path.join(staging, entry), { recursive: true });
  }
  return staging;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { rm } = await import('node:fs/promises');
  const publicDir = await prepareDesktopPublic(root);
  try {
    const typecheck = spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-b'], { cwd: root, stdio: 'inherit' });
    if (typecheck.status !== 0) process.exitCode = typecheck.status ?? 1;
    else {
      const build = spawnSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: root, stdio: 'inherit', env: { ...process.env, NIUERY_DESKTOP_PUBLIC: publicDir } });
      process.exitCode = build.status ?? 1;
    }
  } finally { await rm(publicDir, { recursive: true, force: true }); }
}
