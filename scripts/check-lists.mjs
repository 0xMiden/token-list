// Checks the rules the JSON Schema cannot express: each token's network matches its file name,
// no faucet id appears twice in one list, and a token's logo is its own file in this repository
// (at most 32 KiB; a PNG at most 256x256; an SVG with no script, style, animation or foreign
// element, no event handler and no link or CSS url() outside the file).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';

const LOGO_PREFIX = 'https://raw.githubusercontent.com/0xMiden/token-list/main/';
const MAX_LOGO_BYTES = 32 * 1024;
const MAX_PNG_SIDE = 256;
// An optional XML declaration, comments and a DOCTYPE may precede the root, as editors export them.
const SVG_ROOT = /^\s*(?:<\?xml[^>]*\?>\s*|<!--[\s\S]*?-->\s*|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>\s*)*<svg[\s>]/i;
// Matched with or without a namespace prefix, since `<s:script>` runs when `s` is bound to SVG.
const FORBIDDEN_ELEMENT = /<(?:[\w.-]+:)?(?:script|foreignObject|style|animate\w*|set)\b/i;
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
  const match = path && /^logos\/([^/]+)\/logo\.(svg|png)$/.exec(path);
  if (!match) return fail(`${file}: ${faucetId} logoURI is not a logo in this repository`);
  if (match[1] !== faucetId) return fail(`${file}: ${faucetId} logoURI names another faucet (${match[1]})`);
  if (!existsSync(path)) return fail(`${file}: ${faucetId} logo ${path} is missing`);
  if (statSync(path).size > MAX_LOGO_BYTES) return fail(`${file}: ${faucetId} logo ${path} is too large`);
  const bytes = readFileSync(path);
  if (match[2] === 'png') {
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.toString('latin1', 12, 16) !== 'IHDR') {
      return fail(`${file}: ${path} is not a PNG`);
    }
    if (bytes.readUInt32BE(16) > MAX_PNG_SIDE || bytes.readUInt32BE(20) > MAX_PNG_SIDE) {
      fail(`${file}: ${path} is larger than ${MAX_PNG_SIDE}x${MAX_PNG_SIDE}`);
    }
    return;
  }
  const svg = bytes.toString('utf8');
  if (!SVG_ROOT.test(svg)) fail(`${file}: ${path} is not an SVG`);
  if (FORBIDDEN_ELEMENT.test(svg) || /<!ENTITY/i.test(svg)) {
    fail(`${file}: ${path} embeds a script or foreign content (script, foreignObject, style, animation or entity)`);
  }
  if (/\son[a-z]+\s*=/i.test(svg)) fail(`${file}: ${path} has an event handler attribute`);
  if (/href\s*=\s*["'](?!#)/i.test(svg) || /url\(\s*(?!["']?\s*#)/i.test(svg) || /@import/i.test(svg)) {
    fail(`${file}: ${path} links outside itself`);
  }
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
