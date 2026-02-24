import { NextRequest } from "next/server";
import { requireOperatorAuth } from "@/lib/operator/auth";
import {
  getCopytradeRuntimeStatus,
  restartCopytradeBot,
  startCopytradeBot,
  stopCopytradeBot,
  writeCopytradeConfig,
} from "@/lib/operator/copytrade";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Action = "start" | "stop" | "restart" | "saveConfig" | "emergencyStop";

function toStr(v: unknown) {
  return v === undefined || v === null ? undefined : String(v);
}

export async function GET(req: NextRequest) {
  const authError = requireOperatorAuth(req);
  if (authError) return authError;

  return Response.json({
    ok: true,
    ...getCopytradeRuntimeStatus(),
    updatedAt: Date.now(),
  });
}

export async function POST(req: NextRequest) {
  const authError = requireOperatorAuth(req);
  if (authError) return authError;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const action = String(body?.action || "") as Action;

  if (!action) {
    return Response.json({ ok: false, error: "missing_action" }, { status: 400 });
  }

  try {
    if (action === "saveConfig") {
      const config = writeCopytradeConfig({
        WATCH_ADDRESS: toStr(body?.config?.watchAddress),
        OX_API_KEY: toStr(body?.config?.oxApiKey),
        FOLLOWER_PRIVATE_KEY: toStr(body?.config?.followerPrivateKey),
        FOLLOWER_PRIVATE_KEY_FILE: toStr(body?.config?.followerPrivateKeyFile),
        DRY_RUN: toStr(body?.config?.dryRun),
        BASE_RPC_URL: toStr(body?.config?.baseRpcUrl),
        POLL_SECONDS: toStr(body?.config?.pollSeconds),
        TRADE_ETH_AMOUNT: toStr(body?.config?.tradeEthAmount),
        SLIPPAGE_BPS: toStr(body?.config?.slippageBps),
        COOLDOWN_SECONDS: toStr(body?.config?.cooldownSeconds),
        MAX_TRADES_PER_HOUR: toStr(body?.config?.maxTradesPerHour),
        START_LOOKBACK_BLOCKS: toStr(body?.config?.startLookbackBlocks),
        MAX_BLOCK_SCAN_PER_CYCLE: toStr(body?.config?.maxBlockScanPerCycle),
        IGNORE_TOKENS: toStr(body?.config?.ignoreTokens),
        STATE_FILE: toStr(body?.config?.stateFile),
      });

      return Response.json({ ok: true, action, config });
    }

    if (action === "start") {
      const result = startCopytradeBot();
      return Response.json({ ok: true, action, result, status: getCopytradeRuntimeStatus() });
    }

    if (action === "stop") {
      const result = stopCopytradeBot();
      return Response.json({ ok: true, action, result, status: getCopytradeRuntimeStatus() });
    }

    if (action === "restart") {
      const result = restartCopytradeBot();
      return Response.json({ ok: true, action, result, status: getCopytradeRuntimeStatus() });
    }

    if (action === "emergencyStop") {
      // Kill bot immediately and force dry-run=true in config as safety.
      const kill = stopCopytradeBot();
      const config = writeCopytradeConfig({ DRY_RUN: "true" });
      return Response.json({ ok: true, action, kill, config, status: getCopytradeRuntimeStatus() });
    }

    return Response.json({ ok: false, error: "unsupported_action" }, { status: 400 });
  } catch (e: any) {
    return Response.json(
      {
        ok: false,
        error: e?.message || "control_failed",
      },
      { status: 500 },
    );
  }
}
