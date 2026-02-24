import { NextRequest } from "next/server";
import { ClawnchDeployer } from "@clawnch/clawncher-sdk";
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
  const name = String(body?.name || "").trim();
  const symbol = String(body?.symbol || "").trim();
  const image = String(body?.image || "").trim();
  const description = String(body?.description || "").trim();
  const website = String(body?.website || "").trim();
  const twitter = String(body?.twitter || "").trim();
  const tokenAdminInput = String(body?.tokenAdmin || "").trim();
  const rewardBps = Number(body?.rewardBps ?? 10000);
  const feePreference = String(body?.feePreference || "Paired") as "Paired" | "Clawnch" | "Both";

  if (!isPrivateKey(privateKey)) {
    return Response.json({ ok: false, error: "invalid_private_key" }, { status: 400 });
  }
  if (!name || !symbol) {
    return Response.json({ ok: false, error: "name_and_symbol_required" }, { status: 400 });
  }
  if (!Number.isFinite(rewardBps) || rewardBps < 1 || rewardBps > 10000) {
    return Response.json({ ok: false, error: "invalid_reward_bps" }, { status: 400 });
  }

  if (!["Paired", "Clawnch", "Both"].includes(feePreference)) {
    return Response.json({ ok: false, error: "invalid_fee_preference" }, { status: 400 });
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const tokenAdmin = tokenAdminInput && isAddress(tokenAdminInput)
    ? (tokenAdminInput as Address)
    : (account.address as Address);

  const baseRpc = process.env.OPERATOR_BASE_RPC_URL || "https://mainnet.base.org";
  const wallet = createWalletClient({ account, chain: base, transport: http(baseRpc) }) as any;
  const publicClient = createPublicClient({ chain: base, transport: http(baseRpc) }) as any;

  const deployer = new ClawnchDeployer({
    wallet,
    publicClient,
    network: "mainnet",
  });

  if (!deployer.isConfigured()) {
    return Response.json({ ok: false, error: "deployer_not_configured" }, { status: 500 });
  }

  try {
    const socialMediaUrls: Array<{ platform: string; url: string }> = [];
    if (website) socialMediaUrls.push({ platform: "website", url: website });
    if (twitter) socialMediaUrls.push({ platform: "x", url: twitter });

    const result = await deployer.deploy({
      name,
      symbol,
      tokenAdmin,
      image: image || undefined,
      metadata: {
        description: description || undefined,
        socialMediaUrls: socialMediaUrls.length ? socialMediaUrls : undefined,
      },
      rewards: {
        recipients: [
          {
            recipient: account.address,
            admin: account.address,
            bps: rewardBps,
            feePreference,
          },
        ],
      },
    });

    if (result.error) {
      return Response.json(
        {
          ok: false,
          error: result.error.message || "deploy_failed",
          txHash: result.txHash,
        },
        { status: 500 },
      );
    }

    const waited = await result.waitForTransaction();

    return Response.json({
      ok: true,
      txHash: result.txHash,
      tokenAddress: waited.address,
      deployer: account.address,
      network: "base-mainnet",
    });
  } catch (e: any) {
    return Response.json(
      {
        ok: false,
        error: e?.message || "deploy_failed",
      },
      { status: 500 },
    );
  }
}
