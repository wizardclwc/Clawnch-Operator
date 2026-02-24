# Base CopyTrade Bot (0x API)

This bot watches a target wallet on Base (directly from RPC/block receipts), then mirrors token buys using the 0x API.

Default target:
- `0x2ACaC49b7920D80C3C329E30ca93D0C4b4849eC6`

## How it works

1. Poll Base blocks from RPC, fetch transactions sent by the target wallet, and inspect `Transfer` logs on receipts (more compatible with public RPC providers).
2. Treat a transaction as a buy signal when:
   - the target wallet receives tokens,
   - the hash belongs to a transaction sent by the watched wallet (`tx.from == WATCH_ADDRESS`),
   - the transaction status is successful.
3. Request a `buy token with ETH` quote from 0x.
4. Execute on follower wallet (or log-only when `DRY_RUN=true`).

## Setup

```bash
cd <project-root>/clawnch-operator
cp bot/.env.copytrade.example .env.copytrade
# fill API key + burner private key (EVM/Base, not Solana)
```

## Run

```bash
set -a
source .env.copytrade
set +a
node bot/copytrade-base.js
```

## PM2 (optional)

```bash
cd <project-root>/clawnch-operator
set -a; source .env.copytrade; set +a
pm2 start bot/copytrade-base.js --name copytrade-base --time
pm2 save
```

## Built-in guardrails

- `DRY_RUN=true` by default (safe mode, no on-chain tx)
- `COOLDOWN_SECONDS`
- `MAX_TRADES_PER_HOUR`
- `IGNORE_TOKENS`
- hash+token deduplication (state file)

## Important notes

- This is still high-risk: on-chain transfer signals are not 100% equivalent to clean buy intent (could be transfer/airdrop/manual movement).
- Always use a burner wallet.
- Start with small size first (e.g. `TRADE_ETH_AMOUNT=0.001`).
