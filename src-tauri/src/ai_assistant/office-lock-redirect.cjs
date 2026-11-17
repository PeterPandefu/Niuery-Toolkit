// Injected via NODE_OPTIONS=--require into the bundled Qoder office engines.
// Their file lock creates `.qoder-office-<format>-locks` next to the document
// and never removes the directory. Redirect every such directory into a
// per-user temp root (keyed by the original location so cross-process locking
// still works) and prune it once the last lock file is gone.
'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const LOCK_DIR = /^\.qoder-office-[a-z0-9]+-locks$/i;
const BASE = path.join(os.tmpdir(), 'qoder-office-locks');

function asString(value) {
  if (typeof value === 'string') return value;
  if (value instanceof URL) return value.pathname;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return null;
}

function remap(value) {
  const text = asString(value);
  if (text === null) return value;
  const normalized = path.normalize(text);
  const segments = normalized.split(path.sep);
  const index = segments.findIndex((segment) => LOCK_DIR.test(segment));
  if (index < 0) return value;
  const originalDir = segments.slice(0, index).join(path.sep) || path.sep;
  const key = crypto.createHash('sha256').update(originalDir).digest('hex');
  const mapped = path.join(BASE, key, ...segments.slice(index));
  return typeof value === 'string' ? mapped : new URL(`file://${mapped}`);
}

function prune(mapped) {
  // Remove emptied lock directories; stop at the first non-empty level.
  let current = path.dirname(mapped);
  while (current.startsWith(BASE + path.sep)) {
    try {
      fs.rmdirSync(current);
    } catch {
      break;
    }
    current = path.dirname(current);
  }
}

for (const name of ['mkdir', 'readdir', 'open', 'writeFile', 'rename', 'rm', 'readFile']) {
  const original = fsp[name];
  if (typeof original !== 'function') continue;
  fsp[name] = function (target, ...rest) {
    const mapped = remap(target);
    if (name === 'rename') {
      return original.call(this, mapped, remap(rest[0]), ...rest.slice(1));
    }
    const result = original.call(this, mapped, ...rest);
    if (name === 'rm' && mapped !== target) {
      return Promise.resolve(result).then(
        (value) => {
          prune(asString(mapped));
          return value;
        },
        (error) => {
          prune(asString(mapped));
          throw error;
        },
      );
    }
    return result;
  };
}