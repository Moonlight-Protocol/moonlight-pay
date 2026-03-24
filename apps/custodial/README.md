# Moonlight Pay - Custodial

Privacy-preserving payment interface where the Council platform manages keys on behalf of the user.

## How It Works

1. User logs in with username and password
2. Council platform derives and holds P256 keys for the user
3. User gets a deposit address for receiving funds
4. User can send, receive, and view balances
5. The user never touches keys, wallets, or the underlying protocol
6. Privacy Provider removal does not affect funds (any PP in the council can operate)

## Tech

- Deno, TypeScript
- Shared modules from `../../shared/`

## Development

```bash
deno task dev      # Dev server with watch
deno task build    # Production build
deno task test     # Run tests
```

## Deployment

Version bump in `deno.json` triggers the `custodial-v*` auto-tag workflow, which builds and deploys to the `moonlight-pay-custodial` Tigris bucket.
