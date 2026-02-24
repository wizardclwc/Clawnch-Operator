export async function GET() {
  const url = "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd";

  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      next: { revalidate: 300 },
    });

    if (!res.ok) {
      return Response.json(
        { ok: false, message: `Coingecko error (${res.status})` },
        { status: 502, headers: { "cache-control": "no-store" } },
      );
    }

    const data = await res.json();
    const usd = data?.ethereum?.usd;

    if (typeof usd !== "number") {
      return Response.json(
        { ok: false, message: "Invalid Coingecko response" },
        { status: 502, headers: { "cache-control": "no-store" } },
      );
    }

    return Response.json(
      { ok: true, usd, source: "coingecko", ts: Date.now() },
      {
        headers: {
          "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
        },
      },
    );
  } catch {
    return Response.json(
      { ok: false, message: "Failed to fetch ETH price" },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
