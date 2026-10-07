// Checks the rules the JSON Schema cannot express: each token's network matches its file name,
// no faucet id appears twice in one list, and a token's logo is its own PNG in this repository
// (a regular file, reached through no link, holding a square PNG of at most 32 KiB and
// 256x256).
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';

const LOGO_PREFIX = 'https://raw.githubusercontent.com/0xMiden/token-list/main/';
const MAX_LOGO_BYTES = 32 * 1024;
const MAX_PNG_SIDE = 256;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const NETWORKS = new Set(['mainnet', 'testnet', 'devnet']);
let failed = false;
const fail = message => {
  console.error(message);
  failed = true;
};

function checkLogo(file, token) {
  const { logoURI, faucetId } = token;
  if (logoURI === undefined) return;
  if (typeof logoURI !== 'string') return fail(`${file}: ${faucetId} logoURI is not a string`);
  const path = logoURI.startsWith(LOGO_PREFIX) ? logoURI.slice(LOGO_PREFIX.length) : null;
  const match = path && /^logos\/([^/]+)\/logo\.png$/.exec(path);
  if (!match) return fail(`${file}: ${faucetId} logoURI is not a logo in this repository`);
  if (match[1] !== faucetId) return fail(`${file}: ${faucetId} logoURI names another faucet (${match[1]})`);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return fail(`${file}: ${faucetId} logo ${path} is missing`);
  // GitHub serves the git tree and follows no link, so neither the file nor a directory may be one.
  if (!stat.isFile() || realpathSync(path) !== resolve(path)) {
    return fail(`${file}: ${faucetId} logo ${path} is not a regular file`);
  }
  if (stat.size > MAX_LOGO_BYTES) return fail(`${file}: ${faucetId} logo ${path} is too large`);
  const bytes = readFileSync(path);
  const signed = bytes.length >= 24 && bytes.subarray(0, 8).equals(PNG_SIGNATURE);
  if (!signed || bytes.readUInt32BE(8) !== 13 || bytes.toString('latin1', 12, 16) !== 'IHDR') {
    return fail(`${file}: ${path} is not a PNG`);
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width > MAX_PNG_SIDE || height > MAX_PNG_SIDE) {
    return fail(`${file}: ${path} is larger than ${MAX_PNG_SIDE}x${MAX_PNG_SIDE}`);
  }
  if (width === 0 || width !== height) fail(`${file}: ${path} is not a square image`);
}

for (const file of readdirSync('.').filter(name => NETWORKS.has(name.replace(/\.json$/, '')))) {
  const network = file.replace(/\.json$/, '');
  const { tokens } = JSON.parse(readFileSync(file, 'utf8'));
  const seen = new Set();
  for (const token of tokens) {
    if (token.network !== network) fail(`${file}: ${token.faucetId} has network "${token.network}"`);
    if (seen.has(token.faucetId)) fail(`${file}: ${token.faucetId} is listed twice`);
    seen.add(token.faucetId);
    checkLogo(file, token);
  }
}

process.exit(failed ? 1 : 0);
