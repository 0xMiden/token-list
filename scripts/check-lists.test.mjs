import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
  return spawnSync('node', [SCRIPT], { cwd: dir, encoding: 'utf8' });
}

const token = (extra = {}) => ({ network: 'testnet', faucetId: ID, symbol: 'MIDEN', name: 'Miden', decimals: 6, ...extra });
const logoPath = (ext = 'svg', id = ID) => `logos/${id}/logo.${ext}`;
const withLogo = (ext = 'svg', id = ID) => token({ logoURI: PREFIX + logoPath(ext, id) });
const svgCase = content => run({ tokens: [withLogo()], files: { [logoPath()]: content } });

const rejects = (result, text) => {
  assert.equal(result.status, 1, result.stderr);
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
  rejects(svgCase('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), /script/);
});

test('an svg with an event handler fails', () => {
  rejects(svgCase('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'), /event handler/);
});

test('an svg linking outside itself fails', () => {
  rejects(svgCase('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/a.png"/></svg>'), /links outside/);
});

test('a png over 256x256 fails', () => {
  const result = run({ tokens: [withLogo('png')], files: { [logoPath('png')]: png(300, 64) } });
  rejects(result, /larger than 256x256/);
});

test('a png without the PNG signature fails', () => {
  const result = run({ tokens: [withLogo('png')], files: { [logoPath('png')]: Buffer.alloc(33) } });
  rejects(result, /is not a PNG/);
});

test('a token on the wrong network fails', () => {
  rejects(run({ tokens: [token({ network: 'devnet' })] }), /has network "devnet"/);
});

test('a duplicate faucet id fails', () => {
  rejects(run({ tokens: [token(), token()] }), /is listed twice/);
});
