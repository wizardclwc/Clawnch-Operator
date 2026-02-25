"use client";

import { useEffect, useMemo, useState } from "react";

type TradeRow = {
  tsMs?: number;
  dryRun?: boolean;
  token?: string;
  watchedHash?: string;
  followerTx?: string;
  quoteBuyAmount?: string;
  side?: "buy" | "sell";
  signalAmount?: string;
  sellTokenAmount?: string;
};

type ApiData = {
  ok: boolean;
  bot: {
    running: boolean;
    pid: number | null;
  };
  config: {
    watchAddress: string | null;
    dryRun: string | null;
    pollSeconds: string | null;
    tradeEthAmount: string | null;
    slippageBps: string | null;
    cooldownSeconds: string | null;
    maxTradesPerHour: string | null;
    startLookbackBlocks: string | null;
    autoSellEnabled: string | null;
    autoSellBps: string | null;
    minSellTokenRaw: string | null;
  };
  summary: {
    totalSignals: number;
    totalExecuted: number;
    totalRealizedPnlWei?: string;
    lastRunAt: string | null;
    lastScannedBlock: number | null;
  };
  tokenReport?: Array<{
    token: string;
    boughtRaw: string;
    soldRaw: string;
    qtyOpenRaw: string;
    costOpenWei: string;
    totalBuyEthWei: string;
    totalSellEthWei: string;
    realizedPnlWei: string;
    tradesBuy: number;
    tradesSell: number;
    lastUpdateMs: number;
  }>;
  trades: TradeRow[];
  logTail: string[];
  updatedAt: number;
};

function short(s?: string | null, left = 6, right = 4) {
  if (!s) return "-";
  if (s.length <= left + right + 3) return s;
  return `${s.slice(0, left)}...${s.slice(-right)}`;
}

function fmtTs(ms?: number) {
  if (!ms) return "-";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "-";
  }
}

function fmtEthWei(v?: string | null, digits = 6) {
  try {
    const n = BigInt(v || "0");
    const neg = n < 0n;
    const abs = neg ? -n : n;
    const base = 10n ** 18n;
    const whole = abs / base;
    const frac = abs % base;
    const fracStr = frac.toString().padStart(18, "0").slice(0, digits);
    return `${neg ? "-" : ""}${whole.toString()}.${fracStr}`;
  } catch {
    return "0.000000";
  }
}

function isNonNegativeWei(v?: string | null) {
  try {
    return BigInt(v || "0") >= 0n;
  } catch {
    return true;
  }
}

export default function CopytradeMonitorPage() {
  const [data, setData] = useState<ApiData | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [auto, setAuto] = useState(true);

  const load = async () => {
    try {
      const res = await fetch("/api/copytrade/logs?lines=140", { cache: "no-store" });
      const json = (await res.json()) as ApiData;
      if (!res.ok || !json?.ok) throw new Error("failed to load monitor data");
      setData(json);
      setErr("");
    } catch (e: any) {
      setErr(e?.message || "failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [auto]);

  const executed = useMemo(() => {
    const rows = data?.trades || [];
    return rows.filter((t) => !t.dryRun && !!t.followerTx);
  }, [data?.trades]);

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-6xl px-5 py-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-white">CopyTrade Realtime Monitor</h1>
            <p className="mt-1 text-sm text-white/60">Track live signals and mirrored buy/sell executions.</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setAuto((v) => !v)}
              className={`rounded-xl border px-3 py-2 text-sm font-semibold ${
                auto
                  ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
                  : "border-ink-700/70 bg-white/5 text-white/80"
              }`}
            >
              Auto refresh: {auto ? "ON" : "OFF"}
            </button>
            <button
              onClick={() => void load()}
              className="rounded-xl border border-ink-700/70 bg-white/5 px-3 py-2 text-sm font-semibold text-white/85 hover:bg-white/10"
            >
              Refresh now
            </button>
          </div>
        </div>

        {err ? (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{err}</div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <section className="rounded-2xl border border-ink-700/70 bg-ink-900/60 p-4">
            <div className="text-xs uppercase tracking-wider text-white/55">Bot</div>
            <div className="mt-2 flex items-center gap-2">
              <span
                className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                  data?.bot?.running ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"
                }`}
              >
                {data?.bot?.running ? "RUNNING" : "STOPPED"}
              </span>
              <span className="text-xs text-white/55">PID: {data?.bot?.pid ?? "-"}</span>
            </div>
            <div className="mt-3 space-y-1 text-sm text-white/75">
              <div>Watch: {short(data?.config?.watchAddress, 8, 6)}</div>
              <div>Trade size: {data?.config?.tradeEthAmount ?? "-"} ETH</div>
              <div>Dry run: {String(data?.config?.dryRun ?? "-")}</div>
              <div>Auto-sell: {String(data?.config?.autoSellEnabled ?? "-")}</div>
              <div>Auto-sell BPS: {data?.config?.autoSellBps ?? "-"}</div>
              <div>Poll: {data?.config?.pollSeconds ?? "-"}s</div>
            </div>
          </section>

          <section className="rounded-2xl border border-ink-700/70 bg-ink-900/60 p-4">
            <div className="text-xs uppercase tracking-wider text-white/55">Summary</div>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-ink-700/70 bg-ink-950/30 p-3">
                <div className="text-xs text-white/55">Signals</div>
                <div className="mt-1 text-xl font-semibold">{data?.summary?.totalSignals ?? 0}</div>
              </div>
              <div className="rounded-xl border border-ink-700/70 bg-ink-950/30 p-3">
                <div className="text-xs text-white/55">Executed Trades</div>
                <div className="mt-1 text-xl font-semibold">{data?.summary?.totalExecuted ?? 0}</div>
              </div>
              <div className="rounded-xl border border-ink-700/70 bg-ink-950/30 p-3">
                <div className="text-xs text-white/55">Realized PnL (ETH)</div>
                <div className="mt-1 text-xl font-semibold">
                  {fmtEthWei(data?.summary?.totalRealizedPnlWei || "0")}
                </div>
              </div>
            </div>
            <div className="mt-3 text-xs text-white/55">
              Last run: {data?.summary?.lastRunAt || "-"}
              <br />
              Last scanned block: {data?.summary?.lastScannedBlock ?? "-"}
            </div>
          </section>

          <section className="rounded-2xl border border-ink-700/70 bg-ink-900/60 p-4">
            <div className="text-xs uppercase tracking-wider text-white/55">Realtime</div>
            <div className="mt-3 text-sm text-white/75">
              Updated: {data?.updatedAt ? new Date(data.updatedAt).toLocaleTimeString() : "-"}
            </div>
            <div className="mt-4 text-xs text-white/55">
              This page auto-refreshes every 3 seconds to show newly executed buy/sell trades.
            </div>
          </section>
        </div>

        <section className="mt-5 rounded-2xl border border-ink-700/70 bg-ink-900/60 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white/90">Executed Trades</h2>
            <span className="text-xs text-white/55">{executed.length} rows</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-sm">
              <thead>
                <tr className="border-b border-ink-700/70 text-left text-white/50">
                  <th className="py-2 pr-3">Time</th>
                  <th className="py-2 pr-3">Side</th>
                  <th className="py-2 pr-3">Token</th>
                  <th className="py-2 pr-3">Watched Tx</th>
                  <th className="py-2 pr-3">Follower Tx</th>
                </tr>
              </thead>
              <tbody>
                {executed.length === 0 ? (
                  <tr>
                    <td className="py-4 text-white/45" colSpan={5}>
                      No executed trades yet.
                    </td>
                  </tr>
                ) : (
                  executed.map((t, i) => (
                    <tr key={`${t.followerTx}-${i}`} className="border-b border-ink-800/70 align-top text-white/85">
                      <td className="py-3 pr-3">{fmtTs(t.tsMs)}</td>
                      <td className="py-3 pr-3">
                        <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                          t.side === "sell" ? "bg-amber-500/15 text-amber-300" : "bg-emerald-500/15 text-emerald-300"
                        }`}>
                          {(t.side || "buy").toUpperCase()}
                        </span>
                      </td>
                      <td className="py-3 pr-3">
                        <a
                          href={`https://basescan.org/token/${t.token}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-coral-400 hover:underline"
                        >
                          {short(t.token, 8, 6)}
                        </a>
                      </td>
                      <td className="py-3 pr-3">
                        {t.watchedHash ? (
                          <a
                            href={`https://basescan.org/tx/${t.watchedHash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-coral-400 hover:underline"
                          >
                            {short(t.watchedHash, 8, 6)}
                          </a>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="py-3 pr-3">
                        {t.followerTx ? (
                          <a
                            href={`https://basescan.org/tx/${t.followerTx}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-emerald-300 hover:underline"
                          >
                            {short(t.followerTx, 8, 6)}
                          </a>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-5 rounded-2xl border border-ink-700/70 bg-ink-900/60 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white/90">Per-Token PnL Report</h2>
            <span className="text-xs text-white/55">{(data?.tokenReport || []).length} tokens</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-b border-ink-700/70 text-left text-white/50">
                  <th className="py-2 pr-3">Token</th>
                  <th className="py-2 pr-3">Buys</th>
                  <th className="py-2 pr-3">Sells</th>
                  <th className="py-2 pr-3">Open Qty (raw)</th>
                  <th className="py-2 pr-3">Buy ETH</th>
                  <th className="py-2 pr-3">Sell ETH</th>
                  <th className="py-2 pr-3">Realized PnL (ETH)</th>
                </tr>
              </thead>
              <tbody>
                {(data?.tokenReport || []).length === 0 ? (
                  <tr>
                    <td className="py-4 text-white/45" colSpan={7}>
                      No per-token report yet (new feature; data builds from new trades).
                    </td>
                  </tr>
                ) : (
                  (data?.tokenReport || []).map((r) => (
                    <tr key={r.token} className="border-b border-ink-800/70 align-top text-white/85">
                      <td className="py-3 pr-3">
                        <a
                          href={`https://basescan.org/token/${r.token}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-coral-400 hover:underline"
                        >
                          {short(r.token, 8, 6)}
                        </a>
                      </td>
                      <td className="py-3 pr-3">{r.tradesBuy}</td>
                      <td className="py-3 pr-3">{r.tradesSell}</td>
                      <td className="py-3 pr-3">{r.qtyOpenRaw}</td>
                      <td className="py-3 pr-3">{fmtEthWei(r.totalBuyEthWei)}</td>
                      <td className="py-3 pr-3">{fmtEthWei(r.totalSellEthWei)}</td>
                      <td className="py-3 pr-3">
                        <span className={isNonNegativeWei(r.realizedPnlWei) ? "text-emerald-300" : "text-red-300"}>
                          {fmtEthWei(r.realizedPnlWei)}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-5 rounded-2xl border border-ink-700/70 bg-ink-900/60 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white/90">Live Log Tail</h2>
            <span className="text-xs text-white/55">{(data?.logTail || []).length} lines</span>
          </div>
          <pre className="max-h-[420px] overflow-auto rounded-xl border border-ink-700/70 bg-black/30 p-3 text-xs leading-relaxed text-white/75">
            {(data?.logTail || []).join("\n") || (loading ? "Loading..." : "No logs yet")}
          </pre>
        </section>
      </div>
    </main>
  );
}
