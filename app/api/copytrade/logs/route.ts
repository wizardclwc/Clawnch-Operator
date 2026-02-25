import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROJECT_ROOT = process.env.COPYTRADE_PROJECT_ROOT || process.cwd();
const BOT_DIR = path.join(PROJECT_ROOT, "bot");
const STATE_FILE = path.join(BOT_DIR, "copytrade-state.json");
const LOG_FILE = path.join(BOT_DIR, "copytrade.log");
const PID_FILE = path.join(BOT_DIR, "copytrade.pid");
const ENV_FILE = path.join(PROJECT_ROOT, ".env.copytrade");

function readTextSafe(filePath: string) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function readJsonSafe<T>(filePath: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function tailLines(input: string, count: number) {
  const arr = input.split(/\r?\n/).filter(Boolean);
  return arr.slice(-count);
}

function isProcessRunning(pid: number) {
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
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#") || !s.includes("=")) continue;
    const i = s.indexOf("=");
    const k = s.slice(0, i).trim();
    const v = s.slice(i + 1).trim();
    out[k] = v;
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

type CopytradeState = {
  seen?: string[];
  trades?: Array<{
    tsMs?: number;
    dryRun?: boolean;
    token?: string;
    watchedHash?: string;
    followerTx?: string;
    quoteBuyAmount?: string;
    side?: "buy" | "sell";
    signalAmount?: string;
    sellTokenAmount?: string;
    tokenFillRaw?: string;
    ethSpentWei?: string;
    ethReceivedWei?: string;
    realizedPnlWei?: string;
  }>;
  positions?: Record<
    string,
    {
      token?: string;
      boughtRaw?: string;
      soldRaw?: string;
      qtyOpenRaw?: string;
      costOpenWei?: string;
      totalBuyEthWei?: string;
      totalSellEthWei?: string;
      realizedPnlWei?: string;
      tradesBuy?: number;
      tradesSell?: number;
      lastUpdateMs?: number;
    }
  >;
  lastRunAt?: string;
  lastScannedBlock?: number;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const lineCountRaw = Number(url.searchParams.get("lines") || 120);
  const lineCount = Math.max(20, Math.min(600, Number.isFinite(lineCountRaw) ? lineCountRaw : 120));

  const remoteUrl = process.env.COPYTRADE_REMOTE_URL;
  const remoteToken = process.env.COPYTRADE_REMOTE_TOKEN;

  // If configured (recommended for Vercel), proxy from remote VPS logs endpoint.
  if (remoteUrl) {
    try {
      const u = new URL(remoteUrl);
      u.searchParams.set("lines", String(lineCount));

      const upstream = await fetch(u.toString(), {
        method: "GET",
        headers: remoteToken
          ? {
              Authorization: `Bearer ${remoteToken}`,
            }
          : undefined,
        cache: "no-store",
      });

      const text = await upstream.text();
      return new Response(text, {
        status: upstream.status,
        headers: {
          "content-type": upstream.headers.get("content-type") || "application/json",
          "cache-control": "no-store",
        },
      });
    } catch {
      // fallback to local files below
    }
  }

  const state = readJsonSafe<CopytradeState>(STATE_FILE, {});
  const logRaw = readTextSafe(LOG_FILE);
  const logTail = tailLines(logRaw, lineCount);

  const pidRaw = readTextSafe(PID_FILE).trim();
  const pid = Number(pidRaw);
  const running = isProcessRunning(pid);

  const trades = Array.isArray(state.trades) ? state.trades : [];
  const tradesDesc = [...trades].sort((a, b) => (b.tsMs || 0) - (a.tsMs || 0));
  const executed = tradesDesc.filter((t) => !t.dryRun && !!t.followerTx);

  const toBI = (v: unknown) => {
    try {
      if (v === undefined || v === null || v === "") return 0n;
      return BigInt(String(v));
    } catch {
      return 0n;
    }
  };

  const positions = state.positions && typeof state.positions === "object" ? state.positions : {};
  const tokenReport = Object.entries(positions)
    .map(([token, p]) => {
      const row = p || {};
      return {
        token,
        boughtRaw: String(row.boughtRaw || "0"),
        soldRaw: String(row.soldRaw || "0"),
        qtyOpenRaw: String(row.qtyOpenRaw || "0"),
        costOpenWei: String(row.costOpenWei || "0"),
        totalBuyEthWei: String(row.totalBuyEthWei || "0"),
        totalSellEthWei: String(row.totalSellEthWei || "0"),
        realizedPnlWei: String(row.realizedPnlWei || "0"),
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

  return Response.json(
    {
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
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
