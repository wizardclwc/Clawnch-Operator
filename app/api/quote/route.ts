import { NextRequest } from "next/server";

export const runtime = "nodejs";

const ZEROX_BASE = "https://api.0x.org";
const ETH_PLACEHOLDER = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

function isAddress(s: string) {
  return /^0x[0-9a-fA-F]{40}$/.test(s);
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.OX_API_KEY;
  if (!apiKey) {
    return new Response("Server missing OX_API_KEY", { status: 500 });
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const chainId = Number(body?.chainId || 8453);
  const buyToken = String(body?.buyToken || "").trim();
  const sellToken = String(body?.sellToken || ETH_PLACEHOLDER).trim();
  const sellAmount = String(body?.sellAmount || "").trim(); // base units (string)
  const taker = String(body?.taker || "").trim();
  const slippageBps = body?.slippageBps === undefined ? undefined : Number(body.slippageBps);

  // Base only
  const allowedChains = new Set([8453]);
  if (!Number.isFinite(chainId) || !allowedChains.has(chainId)) {
    return new Response("Unsupported chainId (allowed: 8453)", { status: 400 });
  }
  if (!isAddress(buyToken)) return new Response("Invalid buyToken address", { status: 400 });
  if (!isAddress(sellToken)) return new Response("Invalid sellToken address", { status: 400 });
  if (!/^[0-9]+$/.test(sellAmount) || BigInt(sellAmount) <= 0n) return new Response("Invalid sellAmount", { status: 400 });
  if (!isAddress(taker)) return new Response("Invalid taker address", { status: 400 });
  if (slippageBps !== undefined && (!Number.isFinite(slippageBps) || slippageBps < 0 || slippageBps > 10_000)) {
    return new Response("Invalid slippageBps", { status: 400 });
  }

  const url = new URL(`${ZEROX_BASE}/swap/allowance-holder/quote`);
  url.searchParams.set("chainId", String(chainId));
  url.searchParams.set("sellToken", sellToken);
  url.searchParams.set("buyToken", buyToken);
  url.searchParams.set("sellAmount", sellAmount);
  url.searchParams.set("taker", taker);
  if (slippageBps !== undefined) url.searchParams.set("slippageBps", String(slippageBps));

  const upstream = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "0x-api-key": apiKey,
      "0x-version": "v2",
    },
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
}
