import http from 'node:http';
import https from 'node:https';
import process from 'node:process';

const registry = process.env.NPM_CONFIG_REGISTRY || process.env.npm_config_registry || 'https://registry.npmjs.org/';
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);

console.log(`[VBOS preflight] Node.js ${process.version}`);
console.log(`[VBOS preflight] npm registry: ${registry}`);

if (nodeMajor !== 24) {
  console.error(`[VBOS preflight] Node.js 24.x is required for this VBOS build. Current runtime: ${process.version}. Use Docker or install Node 24 LTS/current on the host.`);
  process.exit(1);
}

function checkRegistry(urlString) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(urlString);
    } catch {
      console.warn(`[VBOS preflight] Registry URL is invalid: ${urlString}`);
      resolve(false);
      return;
    }

    const client = url.protocol === 'http:' ? http : https;
    const req = client.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: '/-/ping?write=false',
        method: 'GET',
        timeout: 10000,
      },
      (res) => {
        res.resume();
        const ok = res.statusCode >= 200 && res.statusCode < 500;
        console.log(`[VBOS preflight] Registry ping status: ${res.statusCode}`);
        resolve(ok);
      },
    );

    req.on('timeout', () => {
      req.destroy(new Error('registry ping timeout'));
    });

    req.on('error', (error) => {
      console.warn(`[VBOS preflight] Registry ping warning: ${error.message}`);
      resolve(false);
    });

    req.end();
  });
}

await checkRegistry(registry);
console.log('[VBOS preflight] OK. Starting npm install step.');
