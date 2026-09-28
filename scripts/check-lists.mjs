// Checks the rules the JSON Schema cannot express: each token's network matches its file name,
// and no faucet id appears twice in one list.
import { readFileSync, readdirSync } from 'node:fs';

const NETWORKS = new Set(['mainnet', 'testnet', 'devnet']);
let failed = false;
const fail = message => {
  console.error(message);
  failed = true;
};

for (const file of readdirSync('.').filter(name => NETWORKS.has(name.replace(/\.json$/, '')))) {
  const network = file.replace(/\.json$/, '');
  const { tokens } = JSON.parse(readFileSync(file, 'utf8'));
  const seen = new Set();
  for (const token of tokens) {
    if (token.network !== network) fail(`${file}: ${token.faucetId} has network "${token.network}"`);
    if (seen.has(token.faucetId)) fail(`${file}: ${token.faucetId} is listed twice`);
    seen.add(token.faucetId);
  }
}

process.exit(failed ? 1 : 0);
