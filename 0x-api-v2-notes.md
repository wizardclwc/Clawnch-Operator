# 0x API (v2) — working notes

Source
- Docs: https://0x.org/docs/api
- OpenAPI spec (downloaded): `openapi-0x-v2.yaml`
- Base URL: `https://api.0x.org`

## Authentication / required headers
Most endpoints require:
- `0x-api-key: <YOUR_KEY>`
- `0x-version: v2`

## Main tags / surfaces
### Swap
- `GET /swap/chains` — supported chain IDs for swap.
- AllowanceHolder (recommended allowance path)
  - `GET /swap/allowance-holder/price`
  - `GET /swap/allowance-holder/quote`
- Permit2 (advanced)
  - `GET /swap/permit2/price`
  - `GET /swap/permit2/quote`

Typical params (common):
- `chainId` (required)
- `buyToken` (required, ERC20 address)
- `sellToken` (required, ERC20 address)
- `sellAmount` (required, base units)

Important optional params:
- `taker` — strongly recommended; enables better validation + more accurate gas estimation.
- `recipient` — receive buyToken.
- `slippageBps` — default 100.
- `excludedSources` — comma-separated source names.
- Integrator fees (monetization): `swapFeeRecipient`, `swapFeeBps`, `swapFeeToken`.
- Trade surplus (custom plan): `tradeSurplusRecipient`, `tradeSurplusMaxBps`.
- `sellEntireBalance` — sell full balance (special use-case).

Swap quote response highlights:
- `liquidityAvailable` boolean.
- `issues.allowance` / `issues.balance` for preflight problems.
- `fees` includes `integratorFee(s)`, `zeroExFee`, and sometimes `gasFee`.
- `route` shows fills by source.
- `transaction` includes `{ to, data, value?, gas?, gasPrice? }` to send onchain.

### Gasless
- `GET /gasless/chains`
- `GET /gasless/price`
- `GET /gasless/quote`
- `POST /gasless/submit`
- `GET /gasless/status/{tradeHash}`
- `GET /gasless/gasless-approval-tokens`

Gasless quote response typically includes:
- `approval` object (often permit-style) when approval is needed.
- `trade` object (EIP-712 typed data) for the meta-transaction.

### Trade Analytics
- `GET /trade-analytics/swap`
- `GET /trade-analytics/gasless`

Notes:
- Requires `0x-api-key`.
- Data is tied to the app behind the key.
- Docs mention ~15-minute updates and ~48h finality window.

### Sources
- `GET /sources?chainId=<id>` — list valid liquidity sources (useful for `excludedSources`).

## Operational best practices (from docs)
- Don’t call 0x directly from the browser (CORS + API key exposure). Proxy via backend/serverless.
- Refresh RFQ-sensitive quotes periodically (docs mention ~30s) and handle expiry.
- Always surface and act on `issues.*` and `liquidityAvailable=false`.

## Quick curl examples
Swap (AllowanceHolder) — price:
```bash
curl -sS 'https://api.0x.org/swap/allowance-holder/price?chainId=1&sellToken=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48&buyToken=0xdAC17F958D2ee523a2206206994597C13D831ec7&sellAmount=100000000' \
  -H '0x-api-key: YOUR_KEY' \
  -H '0x-version: v2'
```

Swap (AllowanceHolder) — quote (taker required):
```bash
curl -sS 'https://api.0x.org/swap/allowance-holder/quote?chainId=1&sellToken=...&buyToken=...&sellAmount=...&taker=0xYourAddress' \
  -H '0x-api-key: YOUR_KEY' \
  -H '0x-version: v2'
```

## Next (implementation ideas for this project)
- Build a backend proxy that:
  - injects headers (`0x-api-key`, `0x-version`)
  - normalizes errors
  - caches `/sources` + `/chains`
  - provides a stable internal API for UI/bots/agents
