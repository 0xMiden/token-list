# Miden token list

The verified tokens for Miden wallets, one list per network. A wallet marks a token whose faucet ID is missing from its network's list as **Unverified**: anyone can create a token with any name, symbol and logo, and this list is what vouches for one.

| Network | File |
|---|---|
| Testnet | [`testnet.json`](testnet.json) |

Devnet and mainnet lists are added when there are tokens to list.

## Format

The [tokenlists.org](https://tokenlists.org) shape, adapted to Miden: `chainId` is replaced by `network` and `address` by `faucetId`. [`token-list.schema.json`](token-list.schema.json) defines it.

```json
{
  "name": "Miden Testnet Verified Tokens",
  "timestamp": "2026-10-07T00:00:00.000Z",
  "version": { "major": 1, "minor": 0, "patch": 1 },
  "keywords": ["miden", "testnet"],
  "tokens": [
    { "network": "testnet", "faucetId": "mtst1aqvpq8a9ytqhfvt9al20wzsrs56g83ec", "symbol": "MIDEN", "name": "Miden", "decimals": 6, "logoURI": "https://raw.githubusercontent.com/0xMiden/token-list/main/logos/mtst1aqvpq8a9ytqhfvt9al20wzsrs56g83ec/logo.svg" }
  ]
}
```

- `faucetId` is the faucet account's bech32 ID, without a routing suffix (no `_...` part).
- `symbol` and `decimals` are the faucet's on-chain metadata.
- Every token's `network` matches its file name, and a faucet ID appears once per list.

## Logos

A token may carry a `logoURI`, which must be `https://raw.githubusercontent.com/0xMiden/token-list/main/logos/<faucetId>/logo.svg` (or `.png`) for its own faucet ID, with the file in this repository. CI checks the path, that the file exists, that it is at most 32 KiB, that a PNG is at most 256x256, and that an SVG logo is a flat mark in ASCII text, every tag an ASCII name the check can read: only these elements (with or without a namespace prefix): `svg`, `g`, `defs`, `path`, `circle`, `ellipse`, `rect`, `line`, `polyline`, `polygon`, `linearGradient`, `radialGradient`, `stop`, `clipPath`, `title`, `desc`, `text` and `tspan` (so no use, symbol, mask, script, foreignObject, style, image, animation or filter element); no event handler, `style` attribute, character or entity reference or backslash; every `href` (and `xlink:href`) a quoted `#` fragment, no CSS `url()` that leaves the file (only a `#` fragment), no `@import`, `image-set()` or `src()`; no `href` or `url()` inside a `clipPath`, no `clipPath` inside a `clipPath`, every non-empty `clipPath` closed by its own end tag (same case); no comment, CDATA section or processing instruction after the root starts, no `<` or `>` inside an attribute value, and every attribute value quoted (so the `clipPath` check reads the real body); at most 32 internal references (`href="#..."` and `url(#...)`); and before the root only the XML declaration, comments and a DOCTYPE without an internal subset (so no entity or other declaration and no processing instruction). A logo is a complete square mark with its own background, since wallets draw it as is inside a circle.

## Adding a token

Open a pull request that adds the token to its network's file, bumps `version` (minor for an addition, major for a removal, patch for a change to a listed token, its logo included) and updates `timestamp`. CI validates the list against the schema and the rules above. A maintainer of the Miden team reviews every change.

Bridged assets are listed once their Miden faucets exist on the network.

## How wallets use it

The Miden wallet fetches `https://raw.githubusercontent.com/0xMiden/token-list/main/<network>.json`, keeps the last good copy for a day, and ships a snapshot of this repository with each release for offline use. A network without a list shows no marks. The network's native (fee) token is always treated as verified.
