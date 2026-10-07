import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-lists.mjs');
const PREFIX = 'https://raw.githubusercontent.com/0xMiden/token-list/main/';
const ID = 'mtst1aqvpq8a9ytqhfvt9al20wzsrs56g83ec';
const OTHER = 'mtst1arqxg9er3xclayt95nud82jnpggl9azj';
const MAX_BYTES = 32 * 1024;

const png = (width, height) => {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
};
const pngOfSize = size => Buffer.concat([png(64, 64), Buffer.alloc(size - 33)]);

// Builds a temporary repo with a testnet.json, the given files, directories and symlinks (path to
// target, both relative to the repo), runs the checks in it.
function run({ tokens, files = {}, dirs = [], links = {}, timeout = 10_000 }) {
  const dir = mkdtempSync(join(tmpdir(), 'check-lists-'));
  writeFileSync(join(dir, 'testnet.json'), JSON.stringify({ tokens }));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  for (const path of dirs) mkdirSync(join(dir, path), { recursive: true });
  for (const [path, target] of Object.entries(links)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    symlinkSync(join(dir, target), join(dir, path));
  }
  try {
    const result = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8', timeout });
    if (result.error?.code === 'ETIMEDOUT') throw new Error('check timed out');
    if (result.error) throw result.error;
    return result;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const token = (extra = {}) => ({ network: 'testnet', faucetId: ID, symbol: 'MIDEN', name: 'Miden', decimals: 6, ...extra });
const logoPath = (ext = 'png', id = ID) => `logos/${id}/logo.${ext}`;
const withLogo = (ext = 'png', id = ID) => token({ logoURI: PREFIX + logoPath(ext, id) });
const pngCase = (content, timeout) => run({ tokens: [withLogo()], files: { [logoPath()]: content }, timeout });

const rejects = (result, text) => {
  assert.equal(result.status, 1, result.stderr);
  assert.doesNotMatch(result.stderr, /\n\s+at /, 'no stack trace');
  assert.match(result.stderr, text);
};

test('a valid 64x64 png logo passes', () => {
  const result = pngCase(png(64, 64));
  assert.equal(result.status, 0, result.stderr);
});

test('a token without a logo passes', () => {
  assert.equal(run({ tokens: [token()] }).status, 0);
});

test('a logoURI naming another faucet id fails', () => {
  const tokens = [token({ logoURI: PREFIX + logoPath('png', OTHER) })];
  rejects(run({ tokens, files: { [logoPath('png', OTHER)]: png(64, 64) } }), /names another faucet/);
});

test('a logoURI outside this repository fails', () => {
  const tokens = [token({ logoURI: 'https://example.com/logo.png' })];
  rejects(run({ tokens }), /not a logo in this repository/);
});

test('a logoURI ending in logo.svg fails', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="32"/></svg>';
  const tokens = [withLogo('svg')];
  rejects(run({ tokens, files: { [logoPath('svg')]: svg } }), /not a logo in this repository/);
});

test('a missing logo file fails', () => {
  rejects(run({ tokens: [withLogo()] }), /missing/);
});

test('a logo of exactly 32 KiB passes and one byte over fails', () => {
  assert.equal(pngCase(pngOfSize(MAX_BYTES)).status, 0);
  rejects(pngCase(pngOfSize(MAX_BYTES + 1)), /too large/);
});

test('a png over 256x256 fails', () => {
  rejects(pngCase(png(300, 64)), /larger than 256x256/);
});

test('a png taller than 256 fails', () => {
  rejects(pngCase(png(64, 300)), /larger than 256x256/);
});

test('a png of exactly 256x256 passes and one side over fails', () => {
  assert.equal(pngCase(png(256, 256)).status, 0);
  rejects(pngCase(png(257, 256)), /larger than 256x256/);
  rejects(pngCase(png(256, 257)), /larger than 256x256/);
});

test('a png without the PNG signature fails', () => {
  const bytes = png(64, 64);
  bytes[0] ^= 0xff;
  rejects(pngCase(bytes), /is not a PNG/);
});

test('a truncated png fails cleanly', () => {
  rejects(pngCase(png(64, 64).subarray(0, 20)), /is not a PNG/);
});

test('a png without an IHDR chunk fails', () => {
  const bytes = png(64, 64);
  bytes.write('IDAT', 12);
  rejects(pngCase(bytes), /is not a PNG/);
});

test('a null logoURI fails cleanly', () => {
  rejects(run({ tokens: [token({ logoURI: null })] }), /logoURI is not a string/);
});

test('a numeric logoURI fails cleanly', () => {
  rejects(run({ tokens: [token({ logoURI: 5 })] }), /logoURI is not a string/);
});

test('a token on the wrong network fails', () => {
  rejects(run({ tokens: [token({ network: 'devnet' })] }), /has network "devnet"/);
});

test('a duplicate faucet id fails', () => {
  rejects(run({ tokens: [token(), token()] }), /is listed twice/);
});

test('a spawn timeout is reported as a timeout', () => {
  assert.throws(() => pngCase(png(64, 64), 1), /check timed out/);
});

test('a logo that is a symlink fails', () => {
  const files = { 'elsewhere.png': png(64, 64) };
  const links = { [logoPath()]: 'elsewhere.png' };
  rejects(run({ tokens: [withLogo()], files, links }), /not a regular file/);
});

test('a logo that is a directory fails', () => {
  rejects(run({ tokens: [withLogo()], dirs: [logoPath()] }), /not a regular file/);
});

test('a faucet directory that is a symlink fails', () => {
  const files = { [logoPath('png', OTHER)]: png(64, 64) };
  const links = { [`logos/${ID}`]: `logos/${OTHER}` };
  rejects(run({ tokens: [withLogo()], files, links }), /not a regular file/);
});

test('a png with a zero side fails', () => {
  rejects(pngCase(png(0, 0)), /not a square image/);
});

test('a png that is not square fails', () => {
  rejects(pngCase(png(256, 128)), /not a square image/);
});

test('a png whose IHDR length is not 13 fails', () => {
  const bytes = png(64, 64);
  bytes.writeUInt32BE(12, 8);
  rejects(pngCase(bytes), /is not a PNG/);
});

test('a valid square png passes', () => {
  assert.equal(pngCase(png(64, 64)).status, 0);
  assert.equal(pngCase(png(256, 256)).status, 0);
});

test('a logo under a regular file fails cleanly and later tokens are still checked', () => {
  const second = token({ faucetId: OTHER, logoURI: PREFIX + logoPath('png', OTHER) });
  const files = { [`logos/${ID}`]: 'not a directory', [logoPath('png', OTHER)]: png(300, 64) };
  const result = run({ tokens: [withLogo(), second], files });
  rejects(result, /missing/);
  assert.match(result.stderr, /larger than 256x256/);
});
