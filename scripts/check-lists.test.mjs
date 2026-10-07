import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-lists.mjs');
const PREFIX = 'https://raw.githubusercontent.com/0xMiden/token-list/main/';
const ID = 'mtst1aqvpq8a9ytqhfvt9al20wzsrs56g83ec';
const OTHER = 'mtst1arqxg9er3xclayt95nud82jnpggl9azj';
const GOOD_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="32"/></svg>';

const png = (width, height) => {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
};

// Builds a temporary repo with a testnet.json and the given files, runs the checks in it.
function run({ tokens, files = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'check-lists-'));
  writeFileSync(join(dir, 'testnet.json'), JSON.stringify({ tokens }));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  try {
    return spawnSync('node', [SCRIPT], { cwd: dir, encoding: 'utf8', timeout: 10_000 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const token = (extra = {}) => ({ network: 'testnet', faucetId: ID, symbol: 'MIDEN', name: 'Miden', decimals: 6, ...extra });
const logoPath = (ext = 'svg', id = ID) => `logos/${id}/logo.${ext}`;
const withLogo = (ext = 'svg', id = ID) => token({ logoURI: PREFIX + logoPath(ext, id) });
const svgCase = content => run({ tokens: [withLogo()], files: { [logoPath()]: content } });

const rejects = (result, text) => {
  assert.equal(result.status, 1, result.stderr);
  assert.doesNotMatch(result.stderr, /\n\s+at /, 'no stack trace');
  assert.match(result.stderr, text);
};

test('a valid list with an svg logo passes', () => {
  const result = run({ tokens: [withLogo()], files: { [logoPath()]: GOOD_SVG } });
  assert.equal(result.status, 0, result.stderr);
});

test('a valid 64x64 png logo passes', () => {
  const result = run({ tokens: [withLogo('png')], files: { [logoPath('png')]: png(64, 64) } });
  assert.equal(result.status, 0, result.stderr);
});

test('a token without a logo passes', () => {
  assert.equal(run({ tokens: [token()] }).status, 0);
});

test('a logoURI naming another faucet id fails', () => {
  const tokens = [token({ logoURI: PREFIX + logoPath('svg', OTHER) })];
  rejects(run({ tokens, files: { [logoPath('svg', OTHER)]: GOOD_SVG } }), /names another faucet/);
});

test('a logoURI outside this repository fails', () => {
  const tokens = [token({ logoURI: 'https://example.com/logo.svg' })];
  rejects(run({ tokens }), /not a logo in this repository/);
});

test('a missing logo file fails', () => {
  rejects(run({ tokens: [withLogo()] }), /missing/);
});

test('a logo over 32 KiB fails', () => {
  const big = GOOD_SVG + ' '.repeat(32 * 1024);
  rejects(svgCase(big), /too large/);
});

test('an svg with a script fails', () => {
  rejects(svgCase('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), /\(<script>\)/);
});

test('an svg with an event handler fails', () => {
  rejects(svgCase('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'), /event handler/);
});

test('an svg linking outside itself fails', () => {
  rejects(svgCase('<svg xmlns="http://www.w3.org/2000/svg"><linearGradient id="g" href="https://example.com/a.svg#x"/></svg>'), /href that leaves/);
});

test('a png over 256x256 fails', () => {
  const result = run({ tokens: [withLogo('png')], files: { [logoPath('png')]: png(300, 64) } });
  rejects(result, /larger than 256x256/);
});

test('a png taller than 256 fails', () => {
  const result = run({ tokens: [withLogo('png')], files: { [logoPath('png')]: png(64, 300) } });
  rejects(result, /larger than 256x256/);
});

test('a png without the PNG signature fails', () => {
  const bytes = png(64, 64);
  bytes[0] ^= 0xff;
  rejects(run({ tokens: [withLogo('png')], files: { [logoPath('png')]: bytes } }), /is not a PNG/);
});

test('a token on the wrong network fails', () => {
  rejects(run({ tokens: [token({ network: 'devnet' })] }), /has network "devnet"/);
});

test('a duplicate faucet id fails', () => {
  rejects(run({ tokens: [token(), token()] }), /is listed twice/);
});

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const rejectsSvg = (content, text) => rejects(svgCase(content), text);
const passesSvg = content => {
  const result = svgCase(content);
  assert.equal(result.status, 0, result.stderr);
};

test('a prefixed script element fails', () => {
  rejectsSvg(`<svg ${NS} xmlns:s="http://www.w3.org/2000/svg"><s:script>alert(1)</s:script></svg>`, /\(<script>\)/);
});

test('a foreignObject fails', () => {
  rejectsSvg(`<svg ${NS}><foreignObject/></svg>`, /\(<foreignObject>\)/);
});

test('a prefixed foreignObject fails', () => {
  rejectsSvg(`<svg ${NS} xmlns:s="http://www.w3.org/2000/svg"><s:foreignObject/></svg>`, /\(<foreignObject>\)/);
});

test('a style element fails', () => {
  rejectsSvg(`<svg ${NS}><style/></svg>`, /\(<style>\)/);
});

test('a css @import fails', () => {
  rejectsSvg(`<svg ${NS}><!-- @import 'https://example.com/a.css' --></svg>`, /@import/);
});

test('a style attribute fetching a url fails', () => {
  rejectsSvg(`<svg ${NS}><rect style="fill:url(https://example.com/a.svg#x)"/></svg>`, /CSS url/);
});

test('an internal url(#id) paint passes', () => {
  passesSvg(`<svg ${NS}><defs><linearGradient id="g"/></defs><rect fill="url(#g)"/></svg>`);
});

test('an animate element setting an href fails', () => {
  rejectsSvg(`<svg ${NS}><animate attributeName="x"/></svg>`, /\(<animate>\)/);
});

test('a set element fails', () => {
  rejectsSvg(`<svg ${NS}><set attributeName="x"/></svg>`, /\(<set>\)/);
});

test('an xlink:href to an outside url fails', () => {
  rejectsSvg(`<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink"><linearGradient id="g" xlink:href="https://example.com/a.svg#x"/></svg>`, /href that leaves/);
});

test('an internal href passes', () => {
  passesSvg(`<svg ${NS}><defs><linearGradient id="a"/><linearGradient id="b" href="#a"/></defs></svg>`);
  passesSvg(`<svg ${NS}><defs><linearGradient id="a"/><linearGradient id="b" href= "#a"/></defs></svg>`);
});

test('an svg after an xml comment passes', () => {
  passesSvg(`<!-- exported -->\n<svg ${NS}></svg>`);
});

test('an svg after a doctype passes', () => {
  passesSvg(`<?xml version="1.0"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<svg ${NS}></svg>`);
});

test('a file that is not an svg fails', () => {
  rejectsSvg('<html><body>hello</body></html>', /is not an SVG/);
});

test('a truncated png fails cleanly', () => {
  const short = png(64, 64).subarray(0, 20);
  rejects(run({ tokens: [withLogo('png')], files: { [logoPath('png')]: short } }), /is not a PNG/);
});

test('a png without an IHDR chunk fails', () => {
  const bytes = png(64, 64);
  bytes.write('IDAT', 12);
  rejects(run({ tokens: [withLogo('png')], files: { [logoPath('png')]: bytes } }), /is not a PNG/);
});

test('a null logoURI fails cleanly', () => {
  rejects(run({ tokens: [token({ logoURI: null })] }), /logoURI is not a string/);
});

test('a numeric logoURI fails cleanly', () => {
  rejects(run({ tokens: [token({ logoURI: 5 })] }), /logoURI is not a string/);
});

test('a DOCTYPE internal subset fails', () => {
  rejectsSvg(`<!DOCTYPE svg [<!ATTLIST svg onload CDATA "alert(1)">]>\n<svg ${NS}></svg>`, /DOCTYPE subset/);
});

test('a character reference fails', () => {
  rejectsSvg(`<svg ${NS}><rect fill="&#117;rl(https://example.com/a.svg#x)"/></svg>`, /entity reference/);
});

test('a handler after a slash fails', () => {
  rejectsSvg(`<svg ${NS}><g/onload="alert(1)"></g></svg>`, /event handler/);
});

test('a handler after a quote fails', () => {
  rejectsSvg(`<svg ${NS}><g x="1"onload="alert(1)"></g></svg>`, /event handler/);
});

test('a processing instruction before the root fails', () => {
  rejectsSvg(`<?xml-stylesheet type="text/css" href="#s"?>\n<svg ${NS}></svg>`, /processing instruction/);
});

test('an image element fails', () => {
  rejectsSvg(`<svg ${NS}><image href="#a"/></svg>`, /\(<image>\)/);
});

test('a feImage element fails', () => {
  rejectsSvg(`<svg ${NS}><feImage href="#a"/></svg>`, /\(<feImage>\)/);
});

test('a style attribute fails', () => {
  rejectsSvg(`<svg ${NS}><rect style="fill:red"/></svg>`, /style attribute/);
});

test('a css escape fails', () => {
  rejectsSvg(`<svg ${NS}><rect fill="u\\72l(https://example.com/a.svg#x)"/></svg>`, /backslash/);
});

test('an image-set function fails', () => {
  rejectsSvg(`<svg ${NS}><rect mask="image-set('https://example.com/a.png' 1x)"/></svg>`, /image-set/);
});

test('an editor-style svg passes', () => {
  passesSvg(
    `<?xml version="1.0" encoding="UTF-8"?>\n<!-- Generator: editor -->\n<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink" width="64" height="64">` +
      '<title>Mark</title><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient>' +
      '<linearGradient id="h" xlink:href="#g"/></defs><path d="M0 0L8 8" fill="url(#h)"/></svg>'
  );
});

test('many comments before a non-svg fail fast', () => {
  rejectsSvg('<!---->'.repeat(40) + 'x', /is not an SVG/);
});

test('a css src function fails', () => {
  rejectsSvg(`<svg ${NS}><rect fill="src(#a)"/></svg>`, /image-set\(\) or src\(\)/);
});

test('a standalone ENTITY declaration fails', () => {
  rejectsSvg(`<!DOCTYPE svg>\n<!ENTITY a "b">\n<svg ${NS}></svg>`, /DOCTYPE subset or declaration/);
});

test('a standalone ELEMENT declaration fails', () => {
  rejectsSvg(`<!DOCTYPE svg>\n<!ELEMENT svg ANY>\n<svg ${NS}></svg>`, /DOCTYPE subset or declaration/);
});

test('a standalone ATTLIST declaration fails', () => {
  rejectsSvg(`<!DOCTYPE svg>\n<!ATTLIST svg a CDATA "b">\n<svg ${NS}></svg>`, /DOCTYPE subset or declaration/);
});

test('a DOCTYPE with an empty subset fails', () => {
  rejectsSvg(`<!DOCTYPE svg []>\n<svg ${NS}></svg>`, /DOCTYPE subset or declaration/);
});

test('a named entity reference fails', () => {
  rejectsSvg(`<svg ${NS}><title>&lt;</title></svg>`, /entity reference/);
});

test('an unquoted href fails', () => {
  rejectsSvg(`<svg ${NS}><linearGradient id="g" href=https://example.com/a.svg#x></linearGradient></svg>`, /href that leaves/);
});

test('a use element fails', () => {
  rejectsSvg(`<svg ${NS}><use href="#a"/></svg>`, /\(<use>\)/);
});

test('a symbol element fails', () => {
  rejectsSvg(`<svg ${NS}><symbol id="a"/></svg>`, /\(<symbol>\)/);
});

test('a non-ASCII namespace prefix fails', () => {
  rejectsSvg(`<svg ${NS} xmlns:gé="http://www.w3.org/2000/svg"><gé:script>alert(1)</gé:script></svg>`, /non-ASCII/);
});

test('a non-ASCII prefixed foreignObject fails', () => {
  rejectsSvg(`<svg ${NS} xmlns:é="http://www.w3.org/2000/svg"><é:foreignObject/></svg>`, /non-ASCII/);
});

test('a tag with an empty prefix name fails', () => {
  rejectsSvg(`<svg ${NS}><:script/></svg>`, /tag the check cannot read/);
});

test('a mask element fails', () => {
  rejectsSvg(`<svg ${NS}><mask id="m"/></svg>`, /\(<mask>\)/);
});

test('a url reference inside a clipPath fails', () => {
  rejectsSvg(`<svg ${NS}><defs><clipPath id="c"><rect clip-path="url(#d)"/></clipPath></defs></svg>`, /reference inside a clipPath/);
});

test('a paint reference inside a clipPath fails', () => {
  rejectsSvg(`<svg ${NS}><clipPath><rect fill="url(#g)"/></clipPath></svg>`, /reference inside a clipPath/);
});

test('an href inside a clipPath fails', () => {
  rejectsSvg(`<svg ${NS}><clipPath id="c"><rect href="#a"/></clipPath></svg>`, /reference inside a clipPath/);
});

test('a reference inside a prefixed clipPath fails', () => {
  const body = '<s:clipPath id="c"><rect fill="url(#g)"/></s:clipPath>';
  rejectsSvg(`<svg ${NS} xmlns:s="http://www.w3.org/2000/svg">${body}</svg>`, /reference inside a clipPath/);
});

test('a clipPath used from outside its body passes', () => {
  passesSvg(
    `<svg ${NS}><defs><clipPath id="c"><rect width="1" height="1"/></clipPath></defs>` +
      '<g clip-path="url(#c)"><rect width="2" height="2"/></g></svg>'
  );
});

test('33 internal references fail and 32 pass', () => {
  const refs = n => Array.from({ length: n }, () => '<rect fill="url(#g)"/>').join('');
  passesSvg(`<svg ${NS}><defs><linearGradient id="g"/></defs>${refs(32)}</svg>`);
  rejectsSvg(`<svg ${NS}><defs><linearGradient id="g"/></defs>${refs(33)}</svg>`, /more than 32 internal references/);
});

test('33 mixed internal references fail', () => {
  const forms = ['<linearGradient id="b" href= "#a"/>', '<rect fill="url( #g)"/>', '<rect fill="URL(#g)"/>'];
  const refs = Array.from({ length: 33 }, (_, i) => forms[i % 3]).join('');
  rejectsSvg(`<svg ${NS}><defs><linearGradient id="a"/><linearGradient id="g"/></defs>${refs}</svg>`, /more than 32 internal references/);
});
