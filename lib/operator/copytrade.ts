import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export const PROJECT_ROOT = process.env.COPYTRADE_PROJECT_ROOT || process.cwd();
export const BOT_DIR = path.join(PROJECT_ROOT, "bot");
export const ENV_FILE = path.join(PROJECT_ROOT, ".env.copytrade");
export const LOG_FILE = path.join(BOT_DIR, "copytrade.log");
export const PID_FILE = path.join(BOT_DIR, "copytrade.pid");
export const STATE_FILE = path.join(BOT_DIR, "copytrade-state.json");

export type CopytradeConfig = {
  WATCH_ADDRESS: string;
  OX_API_KEY: string;
  FOLLOWER_PRIVATE_KEY?: string;
  FOLLOWER_PRIVATE_KEY_FILE?: string;
  DRY_RUN: string;
  BASE_RPC_URL: string;
  POLL_SECONDS: string;
  TRADE_ETH_AMOUNT: string;
  SLIPPAGE_BPS: string;
  COOLDOWN_SECONDS: string;
  MAX_TRADES_PER_HOUR: string;
  START_LOOKBACK_BLOCKS: string;
  MAX_BLOCK_SCAN_PER_CYCLE: string;
  IGNORE_TOKENS: string;
  STATE_FILE: string;
};

const DEFAULTS: CopytradeConfig = {
  WATCH_ADDRESS: "",
  OX_API_KEY: "",
  FOLLOWER_PRIVATE_KEY: "",
  FOLLOWER_PRIVATE_KEY_FILE: "",
  DRY_RUN: "true",
  BASE_RPC_URL: "https://mainnet.base.org",
  POLL_SECONDS: "10",
  TRADE_ETH_AMOUNT: "0.0002",
  SLIPPAGE_BPS: "250",
  COOLDOWN_SECONDS: "45",
  MAX_TRADES_PER_HOUR: "20",
  START_LOOKBACK_BLOCKS: "8",
  MAX_BLOCK_SCAN_PER_CYCLE: "20",
  IGNORE_TOKENS: "",
  STATE_FILE,
};

function readTextSafe(filePath: string) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function readJsonSafe<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function parseEnvFile(filePath = ENV_FILE): Record<string, string> {
  const raw = readTextSafe(filePath);
  const out: Record<string, string> = {};

  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#") || !s.includes("=")) continue;
    const i = s.indexOf("=");
    const k = s.slice(0, i).trim();
    const v = s.slice(i + 1).trim();
    out[k] = v;
  }

  return out;
}

export function getCopytradeConfig(): CopytradeConfig {
  const parsed = parseEnvFile();
  return {
    ...DEFAULTS,
    ...parsed,
  };
}

export function writeCopytradeConfig(nextPartial: Partial<CopytradeConfig>) {
  const current = getCopytradeConfig();
  const merged = {
    ...current,
    ...Object.fromEntries(
      Object.entries(nextPartial)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)]),
    ),
  } as CopytradeConfig;

  const lines = Object.entries(merged).map(([k, v]) => `${k}=${v ?? ""}`);
  fs.writeFileSync(ENV_FILE, `${lines.join("\n")}\n`);

  return merged;
}

export function readPid(): number | null {
  const raw = readTextSafe(PID_FILE).trim();
  const pid = Number(raw);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

export function isRunning(pid: number | null) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function stopCopytradeBot() {
  const pid = readPid();
  if (!pid) return { stopped: false, reason: "pid_not_found" };

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return { stopped: false, reason: "process_not_found" };
  }

  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    // ignore
  }

  return { stopped: true, pid };
}

export function startCopytradeBot() {
  fs.mkdirSync(BOT_DIR, { recursive: true });

  const config = getCopytradeConfig();

  const outFd = fs.openSync(LOG_FILE, "a");
  const env = {
    ...process.env,
    ...config,
  } as NodeJS.ProcessEnv;

  const child = spawn("node", ["bot/copytrade-base.js"], {
    cwd: PROJECT_ROOT,
    env,
    detached: true,
    stdio: ["ignore", outFd, outFd],
  });

  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid));

  return { started: true, pid: child.pid };
}

export function restartCopytradeBot() {
  stopCopytradeBot();
  return startCopytradeBot();
}

export function getCopytradeRuntimeStatus() {
  const pid = readPid();
  const running = isRunning(pid);
  const config = getCopytradeConfig();

  const state = readJsonSafe<{ lastRunAt?: string; lastScannedBlock?: number; trades?: unknown[] }>(STATE_FILE, {});
  const logTail = readTextSafe(LOG_FILE)
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-40);

  return {
    running,
    pid,
    config: {
      WATCH_ADDRESS: config.WATCH_ADDRESS,
      DRY_RUN: config.DRY_RUN,
      BASE_RPC_URL: config.BASE_RPC_URL,
      POLL_SECONDS: config.POLL_SECONDS,
      TRADE_ETH_AMOUNT: config.TRADE_ETH_AMOUNT,
      SLIPPAGE_BPS: config.SLIPPAGE_BPS,
      COOLDOWN_SECONDS: config.COOLDOWN_SECONDS,
      MAX_TRADES_PER_HOUR: config.MAX_TRADES_PER_HOUR,
      START_LOOKBACK_BLOCKS: config.START_LOOKBACK_BLOCKS,
      MAX_BLOCK_SCAN_PER_CYCLE: config.MAX_BLOCK_SCAN_PER_CYCLE,
      IGNORE_TOKENS: config.IGNORE_TOKENS,
      OX_API_KEY_SET: config.OX_API_KEY ? "yes" : "no",
      FOLLOWER_PRIVATE_KEY_SET: config.FOLLOWER_PRIVATE_KEY ? "yes" : "no",
      FOLLOWER_PRIVATE_KEY_FILE_SET: config.FOLLOWER_PRIVATE_KEY_FILE ? "yes" : "no",
    },
    summary: {
      lastRunAt: state.lastRunAt || null,
      lastScannedBlock: state.lastScannedBlock ?? null,
      totalSignals: Array.isArray(state.trades) ? state.trades.length : 0,
    },
    logTail,
  };
}
