# Miden token list

The verified tokens for Miden wallets, one list per network. A wallet marks a token whose faucet ID is missing from its network's list as **Unverified**: anyone can create a token with any name, symbol and logo, and this list is what vouches for one.

| Network | File |
|---|---|
| Mainnet | [`mainnet.json`](mainnet.json) |
| Testnet | [`testnet.json`](testnet.json) |

The devnet list is added when there are tokens to list.

## Format

The [tokenlists.org](https://tokenlists.org) shape, adapted to Miden: `chainId` is replaced by `network` and `address` by `faucetId`. [`token-list.schema.json`](token-list.schema.json) defines it.

```json
{
  "name": "Miden Testnet Verified Tokens",
  "timestamp": "2026-10-07T00:00:00.000Z",
  "version": { "major": 1, "minor": 0, "patch": 1 },
  "keywords": ["miden", "testnet"],
  "tokens": [
    { "network": "testnet", "faucetId": "mtst1aqvpq8a9ytqhfvt9al20wzsrs56g83ec", "symbol": "MIDEN", "name": "Miden", "decimals": 6, "logoURI": "https://raw.githubusercontent.com/0xMiden/token-list/main/logos/mtst1aqvpq8a9ytqhfvt9al20wzsrs56g83ec/logo.png" }
  ]
}
```

- `faucetId` is the faucet account's bech32 ID, without a routing suffix (no `_...` part).
- `symbol` and `decimals` are the faucet's on-chain metadata.
- `binanceAsset` is optional: the exchange asset whose USD market prices the token when it is not the symbol (`WBNB` is priced as `BNB`). Without it a wallet prices the token under its symbol.
- `basket` is optional: for a token whose faucet account is also the public vault that backs it. `constituents` lists the faucet IDs of the tokens that make up its value (1 to 12, each listed in the same file, none of them a basket, not the token itself). A wallet prices one unit from chain state alone: it reads the faucet account's vault balance of each constituent and the faucet's total supply, prices each constituent as it prices that token, and divides the vault's value by the supply. Any other asset in the vault (a fee float, a donation) is not counted. Each constituent's share of that value is the basket's composition. Example: `"basket": { "constituents": ["mm1...", "mm1..."] }`.
- Every token's `network` matches its file name, and a faucet ID appears once per list.

## Logos

A token may carry a `logoURI`, which must be `https://raw.githubusercontent.com/0xMiden/token-list/main/logos/<faucetId>/logo.png` for its own faucet ID, with the file in this repository. CI checks the path, that the file exists as a regular file (no symlink, in the file or any directory above it), that it is a PNG of at most 32 KiB, and that it is square and at most 256x256. A logo is a complete square mark with its own background, since wallets draw it as is inside a circle.

## Adding a token

Open a pull request that adds the token to its network's file, bumps `version` (minor for an addition, major for a removal, patch for a change to a listed token, its logo included) and updates `timestamp`. CI validates the list against the schema and the rules above. A maintainer of the Miden team reviews every change.

Bridged assets are listed once their Miden faucets exist on the network.

## How wallets use it

The Miden wallet fetches `https://raw.githubusercontent.com/0xMiden/token-list/main/<network>.json`, keeps the last good copy for a day, and ships a snapshot of this repository with each release for offline use. A network without a list shows no marks. The network's native (fee) token is always treated as verified.
