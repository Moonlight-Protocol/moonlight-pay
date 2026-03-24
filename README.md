# Moonlight Pay

Monorepo with two apps that demonstrate Moonlight Protocol's privacy-preserving payment flows on Stellar.

## Apps

### [Self-Custodial](apps/self/)

User controls their own keys. Connects via Freighter wallet, derives P256 keys from the Stellar Ed25519 secret key, and signs UTXO spends directly. The user can switch Privacy Providers freely.

### [Custodial](apps/custodial/)

User logs in with username and password. The Council platform derives and holds P256 keys on behalf of the user. The user sees balances and can send/receive without managing keys or understanding the underlying protocol.

## Shared

Common code used by both apps: API client, analytics, UI components (transaction list, error report, demo tab), and shared types.

## Development

```bash
# Self-custodial
cd apps/self && deno task dev

# Custodial
cd apps/custodial && deno task dev
```

## Deployment

Each app deploys independently to Tigris (Fly.io static hosting).

- Version bump in `apps/self/deno.json` triggers `self-v*` tag and deploys to `moonlight-pay-self` bucket
- Version bump in `apps/custodial/deno.json` triggers `custodial-v*` tag and deploys to `moonlight-pay-custodial` bucket

Live:
- Self-custodial: https://moonlight-pay-self.fly.storage.tigris.dev/index.html
- Custodial: https://moonlight-pay-custodial.fly.storage.tigris.dev/index.html

## License

MIT
