// Checks the rules the JSON Schema cannot express: each token's network matches its file name,
// no faucet id appears twice in one list, and a token's logo is its own file in this repository
// (at most 32 KiB; a PNG at most 256x256). An SVG logo is a flat mark with bounded internal
// references: only allowlisted elements (no use, symbol or mask, script, foreignObject, style,
// image, animation or filter, prefixed or not; every tag an ASCII name the scan can read), ASCII
// text only, no event handler, style attribute, character or entity reference or backslash, every
// href a quoted # fragment, no CSS url() leaving the file, no @import, image-set() or src(), at
// most 32 fragment references, and before the root only an XML declaration, comments and a DOCTYPE
// without an internal subset (a comment there holds no <). Tags nest (every end tag closes its
// own element, every element is closed, nothing follows the root), with no comment, CDATA section
// or processing instruction after the root starts, no < or > inside a quoted attribute value and
// every attribute value quoted, so no clipPath holds a clipPath or a reference.
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

// Tags must nest: every end tag closes its own element, every element is closed and nothing
// follows the root. That is what lets the clipPath rules read a clipPath's real body.
function walkTags(svg, start, problem) {
  const startTag = /<([^\s/<>]*)[^<>]*>/y;
  const endTag = /<\/((?:[A-Za-z_][\w.-]*:)?[A-Za-z_][\w.-]*)\s*>/y;
  const isClip = name => name.split(':').pop() === 'clipPath';
  const stack = [];
  let clipFrom = -1;
  for (let i = svg.indexOf('<', start); i !== -1; i = svg.indexOf('<', i)) {
    if (svg[i + 1] === '!' || svg[i + 1] === '?') {
      i += 2;
      continue;
    }
    let end = i + 1;
    if (svg[i + 1] === '/') {
      endTag.lastIndex = i;
      const closed = endTag.exec(svg);
      if (!closed) return problem('has an end tag the check cannot read');
      if (closed[1] !== stack[stack.length - 1]) {
        return problem(`has an end tag that does not close its element (</${closed[1]}>)`);
      }
      stack.pop();
      end = endTag.lastIndex;
      if (isClip(closed[1]) && !stack.some(isClip)) {
        if (/href\s*=|url\(/i.test(svg.slice(clipFrom, end))) problem('has a reference inside a clipPath');
        clipFrom = -1;
      }
    } else {
      startTag.lastIndex = i;
      const opened = startTag.exec(svg);
      if (!opened) return problem('has a tag the check cannot read');
      end = startTag.lastIndex;
      if (isClip(opened[1]) && stack.some(isClip)) problem('has a clipPath inside a clipPath');
      if (!opened[0].endsWith('/>')) {
        if (isClip(opened[1]) && clipFrom === -1) clipFrom = i;
        stack.push(opened[1]);
      }
    }
    if (stack.length === 0) {
      if (/\S/.test(svg.slice(end))) problem('has content after the root element');
      return;
    }
    i = end;
  }
  for (const name of stack) problem(`has an element without an end tag (<${name}>)`);
}

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
  const reported = new Set();
  const problem = message => {
    if (!reported.has(message)) fail(`${file}: ${path} ${message}`);
    reported.add(message);
  };
  const root = SVG_ROOT.exec(svg);
  if (!root) problem('is not an SVG');
  else if (/<[!?]/.test(svg.slice(root[0].length))) {
    problem('has a comment, CDATA section or processing instruction after the root starts');
  }
  if (root && [...root[0].matchAll(/<!--((?:(?!-->)[\s\S])*)-->/g)].some(([, body]) => body.includes('<'))) {
    problem('has a < inside a comment before the root');
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
  for (const [tag] of svg.matchAll(/<(?![!?/])[^<>]*>/g)) {
    if (/=(?!\s*["'])/.test(tag.replace(/"[^"]*"|'[^']*'/g, '""'))) problem('has an unquoted attribute value');
  }
  if (root) walkTags(svg, root[0].length - '<svg '.length, problem);
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
