import { NextRequest } from "next/server";
import { ClawncherClaimer } from "@clawnch/clawncher-sdk";
import { createPublicClient, createWalletClient, http, isAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { requireOperatorAuth } from "@/lib/operator/auth";

export const runtime = "nodejs";

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
  const feeOwnerInput = String(body?.feeOwner || "").trim();

  if (!isPrivateKey(privateKey)) {
    return Response.json({ ok: false, error: "invalid_private_key" }, { status: 400 });
  }
  if (!isAddress(tokenAddress)) {
    return Response.json({ ok: false, error: "invalid_token_address" }, { status: 400 });
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const feeOwner = feeOwnerInput && isAddress(feeOwnerInput) ? feeOwnerInput : account.address;

  try {
    const rpc = process.env.OPERATOR_BASE_RPC_URL || "https://mainnet.base.org";
    const wallet = createWalletClient({ account, chain: base, transport: http(rpc) }) as any;
    const publicClient = createPublicClient({ chain: base, transport: http(rpc) }) as any;

    const claimer = new ClawncherClaimer({
      wallet,
      publicClient,
      network: "mainnet",
    });

    const result = await claimer.claimAll(tokenAddress as Address, feeOwner as Address);

    const waitCollect = await result.collectRewards.wait().catch(() => ({ success: false }));
    const waitWeth = await result.claimFeesWeth?.wait().catch(() => ({ success: false }));
    const waitToken = await result.claimFeesToken?.wait().catch(() => ({ success: false }));

    return Response.json({
      ok: true,
      feeOwner,
      tokenAddress,
      txs: {
        collectRewards: result.collectRewards.txHash,
        claimFeesWeth: result.claimFeesWeth?.txHash || null,
        claimFeesToken: result.claimFeesToken?.txHash || null,
      },
      success: {
        collectRewards: waitCollect.success,
        claimFeesWeth: waitWeth?.success ?? null,
        claimFeesToken: waitToken?.success ?? null,
      },
    });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || "claim_failed" }, { status: 500 });
  }
}
