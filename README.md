# Moonlight Pay

End-user web app for Moonlight Protocol. Connect a Stellar wallet, create a pay account, and manage your jurisdiction / email / display name. Backed by [pay-platform](https://github.com/Moonlight-Protocol/pay-platform).

## What it does

- **Wallet sign-in**: Connect via Freighter (other SEP-43 wallets are wired via `sep43Modules()` and pickable from the wallets-kit modal). Wallet public key is the user's identity.
- **Master seed**: A single wallet signature derives an in-memory master seed (SHA-256 of the signature bytes). The seed never touches storage; tabs share it via `BroadcastChannel`. Re-derive on tab refresh.
- **Pay account**: Email + ISO 3166-1 jurisdiction + display name, captured at signup. Stored in pay-platform's Postgres, identified by wallet public key.
- **Account management**: Edit jurisdiction / email / display name from the home view.

## Development

```bash
# Build the app bundle
deno task build

# Start dev server (port 3050)
deno task dev

# Run unit tests
deno task test

# Lint / typecheck / format
deno task lint
deno task check
deno task fmt:check
```

The dev server reads `public/config.js` for the pay-platform URL. Local-dev's `up.sh` does NOT yet generate this — for now, edit `public/config.js` manually to point at `http://localhost:3025` (or whatever port pay-platform is on) before `deno task dev`. The repo ships a testnet default.

## Architecture

```
Browser
  ├── Wallet (sep43Modules) ── signs the master message + auth challenges
  ├── pay-platform ── account CRUD, JWT-based auth
  └── BroadcastChannel ── shares the master seed across same-origin tabs
```

Static SPA (no backend). All API calls go to pay-platform. The Stellar SDK is bundled but not used directly from the frontend — the wallets-kit handles all wallet interactions internally.

## Source layout

```
src/
  app.ts               # router setup + landing logic
  build.ts             # esbuild + denoPlugins build script
  server.ts            # static file server (dev only)
  shims/buffer.ts      # Buffer polyfill installed via inject
  components/
    nav.ts             # top nav + logout button
    page.ts            # auth-gated wrapper for routed views
  lib/
    api.ts             # pay-platform HTTP client (auth + account CRUD)
    config.ts          # window.__PAY_CONFIG__ accessor (lazy + memoized)
    dom.ts             # safe DOM helpers (escapeHtml, friendlyError, …)
    encoding.ts        # base64url decoder (handles unpadded SEP-43 sigs)
    jurisdictions.ts   # ISO 3166-1 alpha-2 country list
    router.ts          # hash router with token-bound concurrency + cleanups
    wallet.ts          # stellar-wallets-kit orchestration (connect, sign)
    wallet-state.ts    # cached address, master seed lifecycle, BroadcastChannel
  views/
    home.ts            # account display + edit
    login.ts           # connect wallet → derive seed → authenticate → signup
```

## Security model

- **Master seed**: in-memory only, never persisted. Re-derived from a wallet signature on each tab. Cross-tab share via `BroadcastChannel` (in-memory, never localStorage). Zeroed on logout.
- **JWT**: persisted in `localStorage` (`moonlight_pay_jwt`). Cross-tab logout via the `storage` event invalidates the cached token in other tabs.
- **CSP**: the dev server (`src/server.ts`) emits a CSP HTTP header. Production goes through a flat Tigris bucket with no proxy in front, so no CSP runs in prod — same gap as the council/provider consoles, accepted.

## Deployment

Static files are deployed to a public [Tigris](https://www.tigrisdata.com/) bucket on Fly.io. Same pattern as `council-console` and `provider-console`.

- **Bucket**: `moonlight-pay`
- **Auto-deploy**: pushing a tag matching `v[0-9]*` triggers `.github/workflows/deploy.yml`
- **Pipeline**: a `verify` job re-runs check / lint / fmt:check / test / build --production against the tagged commit before the deploy job runs, then a single `aws s3 sync ... --delete` ships the bundle

```
push v0.1.0 tag → verify (CI re-run) → deploy
                                       ├── generate config.js from secrets
                                       ├── build --production
                                       └── aws s3 sync public/ s3://moonlight-pay/ --delete
```

## GitHub Secrets

Required for CI:

| Secret | Purpose |
|---|---|
| `AUTO_VERSION_TOKEN` | PAT for auto-version.yml to push tags past branch protection |
| `TIGRIS_ACCESS_KEY_ID` | Tigris bucket upload |
| `TIGRIS_SECRET_ACCESS_KEY` | Tigris bucket upload |
| `PAY_PLATFORM_URL` | Production pay-platform URL (injected into config.js + CSP) |
| `STELLAR_NETWORK` | `testnet` / `mainnet` / `standalone` |

## Known constraints

- **macOS build**: do NOT regenerate `deno.lock` from scratch on macOS. The committed lock pins `@creit.tech/stellar-wallets-kit` to a short-path resolution. Re-resolving pulls a transitive tree (near-api-js, react, multiple bufferutil/typescript variants) that produces a cache directory path > 255 chars and breaks the build with `os error 63`. The `stellar-sdk` entry in `deno.json` looks unused but is load-bearing — it constrains the kit's `@stellar/stellar-sdk` peer dep. See the comment block in `src/build.ts` for full details.
- **No `X-Content-Type-Options` in production**: Tigris doesn't run a proxy that could set the header, and meta tags can't substitute. Mitigated by always serving correct `Content-Type` (aws s3 sync derives it from the file extension).
