#!/usr/bin/env node
/*
  Copy-trade watcher for Base (RPC logs + 0x API)
  - Monitor WATCH_ADDRESS on-chain ERC20 Transfer logs
  - Mirror BUY: target receives token -> follower buys token with ETH
  - Mirror SELL: target sends token -> follower sells held token back to ETH

  IMPORTANT:
  - Default DRY_RUN=true (no real tx)
  - High risk. Use burner wallet + strict limits.
*/

const fs = require('fs');
const path = require('path');
const { createWalletClient, createPublicClient, http, parseEther, maxUint256 } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { base } = require('viem/chains');

const ETH_PLACEHOLDER = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
// keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const DEFAULT_STATE_FILE = path.resolve(process.cwd(), 'bot', 'copytrade-state.json');

const ERC20_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
];

function env(name, fallback = undefined) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function toBool(v, fallback = false) {
  if (v === undefined || v === null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function toNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toBigInt(v, fallback) {
  const s = String(v ?? '').trim();
  if (!/^[0-9]+$/.test(s)) return fallback;
  try {
    return BigInt(s);
  } catch {
    return fallback;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeAddr(a) {
  return String(a || '').toLowerCase();
}

function isHexAddress(a) {
  return /^0x[0-9a-fA-F]{40}$/.test(String(a || ''));
}

function readJsonSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonSafe(file, value) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function nowIso() {
  return new Date().toISOString();
}

function log(...args) {
  console.log(`[${nowIso()}]`, ...args);
}

function topicForAddress(addr) {
  return `0x${'0'.repeat(24)}${normalizeAddr(addr).slice(2)}`;
}

function buildState(stateFile) {
  const raw = readJsonSafe(stateFile, null);
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    seen: Array.isArray(s.seen) ? s.seen : [],
    trades: Array.isArray(s.trades) ? s.trades : [],
    lastRunAt: s.lastRunAt || null,
    lastScannedBlock: typeof s.lastScannedBlock === 'number' ? s.lastScannedBlock : null,
  };
}

function persistState(stateFile, state) {
  const trimmed = {
    seen: state.seen.slice(-20000),
    trades: state.trades.slice(-2000),
    lastRunAt: nowIso(),
    lastScannedBlock: state.lastScannedBlock,
  };
  writeJsonSafe(stateFile, trimmed);
}

function isTradeAllowedByRate(state, { maxTradesPerHour, cooldownSec }) {
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const recent = state.trades.filter((t) => t.tsMs >= hourAgo);
  if (recent.length >= maxTradesPerHour) {
    return { ok: false, reason: `maxTradesPerHour reached (${maxTradesPerHour})` };
  }
  const last = state.trades[state.trades.length - 1];
  if (last && now - last.tsMs < cooldownSec * 1000) {
    return { ok: false, reason: `cooldown ${cooldownSec}s` };
  }
  return { ok: true };
}

async function get0xQuote({ apiKey, taker, sellToken, buyToken, sellAmount, slippageBps }) {
  const u = new URL('https://api.0x.org/swap/allowance-holder/quote');
  u.searchParams.set('chainId', '8453');
  u.searchParams.set('sellToken', sellToken);
  u.searchParams.set('buyToken', buyToken);
  u.searchParams.set('sellAmount', String(sellAmount));
  u.searchParams.set('taker', taker);
  u.searchParams.set('slippageBps', String(slippageBps));

  const res = await fetch(u.toString(), {
    headers: {
      '0x-api-key': apiKey,
      '0x-version': 'v2',
      accept: 'application/json',
    },
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`0x invalid JSON: ${text.slice(0, 180)}`);
  }

  if (!res.ok) {
    throw new Error(`0x quote ${res.status}: ${JSON.stringify(data).slice(0, 220)}`);
  }

  return data;
}

async function ensureAllowance({ publicClient, walletClient, account, token, spender, requiredAmount }) {
  let allowance = 0n;
  try {
    allowance = await publicClient.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [account.address, spender],
    });
  } catch (e) {
    throw new Error(`allowance read failed: ${String(e?.message || e)}`);
  }

  if (allowance >= requiredAmount) return null;

  const approveTx = await walletClient.writeContract({
    account,
    chain: base,
    address: token,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [spender, maxUint256],
  });

  const rec = await publicClient.waitForTransactionReceipt({ hash: approveTx });
  if (rec.status !== 'success') {
    throw new Error(`approve failed: ${approveTx}`);
  }

  return approveTx;
}

function parsePrivateKey({ envKey, keyFile }) {
  let pk = envKey;
  if (!pk && keyFile) {
    try {
      const raw = fs.readFileSync(keyFile, 'utf8').trim();
      if (raw.startsWith('{')) {
        const j = JSON.parse(raw);
        pk = j.privateKey || j.pk || '';
      } else {
        pk = raw;
      }
      if (pk && !String(pk).startsWith('0x')) pk = `0x${pk}`;
    } catch {
      // ignore, validated below
    }
  }
  return pk;
}

async function run() {
  const WATCH_ADDRESS = env('WATCH_ADDRESS');
  const OX_API_KEY = env('OX_API_KEY');
  const FOLLOWER_PRIVATE_KEY = parsePrivateKey({
    envKey: env('FOLLOWER_PRIVATE_KEY'),
    keyFile: env('FOLLOWER_PRIVATE_KEY_FILE'),
  });

  if (!isHexAddress(WATCH_ADDRESS)) throw new Error('WATCH_ADDRESS invalid/missing');
  if (!OX_API_KEY) throw new Error('OX_API_KEY missing');
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(FOLLOWER_PRIVATE_KEY || ''))) {
    throw new Error('FOLLOWER_PRIVATE_KEY invalid/missing (needs 0x + 64 hex)');
  }

  const DRY_RUN = toBool(env('DRY_RUN', 'true'), true);
  const BASE_RPC_URL = env('BASE_RPC_URL', 'https://mainnet.base.org');
  const POLL_SECONDS = Math.max(5, toNum(env('POLL_SECONDS', '10'), 10));
  const TRADE_ETH_AMOUNT = env('TRADE_ETH_AMOUNT', '0.0002');
  const SLIPPAGE_BPS = Math.max(10, Math.min(5000, toNum(env('SLIPPAGE_BPS', '250'), 250)));
  const COOLDOWN_SECONDS = Math.max(10, toNum(env('COOLDOWN_SECONDS', '45'), 45));
  const MAX_TRADES_PER_HOUR = Math.max(1, toNum(env('MAX_TRADES_PER_HOUR', '20'), 20));
  const START_LOOKBACK_BLOCKS = Math.max(1, toNum(env('START_LOOKBACK_BLOCKS', '8'), 8));
  const MAX_BLOCK_SCAN_PER_CYCLE = Math.max(1, toNum(env('MAX_BLOCK_SCAN_PER_CYCLE', '20'), 20));
  const STATE_FILE = env('STATE_FILE', DEFAULT_STATE_FILE);

  // Auto-sell controls
  const AUTO_SELL_ENABLED = toBool(env('AUTO_SELL_ENABLED', 'true'), true);
  const AUTO_SELL_BPS = Math.max(1, Math.min(10000, toNum(env('AUTO_SELL_BPS', '10000'), 10000)));
  const MIN_SELL_TOKEN_RAW = toBigInt(env('MIN_SELL_TOKEN_RAW', '1'), 1n);

  const IGNORE_TOKENS = String(env('IGNORE_TOKENS', ''))
    .split(',')
    .map((x) => normalizeAddr(x.trim()))
    .filter(Boolean);

  const watch = normalizeAddr(WATCH_ADDRESS);
  const watchTopic = topicForAddress(WATCH_ADDRESS);

  const account = privateKeyToAccount(FOLLOWER_PRIVATE_KEY);
  const walletClient = createWalletClient({ account, chain: base, transport: http(BASE_RPC_URL) });
  const publicClient = createPublicClient({ chain: base, transport: http(BASE_RPC_URL) });

  const state = buildState(STATE_FILE);

  log('copytrade start', {
    watch: WATCH_ADDRESS,
    follower: account.address,
    dryRun: DRY_RUN,
    pollSec: POLL_SECONDS,
    tradeEth: TRADE_ETH_AMOUNT,
    autoSellEnabled: AUTO_SELL_ENABLED,
    autoSellBps: AUTO_SELL_BPS,
    stateFile: path.basename(STATE_FILE),
  });

  while (true) {
    try {
      const latest = Number(await publicClient.getBlockNumber());
      if (!Number.isFinite(latest) || latest <= 0) throw new Error('invalid latest block');

      let fromBlock;
      if (state.lastScannedBlock == null) {
        fromBlock = Math.max(0, latest - START_LOOKBACK_BLOCKS);
      } else {
        fromBlock = state.lastScannedBlock + 1;
      }

      if (fromBlock <= latest) {
        const toBlock = Math.min(latest, fromBlock + MAX_BLOCK_SCAN_PER_CYCLE - 1);

        for (let b = fromBlock; b <= toBlock; b++) {
          let block;
          try {
            block = await publicClient.getBlock({
              blockNumber: BigInt(b),
              includeTransactions: true,
            });
          } catch (e) {
            log('block fetch failed', b, String(e.message || e));
            continue;
          }

          const txs = Array.isArray(block?.transactions) ? block.transactions : [];

          for (const tx of txs) {
            if (!tx || typeof tx === 'string') continue;
            if (normalizeAddr(tx.from) !== watch) continue;
            if (!tx.hash) continue;

            let receipt;
            try {
              receipt = await publicClient.getTransactionReceipt({ hash: tx.hash });
            } catch {
              continue;
            }
            if (!receipt || receipt.status !== 'success') continue;

            const rlogs = Array.isArray(receipt.logs) ? receipt.logs : [];
            for (const lg of rlogs) {
              const topics = Array.isArray(lg.topics) ? lg.topics.map((t) => normalizeAddr(t)) : [];
              const hash = normalizeAddr(lg.transactionHash || tx.hash);
              const token = normalizeAddr(lg.address);

              if (!hash || !token) continue;
              if (topics[0] !== normalizeAddr(TRANSFER_TOPIC)) continue;

              const isBuySignal = topics[2] === watchTopic;
              const isSellSignal = topics[1] === watchTopic;

              // Ignore self-transfer style edge cases.
              if (isBuySignal && isSellSignal) continue;

              let side = null;
              if (isBuySignal) side = 'buy';
              if (isSellSignal) side = 'sell';
              if (!side) continue;

              if (side === 'sell' && !AUTO_SELL_ENABLED) continue;

              const dedupKey = `${hash}:${token}:${side}`;
              if (state.seen.includes(dedupKey)) continue;
              state.seen.push(dedupKey);

              if (IGNORE_TOKENS.includes(token)) {
                log('skip ignored token', token, hash, side);
                continue;
              }

              let signalAmount = 0n;
              try {
                signalAmount = BigInt(lg.data || '0x0');
              } catch {
                continue;
              }
              if (signalAmount <= 0n) continue;

              const gate = isTradeAllowedByRate(state, {
                maxTradesPerHour: MAX_TRADES_PER_HOUR,
                cooldownSec: COOLDOWN_SECONDS,
              });
              if (!gate.ok) {
                log('rate limit gate', gate.reason, 'for', token, hash, side);
                continue;
              }

              if (side === 'buy') {
                const sellAmountWei = parseEther(TRADE_ETH_AMOUNT).toString();
                log('buy signal detected', {
                  watchedHash: tx.hash,
                  token: lg.address,
                  amount: signalAmount.toString(),
                  block: b,
                });

                let quote;
                try {
                  quote = await get0xQuote({
                    apiKey: OX_API_KEY,
                    taker: account.address,
                    sellToken: ETH_PLACEHOLDER,
                    buyToken: lg.address,
                    sellAmount: sellAmountWei,
                    slippageBps: SLIPPAGE_BPS,
                  });
                } catch (e) {
                  log('buy quote failed', String(e.message || e));
                  continue;
                }

                const txTo = quote?.transaction?.to;
                const txData = quote?.transaction?.data;
                const txValue = quote?.transaction?.value ?? sellAmountWei;
                if (!txTo || !txData) {
                  log('skip invalid buy quote payload');
                  continue;
                }

                if (DRY_RUN) {
                  log('DRY_RUN mirror buy', {
                    token: lg.address,
                    sellEth: TRADE_ETH_AMOUNT,
                    buyAmount: quote?.buyAmount,
                    minBuyAmount: quote?.minBuyAmount,
                    watchedHash: tx.hash,
                  });

                  state.trades.push({
                    tsMs: Date.now(),
                    side: 'buy',
                    dryRun: true,
                    token: lg.address,
                    watchedHash: tx.hash,
                    signalAmount: signalAmount.toString(),
                    quoteBuyAmount: quote?.buyAmount,
                  });
                  persistState(STATE_FILE, state);
                  continue;
                }

                try {
                  const sent = await walletClient.sendTransaction({
                    account,
                    chain: base,
                    to: txTo,
                    data: txData,
                    value: BigInt(String(txValue)),
                  });

                  const rec = await publicClient.waitForTransactionReceipt({ hash: sent });

                  log('MIRROR_BUY_EXECUTED', {
                    token: lg.address,
                    watchedHash: tx.hash,
                    followerTx: sent,
                    status: rec.status,
                    blockNumber: Number(rec.blockNumber),
                  });

                  state.trades.push({
                    tsMs: Date.now(),
                    side: 'buy',
                    dryRun: false,
                    token: lg.address,
                    watchedHash: tx.hash,
                    signalAmount: signalAmount.toString(),
                    followerTx: sent,
                  });
                  persistState(STATE_FILE, state);
                } catch (e) {
                  log('buy send tx failed', String(e.message || e));
                }

                continue;
              }

              // side === 'sell'
              let followerTokenBalance = 0n;
              try {
                followerTokenBalance = await publicClient.readContract({
                  address: lg.address,
                  abi: ERC20_ABI,
                  functionName: 'balanceOf',
                  args: [account.address],
                });
              } catch (e) {
                log('sell balance read failed', token, String(e.message || e));
                continue;
              }

              if (followerTokenBalance <= 0n) {
                log('sell signal skip (no follower balance)', token, tx.hash);
                continue;
              }

              const followerSellAmount = (followerTokenBalance * BigInt(AUTO_SELL_BPS)) / 10000n;
              if (followerSellAmount < MIN_SELL_TOKEN_RAW) {
                log('sell signal skip (below min raw)', token, followerSellAmount.toString());
                continue;
              }

              log('sell signal detected', {
                watchedHash: tx.hash,
                token: lg.address,
                amountOutFromWatch: signalAmount.toString(),
                followerBalance: followerTokenBalance.toString(),
                followerSellAmount: followerSellAmount.toString(),
                block: b,
              });

              let quote;
              try {
                quote = await get0xQuote({
                  apiKey: OX_API_KEY,
                  taker: account.address,
                  sellToken: lg.address,
                  buyToken: ETH_PLACEHOLDER,
                  sellAmount: followerSellAmount.toString(),
                  slippageBps: SLIPPAGE_BPS,
                });
              } catch (e) {
                log('sell quote failed', String(e.message || e));
                continue;
              }

              if (DRY_RUN) {
                log('DRY_RUN mirror sell', {
                  token: lg.address,
                  sellTokenAmount: followerSellAmount.toString(),
                  expectedEthOutWei: quote?.buyAmount,
                  watchedHash: tx.hash,
                });

                state.trades.push({
                  tsMs: Date.now(),
                  side: 'sell',
                  dryRun: true,
                  token: lg.address,
                  watchedHash: tx.hash,
                  signalAmount: signalAmount.toString(),
                  sellTokenAmount: followerSellAmount.toString(),
                  quoteBuyAmount: quote?.buyAmount,
                });
                persistState(STATE_FILE, state);
                continue;
              }

              try {
                const spender =
                  quote?.issues?.allowance?.spender || quote?.allowanceTarget || quote?.allowanceSpender;
                if (spender && isHexAddress(spender)) {
                  const approveTx = await ensureAllowance({
                    publicClient,
                    walletClient,
                    account,
                    token: lg.address,
                    spender,
                    requiredAmount: followerSellAmount,
                  });
                  if (approveTx) {
                    log('sell approve ok', { token: lg.address, spender, approveTx });
                    // Refresh quote after approval to avoid stale payload.
                    quote = await get0xQuote({
                      apiKey: OX_API_KEY,
                      taker: account.address,
                      sellToken: lg.address,
                      buyToken: ETH_PLACEHOLDER,
                      sellAmount: followerSellAmount.toString(),
                      slippageBps: SLIPPAGE_BPS,
                    });
                  }
                }

                const txTo = quote?.transaction?.to;
                const txData = quote?.transaction?.data;
                const txValue = quote?.transaction?.value ?? '0';
                if (!txTo || !txData) {
                  log('skip invalid sell quote payload');
                  continue;
                }

                const sent = await walletClient.sendTransaction({
                  account,
                  chain: base,
                  to: txTo,
                  data: txData,
                  value: BigInt(String(txValue)),
                });

                const rec = await publicClient.waitForTransactionReceipt({ hash: sent });

                log('MIRROR_SELL_EXECUTED', {
                  token: lg.address,
                  watchedHash: tx.hash,
                  followerTx: sent,
                  status: rec.status,
                  blockNumber: Number(rec.blockNumber),
                });

                state.trades.push({
                  tsMs: Date.now(),
                  side: 'sell',
                  dryRun: false,
                  token: lg.address,
                  watchedHash: tx.hash,
                  signalAmount: signalAmount.toString(),
                  sellTokenAmount: followerSellAmount.toString(),
                  followerTx: sent,
                });
                persistState(STATE_FILE, state);
              } catch (e) {
                log('sell send tx failed', String(e.message || e));
              }
            }
          }

          state.lastScannedBlock = b;
          persistState(STATE_FILE, state);
        }
      }
    } catch (e) {
      log('loop error', String(e.message || e));
    }

    await sleep(POLL_SECONDS * 1000);
  }
}

run().catch((e) => {
  console.error('[FATAL]', e?.stack || String(e));
  process.exit(1);
});
