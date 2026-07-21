import { spawn } from 'node:child_process';
import process from 'node:process';

const heartbeatMs = Number.parseInt(process.env.VBOS_NPM_HEARTBEAT_MS || '15000', 10);
const hardTimeoutMs = Number.parseInt(process.env.VBOS_NPM_CI_TIMEOUT_MS || `${20 * 60 * 1000}`, 10);
const npmArgs = [
  'ci',
  '--no-audit',
  '--no-fund',
  '--progress=false',
  '--foreground-scripts',
  '--loglevel=http',
  '--timing',
  ...process.argv.slice(2),
];

function formatMs(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`;
}

console.log(`[VBOS npm] Running: npm ${npmArgs.join(' ')}`);
console.log(`[VBOS npm] Heartbeat every ${formatMs(heartbeatMs)}. Hard timeout: ${formatMs(hardTimeoutMs)}.`);
console.log('[VBOS npm] If this step is slow, it is usually downloading Prisma/Vite/Discord dependencies or compiling native optional packages.');

const startedAt = Date.now();
let lastOutputAt = Date.now();

const child = spawn('npm', npmArgs, {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_progress: 'false',
    npm_config_fetch_retries: process.env.NPM_CONFIG_FETCH_RETRIES || '3',
    npm_config_fetch_retry_mintimeout: process.env.NPM_CONFIG_FETCH_RETRY_MINTIMEOUT || '10000',
    npm_config_fetch_retry_maxtimeout: process.env.NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT || '60000',
    npm_config_fetch_timeout: process.env.NPM_CONFIG_FETCH_TIMEOUT || '300000',
  },
});

function pipe(stream, target) {
  stream.on('data', (chunk) => {
    lastOutputAt = Date.now();
    target.write(chunk);
  });
}

pipe(child.stdout, process.stdout);
pipe(child.stderr, process.stderr);

const heartbeat = setInterval(() => {
  const elapsed = Date.now() - startedAt;
  const idle = Date.now() - lastOutputAt;
  console.log(`[VBOS npm] still installing... elapsed=${formatMs(elapsed)} idle=${formatMs(idle)} pid=${child.pid}`);
}, heartbeatMs);

const hardTimeout = setTimeout(() => {
  console.error(`[VBOS npm] npm ci exceeded ${formatMs(hardTimeoutMs)} and was stopped.`);
  console.error('[VBOS npm] Most common causes: blocked registry, DNS/firewall problem, very low RAM, or package downloads being throttled.');
  console.error('[VBOS npm] Retry with: docker compose build --no-cache --progress=plain vbos');
  child.kill('SIGTERM');
  setTimeout(() => child.kill('SIGKILL'), 5000).unref();
}, hardTimeoutMs);

child.on('exit', (code, signal) => {
  clearInterval(heartbeat);
  clearTimeout(hardTimeout);
  const elapsed = Date.now() - startedAt;
  if (code === 0) {
    console.log(`[VBOS npm] npm ci completed in ${formatMs(elapsed)}.`);
    process.exit(0);
  }
  console.error(`[VBOS npm] npm ci failed after ${formatMs(elapsed)} with code=${code ?? 'null'} signal=${signal ?? 'null'}.`);
  process.exit(code || 1);
});
