# Moonlight Pay - Self-Custodial

Privacy-preserving payment interface where the user controls their own keys.

## How It Works

1. User connects their Freighter wallet
2. P256 keys are derived from the Stellar Ed25519 secret key (via Moonlight SDK)
3. User deposits funds from their public Stellar account into a privacy channel
4. User can send and receive privately within the channel
5. User signs every UTXO spend with their own P256 key
6. User can switch Privacy Providers at any time

## Tech

- Deno, TypeScript
- Stellar Wallets Kit (Freighter, LOBSTR, xBull, WalletConnect)
- Stellar SDK, Moonlight SDK
- P256 key derivation via @noble/curves

## Development

```bash
deno task dev      # Dev server with watch
deno task build    # Production build
deno task test     # Run tests
```

## Deployment

Version bump in `deno.json` triggers the `self-v*` auto-tag workflow, which builds and deploys to the `moonlight-pay-self` Tigris bucket.
