"use client";

import { useEffect, useMemo, useState } from "react";

type CopytradeStatus = {
  ok: boolean;
  running: boolean;
  pid: number | null;
  config: Record<string, string>;
  summary: {
    lastRunAt: string | null;
    lastScannedBlock: number | null;
    totalSignals: number;
  };
  logTail: string[];
  updatedAt: number;
};

type LogsPayload = {
  ok: boolean;
  bot: { running: boolean; pid: number | null };
  summary: {
    totalSignals: number;
    totalExecuted: number;
    lastRunAt: string | null;
    lastScannedBlock: number | null;
  };
  trades: Array<{
    tsMs?: number;
    dryRun?: boolean;
    token?: string;
    watchedHash?: string;
    followerTx?: string;
  }>;
  logTail: string[];
};

function short(s?: string | null, l = 6, r = 4) {
  if (!s) return "-";
  if (s.length <= l + r + 3) return s;
  return `${s.slice(0, l)}...${s.slice(-r)}`;
}

function toBool(v: string) {
  return ["1", "true", "yes", "on"].includes((v || "").toLowerCase());
}

export default function OperatorPage() {
  const [operatorToken, setOperatorToken] = useState("");

  const [privateKey, setPrivateKey] = useState("");

  const [launchName, setLaunchName] = useState("");
  const [launchSymbol, setLaunchSymbol] = useState("");
  const [launchDescription, setLaunchDescription] = useState("");
  const [launchImage, setLaunchImage] = useState("");
  const [launchWebsite, setLaunchWebsite] = useState("");
  const [launchTwitter, setLaunchTwitter] = useState("");
  const [launchBusy, setLaunchBusy] = useState(false);
  const [launchRes, setLaunchRes] = useState<any>(null);

  const [feeToken, setFeeToken] = useState("");
  const [feeBusy, setFeeBusy] = useState(false);
  const [feeInfo, setFeeInfo] = useState<any>(null);
  const [feeClaimRes, setFeeClaimRes] = useState<any>(null);

  const [status, setStatus] = useState<CopytradeStatus | null>(null);
  const [logs, setLogs] = useState<LogsPayload | null>(null);
  const [ctrlBusy, setCtrlBusy] = useState(false);
  const [err, setErr] = useState("");

  const [watchAddress, setWatchAddress] = useState("");
  const [dryRun, setDryRun] = useState(false);
  const [baseRpcUrl, setBaseRpcUrl] = useState("https://mainnet.base.org");
  const [pollSeconds, setPollSeconds] = useState("10");
  const [tradeEthAmount, setTradeEthAmount] = useState("0.0002");
  const [slippageBps, setSlippageBps] = useState("250");
  const [cooldownSeconds, setCooldownSeconds] = useState("45");
  const [maxTradesPerHour, setMaxTradesPerHour] = useState("20");
  const [startLookbackBlocks, setStartLookbackBlocks] = useState("8");
  const [maxBlockScanPerCycle, setMaxBlockScanPerCycle] = useState("20");
  const [ignoreTokens, setIgnoreTokens] = useState("");

  const authHeaders = useMemo(() => {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (operatorToken.trim()) h["x-operator-token"] = operatorToken.trim();
    return h;
  }, [operatorToken]);

  const loadStatus = async () => {
    try {
      const [sRes, lRes] = await Promise.all([
        fetch("/api/operator/copytrade/control", { headers: authHeaders, cache: "no-store" }),
        fetch("/api/copytrade/logs?lines=120", { cache: "no-store" }),
      ]);

      const sJson = await sRes.json();
      const lJson = await lRes.json();

      if (sRes.ok && sJson?.ok) {
        setStatus(sJson as CopytradeStatus);

        const cfg = sJson.config || {};
        setWatchAddress(cfg.WATCH_ADDRESS || "");
        setDryRun(toBool(cfg.DRY_RUN || "false"));
        setBaseRpcUrl(cfg.BASE_RPC_URL || "https://mainnet.base.org");
        setPollSeconds(cfg.POLL_SECONDS || "10");
        setTradeEthAmount(cfg.TRADE_ETH_AMOUNT || "0.0002");
        setSlippageBps(cfg.SLIPPAGE_BPS || "250");
        setCooldownSeconds(cfg.COOLDOWN_SECONDS || "45");
        setMaxTradesPerHour(cfg.MAX_TRADES_PER_HOUR || "20");
        setStartLookbackBlocks(cfg.START_LOOKBACK_BLOCKS || "8");
        setMaxBlockScanPerCycle(cfg.MAX_BLOCK_SCAN_PER_CYCLE || "20");
        setIgnoreTokens(cfg.IGNORE_TOKENS || "");
      }

      if (lRes.ok && lJson?.ok) {
        setLogs(lJson as LogsPayload);
      }

      setErr("");
    } catch (e: any) {
      setErr(e?.message || "Failed to load operator data");
    }
  };

  useEffect(() => {
    void loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setInterval(() => void loadStatus(), 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authHeaders]);

  const runControl = async (action: string, config?: any) => {
    setCtrlBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/operator/copytrade/control", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ action, config }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || "control_failed");
      await loadStatus();
      return data;
    } catch (e: any) {
      setErr(e?.message || "control_failed");
      return null;
    } finally {
      setCtrlBusy(false);
    }
  };

  const saveConfig = async () => {
    await runControl("saveConfig", {
      watchAddress,
      dryRun: dryRun ? "true" : "false",
      baseRpcUrl,
      pollSeconds,
      tradeEthAmount,
      slippageBps,
      cooldownSeconds,
      maxTradesPerHour,
      startLookbackBlocks,
      maxBlockScanPerCycle,
      ignoreTokens,
    });
  };

  const deployToken = async () => {
    setLaunchBusy(true);
    setLaunchRes(null);
    setErr("");
    try {
      const res = await fetch("/api/operator/launch", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          privateKey,
          name: launchName,
          symbol: launchSymbol,
          description: launchDescription,
          image: launchImage,
          website: launchWebsite,
          twitter: launchTwitter,
          feePreference: "Paired",
          rewardBps: 10000,
        }),
      });
      const data = await res.json();
      setLaunchRes(data);
      if (!res.ok || !data?.ok) throw new Error(data?.error || "deploy_failed");
    } catch (e: any) {
      setErr(e?.message || "deploy_failed");
    } finally {
      setLaunchBusy(false);
    }
  };

  const checkFees = async () => {
    setFeeBusy(true);
    setFeeInfo(null);
    setErr("");
    try {
      const res = await fetch("/api/operator/fees/check", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ privateKey, tokenAddress: feeToken }),
      });
      const data = await res.json();
      setFeeInfo(data);
      if (!res.ok || !data?.ok) throw new Error(data?.error || "fee_check_failed");
    } catch (e: any) {
      setErr(e?.message || "fee_check_failed");
    } finally {
      setFeeBusy(false);
    }
  };

  const claimFees = async () => {
    setFeeBusy(true);
    setFeeClaimRes(null);
    setErr("");
    try {
      const res = await fetch("/api/operator/fees/claim", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ privateKey, tokenAddress: feeToken }),
      });
      const data = await res.json();
      setFeeClaimRes(data);
      if (!res.ok || !data?.ok) throw new Error(data?.error || "claim_failed");
      await loadStatus();
    } catch (e: any) {
      setErr(e?.message || "claim_failed");
    } finally {
      setFeeBusy(false);
    }
  };

  const executedRows = useMemo(() => (logs?.trades || []).filter((t) => !t.dryRun && !!t.followerTx), [logs?.trades]);

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-7xl px-5 py-8">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-white">Clawnch Operator Console</h1>
            <p className="mt-1 text-sm text-white/60">Launch • Copytrade • Fee Claim • Realtime Ops</p>
          </div>
          <div className="w-full max-w-sm">
            <label className="mb-1 block text-xs text-white/50">Operator API Token (optional)</label>
            <input
              value={operatorToken}
              onChange={(e) => setOperatorToken(e.target.value)}
              placeholder="x-operator-token"
              className="h-10 w-full rounded-lg border border-ink-700/70 bg-ink-900/60 px-3 text-sm text-white outline-none focus:border-coral-500/70"
            />
          </div>
        </div>

        {err ? <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</div> : null}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <section className="rounded-2xl border border-ink-700/70 bg-ink-900/60 p-4 lg:col-span-2">
            <h2 className="text-sm font-semibold text-white/90">1) Launch Token Panel</h2>
            <p className="mt-1 text-xs text-white/55">Clawncher SDK (on-chain deploy). Use a dedicated burner wallet.</p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input value={launchName} onChange={(e) => setLaunchName(e.target.value)} placeholder="Token Name" className="h-10 rounded-lg border border-ink-700/70 bg-black/20 px-3 text-sm" />
              <input value={launchSymbol} onChange={(e) => setLaunchSymbol(e.target.value.toUpperCase())} placeholder="SYMBOL" className="h-10 rounded-lg border border-ink-700/70 bg-black/20 px-3 text-sm" />
              <input value={launchWebsite} onChange={(e) => setLaunchWebsite(e.target.value)} placeholder="Website (optional)" className="h-10 rounded-lg border border-ink-700/70 bg-black/20 px-3 text-sm" />
              <input value={launchTwitter} onChange={(e) => setLaunchTwitter(e.target.value)} placeholder="X/Twitter (optional)" className="h-10 rounded-lg border border-ink-700/70 bg-black/20 px-3 text-sm" />
            </div>
            <input value={launchImage} onChange={(e) => setLaunchImage(e.target.value)} placeholder="Image URL" className="mt-3 h-10 w-full rounded-lg border border-ink-700/70 bg-black/20 px-3 text-sm" />
            <textarea value={launchDescription} onChange={(e) => setLaunchDescription(e.target.value)} placeholder="Description" className="mt-3 h-24 w-full rounded-lg border border-ink-700/70 bg-black/20 px-3 py-2 text-sm" />

            <label className="mt-3 block text-xs text-white/55">Private Key (used for launch + fee claim)</label>
            <input
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value.trim())}
              placeholder="0x..."
              type="password"
              className="mt-1 h-10 w-full rounded-lg border border-ink-700/70 bg-black/20 px-3 text-sm"
            />

            <div className="mt-3 flex gap-2">
              <button onClick={() => void deployToken()} disabled={launchBusy} className="h-10 rounded-lg bg-coral-500 px-4 text-sm font-semibold text-white hover:bg-coral-600 disabled:opacity-50">
                {launchBusy ? "Deploying..." : "Deploy Token"}
              </button>
            </div>

            {launchRes ? (
              <pre className="mt-3 overflow-auto rounded-lg border border-ink-700/70 bg-black/30 p-3 text-xs text-white/80">{JSON.stringify(launchRes, null, 2)}</pre>
            ) : null}
          </section>

          <section className="rounded-2xl border border-ink-700/70 bg-ink-900/60 p-4">
            <h2 className="text-sm font-semibold text-white/90">2) Fee Claim Panel</h2>
            <p className="mt-1 text-xs text-white/55">Check & claim WETH/token fees.</p>
            <input
              value={feeToken}
              onChange={(e) => setFeeToken(e.target.value.trim())}
              placeholder="Token Address 0x..."
              className="mt-3 h-10 w-full rounded-lg border border-ink-700/70 bg-black/20 px-3 text-sm"
            />
            <div className="mt-3 flex gap-2">
              <button onClick={() => void checkFees()} disabled={feeBusy} className="h-10 rounded-lg border border-ink-700/70 bg-white/5 px-3 text-sm">Check</button>
              <button onClick={() => void claimFees()} disabled={feeBusy} className="h-10 rounded-lg bg-coral-500 px-3 text-sm font-semibold text-white">Claim All</button>
            </div>
            {feeInfo ? <pre className="mt-3 overflow-auto rounded-lg border border-ink-700/70 bg-black/30 p-3 text-xs text-white/80">{JSON.stringify(feeInfo, null, 2)}</pre> : null}
            {feeClaimRes ? <pre className="mt-3 overflow-auto rounded-lg border border-ink-700/70 bg-black/30 p-3 text-xs text-emerald-200">{JSON.stringify(feeClaimRes, null, 2)}</pre> : null}
          </section>
        </div>

        <section className="mt-5 rounded-2xl border border-ink-700/70 bg-ink-900/60 p-4">
          <h2 className="text-sm font-semibold text-white/90">3) Copytrade Panel + 5) Emergency Stop</h2>
          <p className="mt-1 text-xs text-white/55">Watch target wallet → auto buy. Control start/stop from here.</p>

          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            <input value={watchAddress} onChange={(e) => setWatchAddress(e.target.value.trim())} placeholder="Watch address" className="h-10 rounded-lg border border-ink-700/70 bg-black/20 px-3 text-sm" />
            <input value={tradeEthAmount} onChange={(e) => setTradeEthAmount(e.target.value)} placeholder="Trade ETH amount" className="h-10 rounded-lg border border-ink-700/70 bg-black/20 px-3 text-sm" />
            <input value={baseRpcUrl} onChange={(e) => setBaseRpcUrl(e.target.value)} placeholder="Base RPC URL" className="h-10 rounded-lg border border-ink-700/70 bg-black/20 px-3 text-sm" />
            <input value={pollSeconds} onChange={(e) => setPollSeconds(e.target.value)} placeholder="Poll seconds" className="h-10 rounded-lg border border-ink-700/70 bg-black/20 px-3 text-sm" />
            <input value={slippageBps} onChange={(e) => setSlippageBps(e.target.value)} placeholder="Slippage BPS" className="h-10 rounded-lg border border-ink-700/70 bg-black/20 px-3 text-sm" />
            <input value={cooldownSeconds} onChange={(e) => setCooldownSeconds(e.target.value)} placeholder="Cooldown seconds" className="h-10 rounded-lg border border-ink-700/70 bg-black/20 px-3 text-sm" />
            <input value={maxTradesPerHour} onChange={(e) => setMaxTradesPerHour(e.target.value)} placeholder="Max trades/hour" className="h-10 rounded-lg border border-ink-700/70 bg-black/20 px-3 text-sm" />
            <input value={startLookbackBlocks} onChange={(e) => setStartLookbackBlocks(e.target.value)} placeholder="Start lookback blocks" className="h-10 rounded-lg border border-ink-700/70 bg-black/20 px-3 text-sm" />
            <input value={maxBlockScanPerCycle} onChange={(e) => setMaxBlockScanPerCycle(e.target.value)} placeholder="Max block scan/cycle" className="h-10 rounded-lg border border-ink-700/70 bg-black/20 px-3 text-sm" />
          </div>

          <input value={ignoreTokens} onChange={(e) => setIgnoreTokens(e.target.value)} placeholder="Ignore token addresses (comma-separated)" className="mt-3 h-10 w-full rounded-lg border border-ink-700/70 bg-black/20 px-3 text-sm" />

          <label className="mt-3 inline-flex items-center gap-2 text-sm text-white/80">
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
            Dry run
          </label>

          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => void saveConfig()} disabled={ctrlBusy} className="h-10 rounded-lg border border-ink-700/70 bg-white/5 px-3 text-sm">Save Config</button>
            <button onClick={() => void runControl("start")} disabled={ctrlBusy} className="h-10 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 text-sm text-emerald-200">Start Bot</button>
            <button onClick={() => void runControl("stop")} disabled={ctrlBusy} className="h-10 rounded-lg border border-ink-700/70 bg-white/5 px-3 text-sm">Stop Bot</button>
            <button onClick={() => void runControl("restart")} disabled={ctrlBusy} className="h-10 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 text-sm text-amber-200">Restart Bot</button>
            <button onClick={() => void runControl("emergencyStop")} disabled={ctrlBusy} className="h-10 rounded-lg border border-red-500/40 bg-red-500/10 px-3 text-sm text-red-200">Emergency Stop</button>
          </div>

          <div className="mt-3 rounded-lg border border-ink-700/70 bg-black/20 p-3 text-xs text-white/70">
            Status: {status?.running ? "RUNNING" : "STOPPED"} • PID: {status?.pid ?? "-"} • Signals: {status?.summary?.totalSignals ?? 0} • Last block: {status?.summary?.lastScannedBlock ?? "-"}
          </div>
        </section>

        <section className="mt-5 rounded-2xl border border-ink-700/70 bg-ink-900/60 p-4">
          <h2 className="text-sm font-semibold text-white/90">4) Realtime Logs + Executed Trades</h2>

          <div className="mt-3 overflow-x-auto rounded-lg border border-ink-700/70">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-black/20 text-left text-white/55">
                <tr>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Token</th>
                  <th className="px-3 py-2">Watched Tx</th>
                  <th className="px-3 py-2">Follower Tx</th>
                </tr>
              </thead>
              <tbody>
                {executedRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-3 text-white/50">
                      No executed buys yet.
                    </td>
                  </tr>
                ) : (
                  executedRows.map((r, i) => (
                    <tr key={`${r.followerTx}-${i}`} className="border-t border-ink-800/70">
                      <td className="px-3 py-2 text-white/80">{r.tsMs ? new Date(r.tsMs).toLocaleString() : "-"}</td>
                      <td className="px-3 py-2"><a className="text-coral-300 hover:underline" href={`https://basescan.org/token/${r.token}`} target="_blank" rel="noreferrer">{short(r.token, 8, 6)}</a></td>
                      <td className="px-3 py-2"><a className="text-coral-300 hover:underline" href={`https://basescan.org/tx/${r.watchedHash}`} target="_blank" rel="noreferrer">{short(r.watchedHash, 8, 6)}</a></td>
                      <td className="px-3 py-2"><a className="text-emerald-300 hover:underline" href={`https://basescan.org/tx/${r.followerTx}`} target="_blank" rel="noreferrer">{short(r.followerTx, 8, 6)}</a></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <pre className="mt-3 max-h-[420px] overflow-auto rounded-lg border border-ink-700/70 bg-black/30 p-3 text-xs text-white/70">
            {(logs?.logTail || status?.logTail || []).join("\n") || "No logs yet"}
          </pre>
        </section>
      </div>
    </main>
  );
}
