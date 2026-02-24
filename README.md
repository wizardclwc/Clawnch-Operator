# Clawnch Operator

A production-oriented operator console for Clawnch workflows on Base:

- Token launch (via `@clawnch/clawncher-sdk`)
- Copytrade bot controls (start/stop/restart/config save/emergency stop)
- Fee check + claim
- Realtime logs + executed trades

## Stack

- Next.js 16 (App Router)
- React 19
- `viem`
- `@clawnch/clawncher-sdk`

## Local setup

```bash
pnpm install
cp .env.local.example .env.local
cp bot/.env.copytrade.example .env.copytrade
pnpm dev
```

Open:
- `http://localhost:3000/operator`
- `http://localhost:3000/copytrade`

## Operator API security

Sensitive operator endpoints can be protected using a token header.

Set in `.env.local`:

```bash
OPERATOR_API_TOKEN=your_secret_token
OPERATOR_BASE_RPC_URL=https://mainnet.base.org
```

Send this header in operator API requests:

```http
x-operator-token: your_secret_token
```

If `OPERATOR_API_TOKEN` is empty, auth guard is disabled (useful for internal development only).

## Copytrade runtime notes

The copytrade bot runs as a separate Node process (`bot/copytrade-base.js`).
Control endpoints:

- `GET /api/operator/copytrade/control` (status)
- `POST /api/operator/copytrade/control` with actions:
  - `saveConfig`
  - `start`
  - `stop`
  - `restart`
  - `emergencyStop`

`emergencyStop` will:
1) stop the bot process,
2) force `DRY_RUN=true` in `.env.copytrade`.

## Important

- Never commit private keys, seed phrases, or wallet files.
- Use a dedicated burner wallet for launch/copytrade operations.
- Always test with `DRY_RUN=true` before enabling live execution.
