import { NextRequest } from "next/server";
import { ClawnchReader } from "@clawnch/clawncher-sdk";
import { createPublicClient, http, isAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { requireOperatorAuth } from "@/lib/operator/auth";

export const runtime = "nodejs";

const WETH_BASE = "0x4200000000000000000000000000000000000006" as Address;

function isPrivateKey(v: string) {
  return /^0x[0-9a-fA-F]{64}$/.test(v);
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

  const privateKey = String(body?.privateKey || "").trim();
  const tokenAddress = String(body?.tokenAddress || "").trim();
  const walletAddressInput = String(body?.walletAddress || "").trim();

  if (!isAddress(tokenAddress)) {
    return Response.json({ ok: false, error: "invalid_token_address" }, { status: 400 });
  }

  let walletAddress = walletAddressInput;
  if (!walletAddress) {
    if (!isPrivateKey(privateKey)) {
      return Response.json({ ok: false, error: "wallet_or_private_key_required" }, { status: 400 });
    }
    walletAddress = privateKeyToAccount(privateKey as `0x${string}`).address;
  }

  if (!isAddress(walletAddress)) {
    return Response.json({ ok: false, error: "invalid_wallet_address" }, { status: 400 });
  }

  try {
    const rpc = process.env.OPERATOR_BASE_RPC_URL || "https://mainnet.base.org";
    const publicClient = createPublicClient({ chain: base, transport: http(rpc) }) as any;
    const reader = new ClawnchReader({ publicClient, network: "mainnet" });

    const [wethFees, tokenFees, tokenInfo] = await Promise.all([
      reader.getAvailableFees(walletAddress as Address, WETH_BASE),
      reader.getAvailableFees(walletAddress as Address, tokenAddress as Address),
      reader.getTokenInfo(tokenAddress as Address).catch(() => null),
    ]);

    return Response.json({
      ok: true,
      walletAddress,
      tokenAddress,
      symbol: tokenInfo?.symbol || null,
      decimals: tokenInfo?.decimals ?? null,
      available: {
        wethWei: wethFees.toString(),
        tokenRaw: tokenFees.toString(),
      },
    });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || "fee_check_failed" }, { status: 500 });
  }
}
