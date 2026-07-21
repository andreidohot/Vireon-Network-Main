import fs from 'node:fs';
import process from 'node:process';

const lockPath = new URL('../package-lock.json', import.meta.url);
const publicRegistry = 'https://registry.npmjs.org/';
const forbiddenMarkers = [
  'applied-caas',
  'artifactory',
  'npm-public',
  'localhost',
  '127.0.0.1',
];

function fail(message) {
  console.error(`[VBOS lock] ${message}`);
  process.exitCode = 1;
}

if (!fs.existsSync(lockPath)) {
  fail('package-lock.json is missing. Run npm install on Node 24 and commit the lockfile.');
  process.exit();
}

const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
const bad = [];
const nonPublic = [];

for (const [pkgPath, meta] of Object.entries(lock.packages || {})) {
  if (!meta || typeof meta !== 'object' || !meta.resolved) continue;
  const resolved = String(meta.resolved);
  if (forbiddenMarkers.some((marker) => resolved.includes(marker))) {
    bad.push({ pkgPath, resolved });
    continue;
  }
  if (resolved.startsWith('http://') || resolved.startsWith('https://')) {
    if (!resolved.startsWith(publicRegistry)) {
      nonPublic.push({ pkgPath, resolved });
    }
  }
}

if (bad.length > 0) {
  fail(`package-lock.json contains ${bad.length} forbidden/internal registry URL(s).`);
  for (const item of bad.slice(0, 20)) {
    console.error(`[VBOS lock] forbidden ${item.pkgPath}: ${item.resolved}`);
  }
}

if (nonPublic.length > 0) {
  fail(`package-lock.json contains ${nonPublic.length} non-public registry URL(s). VBOS release builds must use ${publicRegistry}.`);
  for (const item of nonPublic.slice(0, 20)) {
    console.error(`[VBOS lock] non-public ${item.pkgPath}: ${item.resolved}`);
  }
}

if (process.exitCode) {
  console.error('[VBOS lock] Fix by replacing internal resolved URLs with https://registry.npmjs.org/ or regenerating the lockfile from the public npm registry.');
  process.exit();
}

console.log('[VBOS lock] OK. package-lock.json uses the public npm registry only.');
