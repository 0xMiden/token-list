// Checks the rules the JSON Schema cannot express: each token's network matches its file name,
// no faucet id appears twice in one list, and a token's logo is its own file in this repository
// (at most 32 KiB; a PNG at most 256x256). An SVG logo is a flat mark with bounded internal
// references: only allowlisted elements (no use, symbol or mask, script, foreignObject, style,
// image, animation or filter, prefixed or not; every tag an ASCII name the scan can read), ASCII
// text only, no event handler, style attribute, character or entity reference or backslash, every
// href a quoted # fragment, no CSS url() leaving the file, no @import, image-set() or src(), at
// most 32 fragment references, and before the root only an XML declaration, comments and a DOCTYPE
// without an internal subset. So the clipPath body scan reads the real body: no comment, CDATA
// section or processing instruction after the root starts, no < or > inside a quoted attribute
// value, every attribute value quoted, no clipPath inside a clipPath, every non-empty clipPath
// closed by its own end tag, and no reference inside a clipPath.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';

const LOGO_PREFIX = 'https://raw.githubusercontent.com/0xMiden/token-list/main/';
const MAX_LOGO_BYTES = 32 * 1024;
const MAX_PNG_SIDE = 256;
const MAX_REFERENCES = 32;
// The XML declaration, comments and a DOCTYPE with no internal subset may precede the root.
const SVG_ROOT = /^\s*(?:<\?xml\s[^>]*\?>\s*|<!--(?:(?!-->)[\s\S])*-->\s*|<!DOCTYPE[^>[]*>\s*)*<svg[\s>]/i;
const ALLOWED_ELEMENTS = new Set([
  'svg', 'g', 'defs', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon',
  'linearGradient', 'radialGradient', 'stop', 'clipPath', 'title', 'desc', 'text', 'tspan',
]);
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
  const problem = message => fail(`${file}: ${path} ${message}`);
  const root = SVG_ROOT.exec(svg);
  if (!root) problem('is not an SVG');
  else if (/<[!?]/.test(svg.slice(root[0].length))) {
    problem('has a comment, CDATA section or processing instruction after the root starts');
  }
  if (/<!DOCTYPE[^>]*\[|<!(?:ENTITY|ATTLIST|ELEMENT)/i.test(svg)) problem('has a DOCTYPE subset or declaration');
  if (/<\?(?!xml\s)/i.test(svg)) problem('has a processing instruction');
  if (/[^\x00-\x7F]/.test(svg)) problem('has a non-ASCII character');
  for (const [, tag] of svg.matchAll(/<(?![!?/])([^\s/>]*)/g)) {
    const named = /^(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)$/.exec(tag);
    if (!named) problem('has a tag the check cannot read');
    else if (!ALLOWED_ELEMENTS.has(named[1])) problem(`has an element outside the allowed set (<${named[1]}>)`);
  }
  if (/&#|&[\w.-]+;/.test(svg)) problem('has a character or entity reference');
  if (/\\/.test(svg)) problem('has a backslash');
  if (/[\s"'/]style\s*=/i.test(svg)) problem('has a style attribute');
  if (/[\s"'/]on[a-z]+\s*=/i.test(svg)) problem('has an event handler attribute');
  if (/href\s*=(?!\s*["']#)/i.test(svg)) problem('has an href that leaves the file');
  if (/url\(\s*(?!["']?\s*#)/i.test(svg)) problem('has a CSS url() that leaves the file');
  if (/=\s*(?:"[^"]*|'[^']*)[<>]/.test(svg)) problem('has a < or > inside an attribute value');
  for (const [tag] of svg.matchAll(/<(?![!?/])[^>]*>/g)) {
    if (/=(?!\s*["'])/.test(tag.replace(/"[^"]*"|'[^']*'/g, '""'))) problem('has an unquoted attribute value');
  }
  // With the rules above, the first end tag after a non-empty clipPath start tag is its own.
  const clipStart = /<(?:[\w.-]+:)?clipPath\b[^>]*?(?<!\/)>/g;
  const clipBodies = [...svg.matchAll(new RegExp(`${clipStart.source}[\\s\\S]*?<\\/(?:[\\w.-]+:)?clipPath\\s*>`, 'g'))];
  if (clipBodies.length !== (svg.match(clipStart) ?? []).length) problem('has a clipPath without an end tag');
  for (const [body] of clipBodies) {
    const inner = body.replace(new RegExp(`^${clipStart.source}`), '');
    if (/<(?:[\w.-]+:)?clipPath\b/.test(inner)) problem('has a clipPath inside a clipPath');
    if (/href\s*=|url\(/i.test(body)) problem('has a reference inside a clipPath');
  }
  if ((svg.match(/href\s*=\s*["']#|url\(\s*["']?\s*#/gi) ?? []).length > MAX_REFERENCES) {
    problem(`has more than ${MAX_REFERENCES} internal references`);
  }
  if (/@import/i.test(svg)) problem('has a CSS @import');
  if (/image-set\(|(?<![\w-])src\(/i.test(svg)) problem('has a CSS image-set() or src() function');
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
