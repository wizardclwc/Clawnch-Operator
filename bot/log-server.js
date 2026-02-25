#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = process.env.COPYTRADE_PROJECT_ROOT || path.resolve(__dirname, '..');
const BOT_DIR = path.join(PROJECT_ROOT, 'bot');
const STATE_FILE = path.join(BOT_DIR, 'copytrade-state.json');
const LOG_FILE = path.join(BOT_DIR, 'copytrade.log');
const PID_FILE = path.join(BOT_DIR, 'copytrade.pid');
const ENV_FILE = path.join(PROJECT_ROOT, '.env.copytrade');

const HOST = process.env.LOG_SERVER_HOST || '0.0.0.0';
const PORT = Number(process.env.LOG_SERVER_PORT || 8788);
const TOKEN = String(process.env.LOG_SERVER_TOKEN || '').trim();

function readTextSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function readJsonSafe(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function tailLines(input, count) {
  return input.split(/\r?\n/).filter(Boolean).slice(-count);
}

function isProcessRunning(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function parseEnvView() {
  const raw = readTextSafe(ENV_FILE);
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#') || !s.includes('=')) continue;
    const i = s.indexOf('=');
    out[s.slice(0, i).trim()] = s.slice(i + 1).trim();
  }

  return {
    watchAddress: out.WATCH_ADDRESS || null,
    dryRun: out.DRY_RUN || null,
    pollSeconds: out.POLL_SECONDS || null,
    tradeEthAmount: out.TRADE_ETH_AMOUNT || null,
    slippageBps: out.SLIPPAGE_BPS || null,
    cooldownSeconds: out.COOLDOWN_SECONDS || null,
    maxTradesPerHour: out.MAX_TRADES_PER_HOUR || null,
    startLookbackBlocks: out.START_LOOKBACK_BLOCKS || null,
    autoSellEnabled: out.AUTO_SELL_ENABLED || null,
    autoSellBps: out.AUTO_SELL_BPS || null,
    minSellTokenRaw: out.MIN_SELL_TOKEN_RAW || null,
  };
}

function buildPayload(lineCount) {
  const state = readJsonSafe(STATE_FILE, {});
  const logTail = tailLines(readTextSafe(LOG_FILE), lineCount);
  const pid = Number(readTextSafe(PID_FILE).trim());
  const running = isProcessRunning(pid);

  const trades = Array.isArray(state.trades) ? state.trades : [];
  const tradesDesc = [...trades].sort((a, b) => (b.tsMs || 0) - (a.tsMs || 0));
  const executed = tradesDesc.filter((t) => !t.dryRun && !!t.followerTx);

  const toBI = (v) => {
    try {
      if (v === undefined || v === null || v === '') return 0n;
      return BigInt(String(v));
    } catch {
      return 0n;
    }
  };

  const positions = state.positions && typeof state.positions === 'object' ? state.positions : {};
  const tokenReport = Object.entries(positions)
    .map(([token, p]) => {
      const row = p || {};
      return {
        token,
        boughtRaw: String(row.boughtRaw || '0'),
        soldRaw: String(row.soldRaw || '0'),
        qtyOpenRaw: String(row.qtyOpenRaw || '0'),
        costOpenWei: String(row.costOpenWei || '0'),
        totalBuyEthWei: String(row.totalBuyEthWei || '0'),
        totalSellEthWei: String(row.totalSellEthWei || '0'),
        realizedPnlWei: String(row.realizedPnlWei || '0'),
        tradesBuy: Number(row.tradesBuy || 0),
        tradesSell: Number(row.tradesSell || 0),
        lastUpdateMs: Number(row.lastUpdateMs || 0),
      };
    })
    .sort((a, b) => {
      const av = toBI(a.realizedPnlWei);
      const bv = toBI(b.realizedPnlWei);
      if (bv > av) return 1;
      if (bv < av) return -1;
      return 0;
    });

  const totalRealizedPnlWei = tokenReport.reduce((acc, r) => acc + toBI(r.realizedPnlWei), 0n);

  return {
    ok: true,
    bot: {
      running,
      pid: Number.isFinite(pid) ? pid : null,
    },
    config: parseEnvView(),
    summary: {
      totalSignals: tradesDesc.length,
      totalExecuted: executed.length,
      totalRealizedPnlWei: totalRealizedPnlWei.toString(),
      lastRunAt: state.lastRunAt || null,
      lastScannedBlock: state.lastScannedBlock ?? null,
    },
    tokenReport,
    trades: tradesDesc.slice(0, 200),
    logTail,
    updatedAt: Date.now(),
  };
}

if (!TOKEN) {
  console.error('LOG_SERVER_TOKEN is required');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Log-Token');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (url.pathname !== '/logs') {
    res.statusCode = 404;
    res.end('not found');
    return;
  }

  const auth = String(req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  const token = String(req.headers['x-log-token'] || auth || url.searchParams.get('token') || '');
  if (token !== TOKEN) {
    res.statusCode = 401;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
    return;
  }

  const linesRaw = Number(url.searchParams.get('lines') || 140);
  const lineCount = Math.max(20, Math.min(600, Number.isFinite(linesRaw) ? linesRaw : 140));
  const payload = buildPayload(lineCount);

  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
});

server.listen(PORT, HOST, () => {
  console.log(`copytrade-log-server listening on ${HOST}:${PORT}`);
});
